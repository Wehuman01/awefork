import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { CodexTurnSettings } from "../shared/codex-adapter.js";
import { findRolloutRelPath } from "./codex-homes.js";

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
