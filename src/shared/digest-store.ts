import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { type DigestGroup, normalizeDigestGroup } from "./digest-types.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * How many digests the sidecar keeps. A digest is small (a handful of
 * story labels plus the summary text), but the file is read whole at every
 * boot, so the oldest digests fall out first rather than growing without
 * bound.
 */
const MAX_DIGESTS = 100;

/**
 * The digests sidecar (事后总结落盘), owned by the MAIN process so every
 * window restores the same digests at boot — the same one-writer shape the
 * rounds sidecar uses, for the same reason: a digest's canvas ✦ card and
 * reading view must not depend on which window happened to run it.
 *
 * The renderer upserts one record at a time (skeleton once its summary
 * fork exists, then again as the summary lands); the read-modify-write runs
 * inside the file's write queue, so two windows saving different digests
 * cannot drop each other. A missing or corrupt file reads as no digests —
 * the app then behaves exactly as it did before this store existed.
 */
export class DigestsStore {
  constructor(private readonly filePath: string) {}

  /** Every persisted digest, oldest first; invalid entries are dropped. */
  async list(): Promise<DigestGroup[]> {
    return this.readAll();
  }

  /** Insert or replace the record with this id, then trim to the newest cap. */
  async save(group: DigestGroup): Promise<void> {
    return enqueueWrite(this.filePath, async () => {
      const digests = (await this.readAll()).filter((item) => item.id !== group.id);
      digests.push(group);
      digests.sort((a, b) => a.createdAt - b.createdAt);
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await writeFileAtomic(
        this.filePath,
        `${JSON.stringify({ version: 1, digests: digests.slice(-MAX_DIGESTS) }, null, 2)}\n`,
      );
    });
  }

  private async readAll(): Promise<DigestGroup[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A half-written file is worse than a missing one, but neither may
      // block boot: digests simply stay window-local until the next save.
      return [];
    }
    const digests =
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { digests?: unknown }).digests)
        ? (parsed as { digests: unknown[] }).digests
        : [];
    return digests.flatMap((item) => {
      const group = normalizeDigestGroup(item);
      return group ? [group] : [];
    });
  }
}
