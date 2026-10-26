import type { AweforkApi } from "../../src/shared/awefork-api";
import type { BackendId } from "../../src/shared/backend";
import {
  mergeOverviewLedger,
  type OverviewReadEntry,
  type OverviewReadLedger,
  overviewKey,
  recordOverviewSettle,
} from "../../src/shared/overview-ledger-types";

/**
 * In-memory stand-in for the main-owned overview unread ledger, for tests
 * that boot the real state module without a main process. The folds are the
 * shared pure ones; the store (serialized write, file, broadcast) is what a
 * real install adds.
 */
export function createOverviewLedgerMock(): Pick<
  AweforkApi,
  | "overviewLedger"
  | "overviewObserveSessions"
  | "overviewRecordSettle"
  | "overviewSetUnknown"
  | "overviewMarkSeen"
  | "overviewForget"
  | "overviewMergeLedger"
  | "onOverviewRead"
> {
  const ledger: OverviewReadLedger = {};
  const unknown = new Map<string, string>();
  const observedAt: Record<string, number> = {};
  const scannedAt: Record<string, number> = {};
  const handlers = new Set<
    (update: {
      sequence: number;
      key: string;
      entry?: OverviewReadEntry | null;
      unknown?: string | null;
    }) => void
  >();
  let sequence = 0;
  const broadcast = (
    key: string,
    entry?: OverviewReadEntry | null,
    isUnknown?: string | null,
  ): void => {
    const update = {
      sequence: ++sequence,
      key,
      ...(entry !== undefined ? { entry } : {}),
      ...(isUnknown !== undefined ? { unknown: isUnknown } : {}),
    };
    for (const handler of handlers) handler(update);
  };
  return {
    overviewLedger: async () => ({
      sequence,
      ledger: { ...ledger },
      unknown: Object.fromEntries(unknown),
      observedAt: { ...observedAt },
      scannedAt: { ...scannedAt },
    }),
    overviewObserveSessions: async (backend, sessions, requestedAt) => {
      for (const session of sessions) {
        const key = overviewKey(backend, session.id);
        observedAt[key] = Math.max(observedAt[key] ?? 0, session.updatedAt);
      }
      scannedAt[backend] = Math.max(scannedAt[backend] ?? 0, requestedAt);
      return scannedAt[backend] ?? requestedAt;
    },
    overviewRecordSettle: async (
      backend: BackendId,
      sessionId: string,
      failed: boolean,
      settleId?: string,
      runId?: string,
    ) => {
      const key = overviewKey(backend, sessionId);
      const next = recordOverviewSettle(ledger, key, {
        settledAt: Date.now(),
        failed,
        settleId,
      });
      if (next !== ledger) {
        for (const oldKey of Object.keys(ledger)) delete ledger[oldKey];
        Object.assign(ledger, next);
        const marker = unknown.get(key);
        const settledRunId = runId ?? settleId;
        const unknownCleared =
          marker !== undefined && (!marker || !settledRunId || marker === settledRunId);
        if (unknownCleared) unknown.delete(key);
        broadcast(key, ledger[key] ?? null, unknownCleared ? null : undefined);
      }
      const entry = ledger[key];
      if (!entry) throw new Error(`missing mock ledger entry ${key}`);
      return entry;
    },
    overviewSetUnknown: async (
      backend: BackendId,
      sessionId: string,
      isUnknown: boolean,
      runId?: string,
    ) => {
      const key = overviewKey(backend, sessionId);
      const current = unknown.get(key);
      if (isUnknown) {
        const next = runId ?? current ?? "";
        if (current === next) return true;
        unknown.set(key, next);
        broadcast(key, undefined, next);
        return true;
      }
      if (current === undefined) return false;
      if (runId !== undefined && current !== runId) return true;
      unknown.delete(key);
      broadcast(key, undefined, null);
      return false;
    },
    overviewMarkSeen: async (backend: BackendId, sessionId: string, upTo?: number) => {
      const key = overviewKey(backend, sessionId);
      const prev = ledger[key];
      if (!prev) return null;
      const target = Math.min(upTo ?? prev.revision, prev.revision);
      if (prev.seen >= target) return prev;
      const entry = { ...prev, seen: target };
      ledger[key] = entry;
      broadcast(key, entry);
      return entry;
    },
    overviewForget: async (backend: BackendId, sessionId: string) => {
      const key = overviewKey(backend, sessionId);
      const forgotten = delete ledger[key];
      const forgotUnknown = unknown.delete(key);
      delete observedAt[overviewKey(backend, sessionId)];
      if (forgotten || forgotUnknown) broadcast(key, null, null);
      return forgotten;
    },
    overviewMergeLedger: async (incoming: OverviewReadLedger) => {
      const merged = mergeOverviewLedger(ledger, incoming);
      const changed = Object.entries(merged).filter(
        ([key, entry]) => JSON.stringify(ledger[key]) !== JSON.stringify(entry),
      );
      for (const key of Object.keys(ledger)) {
        if (!(key in merged)) delete ledger[key];
      }
      Object.assign(ledger, merged);
      for (const [key, entry] of changed) {
        const marker = unknown.get(key);
        const unknownCleared = marker !== undefined && (!marker || marker === entry.settleId);
        if (unknownCleared) unknown.delete(key);
        broadcast(key, entry, unknownCleared ? null : undefined);
      }
      return { ...ledger };
    },
    onOverviewRead: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/**
 * Stand-in for the main-owned cross-window overview cache, for single-window
 * tests: an empty listing cache, a publish that stores nothing, no
 * broadcast, and no runs in flight. The multi-window describe in
 * renderer-session-overview-state.test.ts builds a real shared cache.
 */
export function createOverviewCacheMock(): Pick<
  AweforkApi,
  "overviewListings" | "overviewPublishListing" | "onOverviewListing" | "overviewRunning"
> {
  return {
    overviewListings: async () => ({}),
    overviewPublishListing: async () => true,
    onOverviewListing: () => () => {},
    overviewRunning: async () => [],
  };
}
