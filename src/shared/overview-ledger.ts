import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import {
  forgetOverviewSession,
  markOverviewSeen,
  mergeOverviewLedger,
  normalizeOverviewLedger,
  type OverviewLedgerSnapshot,
  type OverviewReadEntry,
  type OverviewReadLedger,
  recordOverviewSettle,
} from "./overview-ledger-types.js";
import { enqueueWrite } from "./write-queue.js";

/**
 * The canvas session overview's unread ledger (画布会话总览 未读账本), owned by
 * the MAIN process so every window reads and writes one authoritative record.
 *
 * Why a sidecar in userData and not per-window localStorage: awefork runs one
 * window per agent plus a main window, and every window keeps its own copy of
 * the run maps. Two windows each settling a run would each mint a revision
 * against their private copy, and the last write would silently drop the other
 * window's unread badge. A single writer with a broadcast makes "one window
 * marks seen, every window updates" true instead of approximately true.
 *
 * Types and pure folds live in overview-ledger-types.ts (the renderer mirrors
 * them); this file is the node-only side: read, write, and the store that
 * serializes mutations through the file's write queue.
 */

/** Read the sidecar; a missing or corrupt file reads as an empty ledger. */
async function readOverviewState(filePath: string): Promise<{
  ledger: OverviewReadLedger;
  unknown: Map<string, string>;
  observedAt: Map<string, number>;
  scannedAt: Map<string, number>;
}> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ledger: {}, unknown: new Map(), observedAt: new Map(), scannedAt: new Map() };
    }
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      (parsed as { version?: unknown }).version === 1
    ) {
      const document = parsed as {
        ledger?: unknown;
        unknown?: unknown;
        observedAt?: unknown;
        scannedAt?: unknown;
      };
      const unknown =
        document.unknown && typeof document.unknown === "object"
          ? Object.entries(document.unknown as Record<string, unknown>)
              .filter(([, value]) => value === true || typeof value === "string")
              .map(([key, value]) => [key, typeof value === "string" ? value : ""] as const)
          : [];
      const observedAt =
        document.observedAt && typeof document.observedAt === "object"
          ? Object.entries(document.observedAt as Record<string, unknown>)
              .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
              .map(([key, value]) => [key, value as number] as const)
          : [];
      const scannedAt =
        document.scannedAt && typeof document.scannedAt === "object"
          ? Object.entries(document.scannedAt as Record<string, unknown>)
              .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
              .map(([key, value]) => [key, value as number] as const)
          : [];
      return {
        ledger: normalizeOverviewLedger(document.ledger),
        unknown: new Map(unknown),
        observedAt: new Map(observedAt),
        scannedAt: new Map(scannedAt),
      };
    }
    // Version 0 was a plain ledger; keep its unread records during upgrade.
    return {
      ledger: normalizeOverviewLedger(parsed),
      unknown: new Map(),
      observedAt: new Map(),
      scannedAt: new Map(),
    };
  } catch {
    return { ledger: {}, unknown: new Map(), observedAt: new Map(), scannedAt: new Map() };
  }
}

export async function readOverviewLedger(filePath: string): Promise<OverviewReadLedger> {
  return (await readOverviewState(filePath)).ledger;
}

