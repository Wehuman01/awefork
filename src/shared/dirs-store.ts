import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * Known-directories store (legacy, read-only): paths the user once added to
 * the sidebar by hand, so a project with zero conversations still showed a
 * group. The resident folder replaced that mechanism — one folder, set in
 * the settings blob — so this file is only read to adopt the first legacy
 * entry on upgrade. A plain JSON sidecar like pins; losing it costs nothing.
 */

export async function readDirs(filePath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((dir): dir is string => typeof dir === "string" && dir.length > 0);
  } catch {
    return [];
  }
}

export async function writeDirs(filePath: string, dirs: string[]): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(dirs, null, 2)}\n`);
}

/**
 * Spelling migration as one queued read-modify-write: a rewrite that read
 * outside the queue and wrote the whole list back could blind-overwrite a
 * registration that landed in between. The write half only serves this
 * migration now — nothing registers directories anymore.
 */
export function canonicalizeStoredDirs(
  filePath: string,
  canonicalize: (dirs: string[]) => Promise<{ dirs: string[]; changed: boolean }>,
): Promise<string[]> {
  return enqueueWrite(filePath, async () => {
    const { dirs, changed } = await canonicalize(await readDirs(filePath));
    if (changed) await writeDirs(filePath, dirs);
    return dirs;
  });
}
