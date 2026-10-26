import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { normalizeRoundRecord, type RoundRecord } from "./rounds-types.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * How many rounds the sidecar keeps. A round is small (a prompt, a few answer
 * snapshots, session ids), but the file is read whole at every boot, so the
 * oldest rounds fall out first rather than growing without bound.
 */
const MAX_ROUNDS = 200;

/**
 * The multi-model rounds sidecar (并行轮次落盘), owned by the MAIN process so
 * every window restores the same rounds at boot — the same one-writer shape
 * the overview ledger uses, for the same reason: a round's canvas badges and
 * reading view must not depend on which window happened to run it.
 *
 * The renderer upserts one record at a time (round skeleton once its forks
 * exist, then again as the summary lands); the read-modify-write runs inside
 * the file's write queue, so two windows saving different rounds cannot drop
 * each other. A missing or corrupt file reads as no rounds — the app then
 * behaves exactly as it did before this store existed.
 */
export class RoundsStore {
  constructor(private readonly filePath: string) {}

  /** Every persisted round, oldest first; invalid entries are dropped. */
  async list(): Promise<RoundRecord[]> {
    return this.readAll();
  }

  /** Insert or replace the record with this id, then trim to the newest cap. */
  async save(record: RoundRecord): Promise<void> {
    return enqueueWrite(this.filePath, async () => {
      const rounds = (await this.readAll()).filter((item) => item.id !== record.id);
      rounds.push(record);
      rounds.sort((a, b) => a.createdAt - b.createdAt);
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await writeFileAtomic(
        this.filePath,
        `${JSON.stringify({ version: 1, rounds: rounds.slice(-MAX_ROUNDS) }, null, 2)}\n`,
      );
    });
  }

  private async readAll(): Promise<RoundRecord[]> {
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
      // block boot: rounds simply stay window-local until the next save.
      return [];
    }
    const rounds =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { rounds?: unknown }).rounds)
        ? (parsed as { rounds: unknown[] }).rounds
        : [];
    return rounds.flatMap((item) => {
      const record = normalizeRoundRecord(item);
      return record ? [record] : [];
    });
  }
}
