import type { AweforkApi } from "../../src/shared/awefork-api";
import type { DiagnosticEntry, DiagnosticUpdate } from "../../src/shared/diagnostics";

/**
 * In-memory stand-in for the main-owned diagnostics buffer, for tests that
 * boot the real state module without a main process. `emit` is the test's
 * handle on main's broadcast (a new entry, or the app-global clear);
 * `clearDiagnostics` mirrors main's semantics — the buffer empties and every
 * subscriber is told, so a window's list converges without local mutation.
 *
 * `gateSnapshot` holds the diagnostics() answer until `releaseSnapshot()`
 * fires, which is how a test reproduces entries streaming in while the boot
 * snapshot is still in flight.
 */
export function createDiagnosticsMock(
  initial: DiagnosticEntry[] = [],
  options: { gateSnapshot?: boolean } = {},
): Pick<AweforkApi, "diagnostics" | "clearDiagnostics" | "onDiagnostic"> & {
  entries: DiagnosticEntry[];
  emit(update: DiagnosticUpdate): void;
  releaseSnapshot(): void;
} {
  const entries = [...initial];
  const handlers = new Set<(update: DiagnosticUpdate) => void>();
  let releaseSnapshot: (() => void) | null = null;
  const gate = options.gateSnapshot
    ? new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      })
    : null;
  const broadcast = (update: DiagnosticUpdate): void => {
    if (update.entry) entries.push(update.entry);
    if (update.cleared) entries.length = 0;
    for (const handler of handlers) handler(update);
  };
  return {
    entries,
    diagnostics: async () => {
      if (gate) await gate;
      return [...entries];
    },
    clearDiagnostics: async () => broadcast({ cleared: true }),
    onDiagnostic: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit: broadcast,
    releaseSnapshot: () => releaseSnapshot?.(),
  };
}
