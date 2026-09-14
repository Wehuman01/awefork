import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * Known-directories store: paths the user added to the sidebar by hand, so a
 * project with zero conversations still shows a group to create one in.
 * A plain JSON sidecar like pins — losing it only loses the curation, never
 * session data.
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

/** Register a directory (no-op when already known); serialized like pins. */
export function addDir(filePath: string, directory: string): Promise<string[]> {
  return enqueueWrite(filePath, async () => {
    const dirs = await readDirs(filePath);
    const next = dirs.includes(directory) ? dirs : [...dirs, directory];
    await writeDirs(filePath, next);
    return next;
  });
}

/** Forget a registration; serialized so concurrent edits cannot interleave. */
export function removeDir(filePath: string, directory: string): Promise<string[]> {
  return enqueueWrite(filePath, async () => {
    const next = (await readDirs(filePath)).filter((dir) => dir !== directory);
    await writeDirs(filePath, next);
    return next;
  });
}
