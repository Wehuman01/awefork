import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import type { ForkRecord, LineageMap } from "./types.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * Lineage store: a single JSON file mapping forked session ids to their
 * origin. opencode's fork API copies messages but records no parent link,
 * so awefork owns this sidecar to rebuild fork trees.
 *
 * Assumption: a single awefork instance writes to a given file. If you run
 * two, last write wins on conflict.
 */

export async function readLineage(filePath: string): Promise<LineageMap> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as LineageMap;
  } catch {
    // Corrupted sidecar is worse than an empty one: ignore it, forks just
    // lose their nesting until re-forked.
    return {};
  }
}

/** Serialized so a concurrent fork and delete cannot drop each other's entry. */
export function recordFork(
  filePath: string,
  forkedSessionId: string,
  record: ForkRecord,
): Promise<void> {
  return enqueueWrite(filePath, async () => {
    const map = await readLineage(filePath);
    map[forkedSessionId] = record;
    await fs.mkdir(dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, `${JSON.stringify(map, null, 2)}\n`);
  });
}

/** Forget a session's own fork record (its children keep theirs, pointing at
 *  a now-missing parent — readers already treat that as "root"). */
export function removeFork(filePath: string, sessionId: string): Promise<void> {
  return enqueueWrite(filePath, async () => {
    const map = await readLineage(filePath);
    if (!(sessionId in map)) return;
    delete map[sessionId];
    await writeFileAtomic(filePath, `${JSON.stringify(map, null, 2)}\n`);
  });
}

/**
 * Sessions recorded as standalone exports. Their rows still carry the fork
 * parent the server stamped on them (opencode v2's `fork.sessionID`), which
 * must not surface: to every view the copy is the plain root it was exported
 * as, not an agent-spawned subagent hanging off its source.
 */
export async function readDetachedExportIds(filePath: string): Promise<Set<string>> {
  let lineage: LineageMap;
  try {
    lineage = await readLineage(filePath);
  } catch {
    // An unreadable sidecar must not fail a session listing; the worst case is
    // an export that keeps showing its server-side parent until it is fixed.
    return new Set();
  }
  const ids = new Set<string>();
  for (const [id, record] of Object.entries(lineage)) {
    if (record.detached) ids.add(id);
  }
  return ids;
}

/**
 * The lineage map as views see it: standalone exports are dropped. Their
 * record exists only to suppress a server-side fork link (see
 * readDetachedExportIds), so no consumer may treat the copy as a branch — no
 * canvas edge, no parent fork, no inherited prefix.
 */
export function lineageForDisplay(lineage: LineageMap): LineageMap {
  const shown: LineageMap = {};
  for (const [id, record] of Object.entries(lineage)) {
    if (!record.detached) shown[id] = record;
  }
  return shown;
}