async function writeOverviewState(
  filePath: string,
  ledger: OverviewReadLedger,
  unknown: ReadonlyMap<string, string>,
  observedAt: ReadonlyMap<string, number>,
  scannedAt: ReadonlyMap<string, number>,
): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const document = {
    version: 1,
    ledger,
    unknown: Object.fromEntries(unknown),
    observedAt: Object.fromEntries(observedAt),
    scannedAt: Object.fromEntries(scannedAt),
  };
  await writeFileAtomic(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

/**
 * The main-process owner of the ledger sidecar: one in-memory copy, every
 * mutation serialized through the file's write queue (concurrent windows
 * cannot interleave read-modify-writes), and every applied change returned so
 * the caller can broadcast it. Callers never touch the file themselves.
 */
export class OverviewLedgerStore {
  private ledger: OverviewReadLedger = {};
  private unknown = new Map<string, string>();
  private observedAt = new Map<string, number>();
  private scannedAt = new Map<string, number>();
  private loaded: Promise<void> | null = null;
  private readonly settleIds = new Set<string>();

  constructor(private readonly filePath: string) {}

  /** Read the sidecar once; later calls resolve immediately. */
  async load(): Promise<OverviewReadLedger> {
    if (!this.loaded) {
      this.loaded = readOverviewState(this.filePath).then(
        ({ ledger, unknown, observedAt, scannedAt }) => {
          this.ledger = ledger;
          this.unknown = unknown;
          this.observedAt = observedAt;
          this.scannedAt = scannedAt;
          for (const entry of Object.values(ledger)) {
            if (entry.settleId) this.settleIds.add(entry.settleId);
          }
        },
      );
    }
    await this.loaded;
    return this.ledger;
  }

  /** Snapshot for a new window; sequence orders it against live broadcasts. */
  async snapshot(): Promise<OverviewLedgerSnapshot> {
    const ledger = await this.load();
    return {
      sequence: 0,
      ledger,
      unknown: Object.fromEntries(this.unknown),
      observedAt: Object.fromEntries(this.observedAt),
      scannedAt: Object.fromEntries(this.scannedAt),
    };
  }

  /** Store the newest session-list timestamps seen by any overview window. */
  async observeUpdatedAt(
    backend: string,
    entries: Array<{ key: string; updatedAt: number }>,
    scannedAt: number,
  ): Promise<number> {
    await this.load();
    let changed = false;
    for (const { key, updatedAt } of entries) {
      if (!key || !Number.isFinite(updatedAt)) continue;
      if (updatedAt <= (this.observedAt.get(key) ?? Number.NEGATIVE_INFINITY)) continue;
      this.observedAt.set(key, updatedAt);
      changed = true;
    }
    const previousScan = this.scannedAt.get(backend) ?? 0;
    const requestedScan = Number.isFinite(scannedAt) ? scannedAt : Date.now();
    const nextScan = Math.max(previousScan, requestedScan);
    if (previousScan === 0 || nextScan - previousScan >= 30_000) {
      this.scannedAt.set(backend, nextScan);
      changed = true;
    }
    if (changed) await this.persist(this.ledger);
    return this.scannedAt.get(backend) ?? nextScan;
  }

  /** Persist that the last known live run has not yet been confirmed settled. */
  async setUnknown(
    key: string,
    unknown: boolean,
    runId?: string,
  ): Promise<{ unknown: boolean; runId: string | null; changed: boolean }> {
    await this.load();
    const current = this.unknown.get(key);
    if (unknown) {
      const nextRunId = runId ?? current ?? "";
      if (current === nextRunId) return { unknown: true, runId: nextRunId, changed: false };
      this.unknown.set(key, nextRunId);
    } else {
      if (current === undefined) return { unknown: false, runId: null, changed: false };
      if (runId !== undefined && current !== runId) {
        return { unknown: true, runId: current, changed: false };
      }
      this.unknown.delete(key);
    }
    await this.persist(this.ledger);
    return { unknown, runId: unknown ? (this.unknown.get(key) ?? "") : null, changed: true };
  }

  /** Fold a settle in, persist, and return the entry it produced. */
  async recordSettle(
    key: string,
    input: { settledAt: number; failed: boolean; settleId?: string; runId?: string },
  ): Promise<{ entry: OverviewReadEntry; changed: boolean; unknownCleared: boolean }> {
    await this.load();
    if (input.settleId && this.settleIds.has(input.settleId)) {
      return {
        entry: this.ledger[key] ?? { revision: 0, seen: 0, settledAt: 0, failed: false },
        changed: false,
        unknownCleared: false,
      };
    }
    const next = recordOverviewSettle(this.ledger, key, input);
    if (next === this.ledger) {
      const current = this.ledger[key];
      if (current) return { entry: current, changed: false, unknownCleared: false };
    }
    // Claim the observation in memory before the disk round-trip. If that
    // write fails but a duplicate window event follows, it still cannot mint
    // a second revision in this main-process lifetime.
    if (input.settleId) this.settleIds.add(input.settleId);
    const unknownRunId = this.unknown.get(key);
    const settledRunId = input.runId ?? input.settleId;
    const unknownCleared =
      unknownRunId !== undefined &&
      (!unknownRunId || !settledRunId || unknownRunId === settledRunId);
    if (unknownCleared) this.unknown.delete(key);
    await this.persist(next);
    const entry = next[key];
    if (!entry) throw new Error(`ledger lost key ${key} right after writing it`);
    if (this.settleIds.size > 2048) {
      const oldest = this.settleIds.values().next().value;
      if (oldest) this.settleIds.delete(oldest);
    }
    return { entry, changed: true, unknownCleared };
  }

  /** Advance a watermark, persist, and return the entry (null when absent). */
  async markSeen(key: string, upTo?: number): Promise<OverviewReadEntry | null> {
    await this.load();
    const next = markOverviewSeen(this.ledger, key, upTo);
    if (next === this.ledger) return this.ledger[key] ?? null;
    await this.persist(next);
    return next[key] ?? null;
  }

  /** Forget a deleted session, persist, and report whether it existed. */
  async forget(key: string): Promise<boolean> {
    await this.load();
    const hadEntry = key in this.ledger;
    const hadUnknown = this.unknown.has(key);
    const hadObserved = this.observedAt.delete(key);
    if (!hadEntry && !hadUnknown && !hadObserved) return false;
    this.unknown.delete(key);
    await this.persist(forgetOverviewSession(this.ledger, key));
    return true;
  }

  /**
   * Merge a window's copy in. Used when a window that has been running ahead
   * (offline, or migrating from the old per-window localStorage ledger)
   * reconnects: its revisions are folded into the authoritative record instead
   * of being dropped by the snapshot it just received.
   */
  async merge(incoming: OverviewReadLedger): Promise<OverviewReadLedger> {
    await this.load();
    const next = mergeOverviewLedger(this.ledger, incoming);
    if (next === this.ledger) return this.ledger;
    for (const [key, entry] of Object.entries(incoming)) {
      const unknownRunId = this.unknown.get(key);
      if (unknownRunId !== undefined && (!unknownRunId || unknownRunId === entry.settleId)) {
        this.unknown.delete(key);
      }
    }
    await this.persist(next);
    for (const entry of Object.values(next)) {
      if (entry.settleId) this.settleIds.add(entry.settleId);
    }
    return next;
  }

  /** Replace the in-memory copy and write it; returns the applied ledger. */
  private async persist(next: OverviewReadLedger): Promise<OverviewReadLedger> {
    this.ledger = next;
    await enqueueWrite(this.filePath, async () => {
      await writeOverviewState(this.filePath, next, this.unknown, this.observedAt, this.scannedAt);
    });
    return next;
  }
}
