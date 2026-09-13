import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import type { TagStore } from "./awefork-api.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * Tag store: the labels the user pinned on sessions (执行 / 实验设计 /
 * 咨询 …). A plain JSON sidecar like pins — losing it only loses the
 * curation, never session data. `sessions` maps sessionId → tag names
 * (ordered); `colors` maps tag name → hue (0-360) for user-chosen colors.
 * A color never outlives its tag: hues whose tag has no session references
 * are pruned on read and on every write. Older files that were just a
 * sessionId → names map migrate on read.
 */

export type TagMap = TagStore["sessions"];

const EMPTY: TagStore = { sessions: {}, colors: {} };
const FORBIDDEN_KEY_NAMES = new Set(["__proto__", "constructor", "prototype"]);

function isSafeKey(key: string): boolean {
  return !FORBIDDEN_KEY_NAMES.has(key);
}

function normalizeTags(tags: readonly unknown[]): string[] {
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function isLegacy(parsed: Record<string, unknown>): boolean {
  return Object.keys(parsed).length === 0 || Object.values(parsed).some((v) => Array.isArray(v));
}

function sanitizeSessions(parsed: Record<string, unknown>): TagMap {
  const map: TagMap = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!isSafeKey(id) || !Array.isArray(value)) continue;
    const tags = normalizeTags(value);
    if (tags.length > 0) map[id] = tags;
  }
  return map;
}

function sanitizeColors(parsed: Record<string, unknown>): Record<string, number> {
  const colors: Record<string, number> = {};
  for (const [tag, value] of Object.entries(parsed)) {
    if (isSafeKey(tag) && typeof value === "number" && Number.isFinite(value)) {
      colors[tag] = ((value % 360) + 360) % 360;
    }
  }
  return colors;
}

/** Keep only colors whose tag still has at least one session reference. */
function pruneOrphanColors(
  sessions: TagMap,
  colors: Record<string, number>,
): Record<string, number> {
  const live = new Set<string>();
  for (const tags of Object.values(sessions)) {
    for (const tag of tags) live.add(tag);
  }
  const kept: Record<string, number> = {};
  for (const [tag, hue] of Object.entries(colors)) {
    if (live.has(tag)) kept[tag] = hue;
  }
  return kept;
}

export async function readTags(filePath: string): Promise<TagStore> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: {}, colors: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return EMPTY;
    const obj = parsed as Record<string, unknown>;
    if (isLegacy(obj)) {
      return { sessions: sanitizeSessions(obj), colors: {} };
    }
    const sessions = sanitizeSessions((obj.sessions ?? {}) as Record<string, unknown>);
    const colors = pruneOrphanColors(
      sessions,
      sanitizeColors((obj.colors ?? {}) as Record<string, unknown>),
    );
    return { sessions, colors };
  } catch {
    return EMPTY;
  }
}

export async function writeTags(filePath: string, tags: TagStore): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(tags, null, 2)}\n`);
}

/** Replace one session's tags (empty list drops the entry); serialized per file. */
export function setSessionTags(
  filePath: string,
  sessionId: string,
  tags: string[],
): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    if (!isSafeKey(sessionId)) return store;
    const next: TagStore = {
      sessions: { ...store.sessions },
      colors: { ...store.colors },
    };
    const normalized = normalizeTags(tags);
    if (normalized.length > 0) next.sessions[sessionId] = normalized;
    else delete next.sessions[sessionId];
    next.colors = pruneOrphanColors(next.sessions, next.colors);
    await writeTags(filePath, next);
    return next;
  });
}

/**
 * Set (or with null clear) a tag's user-chosen hue; serialized per file.
 * Defensive: hues that are not finite numbers are ignored, and a hue is never
 * stored for a tag with no session references (no orphan colors).
 */
export function setTagColor(filePath: string, tag: string, hue: number | null): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    if (!isSafeKey(tag)) return store;
    if (hue === null) {
      if (!(tag in store.colors)) return store;
      const next: TagStore = { sessions: store.sessions, colors: { ...store.colors } };
      delete next.colors[tag];
      await writeTags(filePath, next);
      return next;
    }
    if (!Number.isFinite(hue)) return store;
    const referenced = Object.values(store.sessions).some((tags) => tags.includes(tag));
    if (!referenced) return store;
    const next: TagStore = { sessions: store.sessions, colors: { ...store.colors } };
    next.colors[tag] = ((hue % 360) + 360) % 360;
    await writeTags(filePath, next);
    return next;
  });
}

/** Remove a tag from every session (and its color); serialized per file. */
export function deleteTag(filePath: string, tag: string): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    if (!isSafeKey(tag)) return store;
    const sessions: TagMap = {};
    for (const [id, tags] of Object.entries(store.sessions)) {
      const kept = tags.filter((t) => t !== tag);
      if (kept.length > 0) sessions[id] = kept;
    }
    const colors = pruneOrphanColors(sessions, store.colors);
    const next: TagStore = { sessions, colors };
    await writeTags(filePath, next);
    return next;
  });
}

/** Drop a session's tags (hard delete path); returns the pruned store. */
export function pruneTags(filePath: string, sessionId: string): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    if (!isSafeKey(sessionId) || !(sessionId in store.sessions)) return store;
    const sessions = { ...store.sessions };
    delete sessions[sessionId];
    const next: TagStore = { sessions, colors: pruneOrphanColors(sessions, store.colors) };
    await writeTags(filePath, next);
    return next;
  });
}
