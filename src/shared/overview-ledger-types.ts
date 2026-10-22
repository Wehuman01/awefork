/**
 * Types + pure folds of the canvas session overview's unread ledger
 * (画布会话总览 未读账本). Shared by the main process (which owns the file)
 * and the renderer (which mirrors it), so both sides fold a settle or a seen
 * watermark the same way. No I/O here — the main-owned store lives in
 * overview-ledger.ts, which is node-only.
 *
 * Semantics:
 * - revision is awefork's OWN observation counter, bumped once per settled run
 *   awefork actually watched. It is not the agent's turn id and never shown
 *   as one.
 * - seen is the watermark the user was actually shown. A result that lands
 *   while a session is loading stays unread (the jump pins the revision).
 * - Only an observed ending mints a revision. A silent timeout or a lost
 *   connection never fabricates a result — those stay in the renderer's
 *   transient "unknown" map and never reach the persisted record.
 */

/** One ledger entry: the last observed result plus the seen watermark. */
export interface OverviewReadEntry {
  /** Observation counter, bumped once per settled run awefork watched. */
  revision: number;
  /** Highest revision the user has actually been shown. */
  seen: number;
  /** When the settle was observed — never the agent's own completion time. */
  settledAt: number;
  /** The run ended with an explicit error (a lost connection does not count). */
  failed: boolean;
  /** Shared event id used to make one run's settlement idempotent across windows. */
  settleId?: string;
}

/** Persisted ledger, keyed by `backend:sessionId` (see overviewKey). */
export type OverviewReadLedger = Record<string, OverviewReadEntry>;

/** Snapshot and update sequence orders boot reads against live broadcasts. */
export interface OverviewLedgerSnapshot {
  sequence: number;
  ledger: OverviewReadLedger;
  /** Sessions whose last running state was not confirmed before shutdown. */
  unknown: Record<string, string>;
}

/** A null entry is a deletion tombstone. */
export interface OverviewReadUpdate {
  sequence: number;
  key: string;
  entry?: OverviewReadEntry | null;
  unknown?: string | null;
}

/** Ledger key for one session: backend + native session id, never a title. */
export function overviewKey(backend: string, sessionId: string): string {
  return `${backend}:${sessionId}`;
}

/** How many settled sessions the ledger keeps (oldest dropped). */
export const OVERVIEW_LEDGER_LIMIT = 300;

/**
 * Keep the newest OVERVIEW_LEDGER_LIMIT entries so the ledger cannot grow
 * forever. Sorted by settle time, not insertion: a long-lived session that
 * settles rarely must not be evicted by a chatty one.
 */
export function pruneOverviewLedger(ledger: OverviewReadLedger): OverviewReadLedger {
  const entries = Object.entries(ledger);
  if (entries.length <= OVERVIEW_LEDGER_LIMIT) return ledger;
  const kept = entries
    .sort(([, a], [, b]) => b.settledAt - a.settledAt)
    .slice(0, OVERVIEW_LEDGER_LIMIT);
  return Object.fromEntries(kept);
}

/**
 * Fold one observed settle into the ledger: bump the revision, keep the seen
 * watermark (a new result after viewing is unread again) and record how the
 * run ended. Repeated settles keep bumping — callers gate on having actually
 * watched the run, so a duplicate idle frame never reaches this twice.
 */
export function recordOverviewSettle(
  ledger: OverviewReadLedger,
  key: string,
  input: { settledAt: number; failed: boolean; settleId?: string },
): OverviewReadLedger {
  const prev = ledger[key];
  if (input.settleId && prev?.settleId === input.settleId) return ledger;
  const revision = (prev?.revision ?? 0) + 1;
  const next: OverviewReadLedger = {
    ...ledger,
    [key]: {
      revision,
      seen: prev?.seen ?? 0,
      settledAt: input.settledAt,
      failed: input.failed,
      ...(input.settleId ? { settleId: input.settleId } : {}),
    },
  };
  return pruneOverviewLedger(next);
}

