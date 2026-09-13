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
 * Older files that were just a sessionId → names map migrate on read.
 */

export type TagMap = TagStore["sessions"];

const EMPTY: TagStore = { sessions: {}, colors: {} };

function isLegacy(parsed: Record<string, unknown>): boolean {
  return Object.keys(parsed).length === 0 || Object.values(parsed).some((v) => Array.isArray(v));
}

function sanitizeSessions(parsed: Record<string, unknown>): TagMap {
  const map: TagMap = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    const tags = value.filter((t): t is string => typeof t === "string");
    if (tags.length > 0) map[id] = tags;
  }
  return map;
}

function sanitizeColors(parsed: Record<string, unknown>): Record<string, number> {
  const colors: Record<string, number> = {};
  for (const [tag, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      colors[tag] = ((value % 360) + 360) % 360;
    }
  }
  return colors;
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
    const sessions = (obj.sessions ?? {}) as Record<string, unknown>;
    const colors = (obj.colors ?? {}) as Record<string, unknown>;
    return { sessions: sanitizeSessions(sessions), colors: sanitizeColors(colors) };
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
    const next: TagStore = { colors: store.colors, sessions: { ...store.sessions } };
    if (tags.length > 0) next.sessions[sessionId] = tags;
    else delete next.sessions[sessionId];
    await writeTags(filePath, next);
    return next;
  });
}

/** Set (or with null clear) a tag's user-chosen hue; serialized per file. */
export function setTagColor(filePath: string, tag: string, hue: number | null): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    const next: TagStore = { sessions: store.sessions, colors: { ...store.colors } };
    if (hue === null) delete next.colors[tag];
    else next.colors[tag] = ((hue % 360) + 360) % 360;
    await writeTags(filePath, next);
    return next;
  });
}

/** Remove a tag from every session (and its color); serialized per file. */
export function deleteTag(filePath: string, tag: string): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    const sessions: TagMap = {};
    for (const [id, tags] of Object.entries(store.sessions)) {
      const kept = tags.filter((t) => t !== tag);
      if (kept.length > 0) sessions[id] = kept;
    }
    const colors = { ...store.colors };
    delete colors[tag];
    const next: TagStore = { sessions, colors };
    await writeTags(filePath, next);
    return next;
  });
}

/** Drop a session's tags (hard delete path); returns the pruned store. */
export function pruneTags(filePath: string, sessionId: string): Promise<TagStore> {
  return enqueueWrite(filePath, async () => {
    const store = await readTags(filePath);
    if (!(sessionId in store.sessions)) return store;
    const sessions = { ...store.sessions };
    delete sessions[sessionId];
    const next: TagStore = { sessions, colors: store.colors };
    await writeTags(filePath, next);
    return next;
  });
}
