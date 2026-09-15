import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * Key-turn mark store: `sessionId:messageId` keys the user starred as
 * important conversations. A plain JSON sidecar like pins — losing it only
 * loses the curation, never session data. Keys match canvas turn node ids.
 */

export type MarkKey = string;

function isSafeKey(key: string): boolean {
  return key.length > 0 && key !== "__proto__" && !key.includes("\n");
}

function normalizeMarks(parsed: unknown): MarkKey[] {
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((k): k is MarkKey => typeof k === "string" && isSafeKey(k)))];
}

export async function readMarks(filePath: string): Promise<MarkKey[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    return normalizeMarks(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function writeMarks(filePath: string, marks: MarkKey[]): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(marks, null, 2)}\n`);
}

/** `${sessionId}:${messageId}` — the canvas turn node's id. */
export function markKey(sessionId: string, messageId: string): MarkKey {
  return `${sessionId}:${messageId}`;
}

/** Mark or unmark one turn; serialized so concurrent toggles cannot interleave. */
export function toggleMark(
  filePath: string,
  sessionId: string,
  messageId: string,
): Promise<MarkKey[]> {
  return enqueueWrite(filePath, async () => {
    const key = markKey(sessionId, messageId);
    if (!isSafeKey(key)) return readMarks(filePath);
    const marks = await readMarks(filePath);
    const next = marks.includes(key) ? marks.filter((k) => k !== key) : [...marks, key];
    await writeMarks(filePath, next);
    return next;
  });
}

/** Drop one turn's mark (turn-delete path). */
export function pruneTurnMark(
  filePath: string,
  sessionId: string,
  messageId: string,
): Promise<MarkKey[]> {
  return enqueueWrite(filePath, async () => {
    const key = markKey(sessionId, messageId);
    const next = (await readMarks(filePath)).filter((k) => k !== key);
    await writeMarks(filePath, next);
    return next;
  });
}

/** Drop every mark of a session (hard-delete path). */
export function pruneSessionMarks(filePath: string, sessionId: string): Promise<MarkKey[]> {
  return enqueueWrite(filePath, async () => {
    const prefix = `${sessionId}:`;
    const next = (await readMarks(filePath)).filter((k) => !k.startsWith(prefix));
    await writeMarks(filePath, next);
    return next;
  });
}