/**
 * Advance the seen watermark to the revision the user was actually shown.
 * `upTo` pins that revision: a result that landed while the session was still
 * loading stays unread instead of being cleared by the same click. Returns the
 * same object when nothing changed, so callers can skip the write.
 */
export function markOverviewSeen(
  ledger: OverviewReadLedger,
  key: string,
  upTo?: number,
): OverviewReadLedger {
  const prev = ledger[key];
  if (!prev) return ledger;
  const target = Math.min(upTo ?? prev.revision, prev.revision);
  if (prev.seen >= target) return ledger;
  return { ...ledger, [key]: { ...prev, seen: target } };
}

/** Drop one session's record (hard delete): nothing left to project. */
export function forgetOverviewSession(ledger: OverviewReadLedger, key: string): OverviewReadLedger {
  if (!(key in ledger)) return ledger;
  const { [key]: _gone, ...kept } = ledger;
  void _gone;
  return kept;
}

/**
 * Merge an incoming ledger into the authoritative one, per entry and never
 * wholesale: a window that ran ahead (offline, or migrating from the old
 * per-window storage) still contributes its revisions. Revisions are monotonic
 * counters, so the max wins and a stale replay cannot roll one back. `seen`
 * follows the revision that survived — a watermark past a lowered revision is
 * clamped.
 *
 * This is what makes concurrent windows safe without a lock: the merge is a
 * pure function of the two records, so whichever write lands second produces
 * the same union as if it had landed first.
 */
export function mergeOverviewLedger(
  base: OverviewReadLedger,
  incoming: OverviewReadLedger,
): OverviewReadLedger {
  const merged: OverviewReadLedger = { ...base };
  for (const [key, entry] of Object.entries(incoming)) {
    const prev = merged[key];
    if (!prev) {
      merged[key] = entry;
      continue;
    }
    const revision = Math.max(prev.revision, entry.revision);
    // The newer settle carries the fresher failure flag; an older failure must
    // not outlive a successful re-run (and a success must not launder a fresh
    // failure, which is why the comparison is by settledAt).
    const newest = entry.settledAt >= prev.settledAt ? entry : prev;
    merged[key] = {
      revision,
      seen: Math.min(Math.max(prev.seen, entry.seen), revision),
      settledAt: newest.settledAt,
      failed: newest.failed,
      ...(newest.settleId ? { settleId: newest.settleId } : {}),
    };
  }
  return pruneOverviewLedger(merged);
}

/**
 * Validate one untrusted row (IPC boundary, a parsed sidecar, a hand-edited
 * file). Any malformed entry is dropped instead of trusted: a corrupt record
 * must cost at worst a missing unread badge, never a crash or a fabricated
 * "seen". `seen` is clamped to `revision` so a bad row cannot claim the user
 * saw more than exists.
 */
export function normalizeOverviewEntry(value: unknown): OverviewReadEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<Record<keyof OverviewReadEntry, unknown>>;
  const revision = Number(entry.revision);
  const seen = Number(entry.seen);
  if (!Number.isFinite(revision) || !Number.isFinite(seen)) return null;
  if (revision < 0 || seen < 0) return null;
  const settledAt = Number(entry.settledAt);
  return {
    revision,
    seen: Math.min(seen, revision),
    settledAt: Number.isFinite(settledAt) ? settledAt : 0,
    failed: entry.failed === true,
    ...(typeof entry.settleId === "string" ? { settleId: entry.settleId } : {}),
  };
}

/** Validate a whole untrusted ledger; malformed rows drop out. */
export function normalizeOverviewLedger(value: unknown): OverviewReadLedger {
  if (!value || typeof value !== "object") return {};
  const ledger: OverviewReadLedger = {};
  for (const [key, row] of Object.entries(value as Record<string, unknown>)) {
    const entry = normalizeOverviewEntry(row);
    if (entry) ledger[key] = entry;
  }
  return pruneOverviewLedger(ledger);
}
