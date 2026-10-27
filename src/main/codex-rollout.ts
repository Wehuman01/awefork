import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { CodexTurnSettings } from "../shared/codex-adapter.js";
import { findRolloutRelPath, listRolloutFiles } from "./codex-homes.js";

/** turnId → the settings that turn ran with. */
export type CodexTurnContexts = Record<string, CodexTurnSettings>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  contexts: CodexTurnContexts;
}

/**
 * Parsed rollouts, keyed by file path. Viewing one session re-reads the same
 * file on every reload and it keeps growing during a run, so a hit keyed on
 * the file's stat spares a multi-megabyte parse per refresh. Bounded because
 * a long session walks through many files.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 32;

/**
 * What each turn of a session actually ran with, read from the session's
 * rollout.
 *
 * codex's app-server exposes the model at thread level only — `thread/read`
 * answers with the CURRENT settings — so a model switched mid-session would
 * otherwise relabel every earlier turn. The rollout is the one place the
 * per-turn truth lives: codex writes a `turn_context` record at every turn's
 * start naming that turn's model and reasoning effort.
 *
 * Sessions whose rollout codex has compressed (`.jsonl.zst`) or pruned are
 * simply absent from the answer, and the caller falls back to the thread's
 * settings — the pre-per-turn behavior.
 */
export async function readTurnContexts(
  homePath: string,
  sessionId: string,
): Promise<CodexTurnContexts> {
  const rel = findRolloutRelPath(homePath, sessionId);
  if (rel === null) return {};
  const path = join(homePath, "sessions", rel);
  try {
    const stat = await fs.stat(path);
    const cached = cache.get(path);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.contexts;
    }
    const contexts = parseTurnContexts(await fs.readFile(path, "utf8"));
    cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, contexts });
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    return contexts;
  } catch {
    // Pruned between the listing and the read, or unreadable: the caller's
    // thread-level fallback is the honest answer, never a failed messages().
    return {};
  }
}

/** Every `turn_context` record's settings, keyed by the turn it belongs to. */
function parseTurnContexts(text: string): CodexTurnContexts {
  const contexts: CodexTurnContexts = {};
  for (const line of text.split("\n")) {
    // Cheap pre-filter: turn_context records are a small minority of the
    // lines in a rollout that runs to megabytes.
    if (!line.includes('"turn_context"')) continue;
    let record: {
      type?: unknown;
      payload?: { turn_id?: unknown; model?: unknown; effort?: unknown };
    };
    try {
      record = JSON.parse(line);
    } catch {
      // A torn final line while the turn is still writing its record.
      continue;
    }
    if (record.type !== "turn_context") continue;
    const turnId = record.payload?.turn_id;
    if (typeof turnId !== "string" || turnId === "") continue;
    contexts[turnId] = {
      model: textOrNull(record.payload?.model),
      effort: textOrNull(record.payload?.effort),
    };
  }
  return contexts;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Every session in a home that was forked, mapped to the parent it forked
 * from.
 *
 * codex's `thread/list` answers every thread with `forkedFromId: null` — the
 * parent link lives only in the rollout's `session_meta` record, and only
 * `thread/read` carries it back. A fork cut by the codex CLI (or by codex
 * itself) is therefore invisible to a listing: awefork's own fork sidecar
 * records only the forks awefork cut, so every other fork reads as a root and
 * its story falls apart into separate branches on the canvas.
 *
 * The rollout is the one place the link is written, so it is the one place
 * worth reading. Only the first record of each file is needed, which keeps
 * this to a small read per session instead of a full parse.
 */
export async function readForkParents(homePath: string): Promise<Record<string, string>> {
  const cached = forkParentCache.get(homePath);
  if (cached && Date.now() - cached.readAt < FORK_PARENT_TTL_MS) return cached.parents;
  const parents: Record<string, string> = {};
  for (const path of listRolloutFiles(homePath)) {
    const parent = await readForkParentOf(path);
    if (parent) parents[parent.sessionId] = parent.parentId;
  }
  forkParentCache.set(homePath, { parents, readAt: Date.now() });
  return parents;
}

/**
 * How long a home's fork parents stay valid.
 *
 * A fork's parent never changes once written, and a new fork adds a session
 * rather than editing one, so a stale entry only means a fork made in the
 * last interval is not yet visible as a branch. The listing reads the
 * rollouts on every refresh, so the cache keeps a refresh from walking the
 * whole sessions tree.
 */
const FORK_PARENT_TTL_MS = 5_000;

/** Per-home fork parents, read from the rollouts. */
const forkParentCache = new Map<string, { parents: Record<string, string>; readAt: number }>();

interface ForkParent {
  sessionId: string;
  parentId: string;
}

/**
 * The parent one rollout recorded, or null when the file names no parent.
 *
 * The record's own `session_id` is the session's id: a rollout file can hold
 * another session's copied prefix (codex writes one file per fork point), and
 * the id that matters is the one the record states.
 */
async function readForkParentOf(path: string): Promise<ForkParent | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(path, "r");
    // Only the first line is needed, but its length is not bounded — the
    // session_meta record carries the model's base instructions, which grow
    // with the prompt. Reading until the newline avoids a fixed chunk that a
    // long instruction would outgrow.
    const firstLine = await readFirstLine(handle);
    if (firstLine === null) return null;
    let record: { type?: unknown; payload?: Record<string, unknown> };
    try {
      record = JSON.parse(firstLine);
    } catch {
      // A torn first line: the session is still being written.
      return null;
    }
    if (record.type !== "session_meta") return null;
    const sessionId = textOrNull(record.payload?.session_id);
    const parentId = textOrNull(record.payload?.forked_from_id);
    // A session that forked from itself is not a fork — codex writes that
    // shape for a resumed thread, and treating it as one would make the
    // story walk loop.
    if (!sessionId || !parentId || parentId === sessionId) return null;
    return { sessionId, parentId };
  } catch {
    // Pruned between the listing and the read, or unreadable: the caller
    // keeps the thread's own (parentless) shape.
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * The file's first line, without its newline; null when the file is empty.
 *
 * A rollout's first record is the session_meta, whose length is not bounded
 * (it carries the model's base instructions), so the read keeps going until
 * the newline rather than stopping at a fixed chunk. A cap keeps a damaged
 * file with no newline from being read to its end: past it the line is not a
 * session_meta record any more, and the caller treats it as absent.
 */
async function readFirstLine(handle: FileHandle): Promise<string | null> {
  const decoder = new TextDecoder("utf-8");
  let line = "";
  let total = 0;
  const buffer = Buffer.alloc(16 * 1024);
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    const chunk = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
    const newline = chunk.indexOf("\n");
    if (newline >= 0) return line + chunk.slice(0, newline);
    line += chunk;
    total += chunk.length;
    if (total > FIRST_LINE_LIMIT_BYTES) return null;
  }
  const rest = decoder.decode();
  if (rest.length === 0 && line.length === 0) return null;
  return line + rest;
}

/** A session_meta record is far below this; a first line past it is not one. */
const FIRST_LINE_LIMIT_BYTES = 1024 * 1024;
