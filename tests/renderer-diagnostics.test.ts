import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope } from "../src/shared/backend";
import type { DiagnosticEntry } from "../src/shared/diagnostics";
import type { ChatMessage, SessionSummary } from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Status-panel state: the renderer half of the diagnostics buffer. The state
 * module is a singleton, so every test boots a fresh instance via
 * vi.resetModules + dynamic import, backed by a scripted window.awefork whose
 * diagnostics side is the in-memory mock (emit = main's broadcast).
 */

const SESSION: SessionSummary = {
  id: "s1",
  title: "登录接口排查",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

function entry(seq: number, level: DiagnosticEntry["level"], text: string): DiagnosticEntry {
  return { seq, at: 1_726_000_000_000 + seq, level, text };
}

async function boot(seed: DiagnosticEntry[] = [], options: { gateSnapshot?: boolean } = {}) {
  vi.resetModules();
  const diagnostics = createDiagnosticsMock(seed, options);
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [SESSION], lineage: {} }),
    messages: async (): Promise<ChatMessage[]> => [],
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => SESSION,
    fork: async () => SESSION,
    deleteSession: async () => [],
    deleteMessage: async () => {},
    prompt: async () => {},
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: async () => {},
    openSessionTerminal: async () => ({ ok: true }),
    pins: async () => [],
    togglePin: async () => [],
    dirs: async () => [],
    pickDirectory: async () => null,
    trash: async () => [],
    trashAdd: async () => [],
    trashRemove: async () => [],
    archive: async () => ({ sessions: [], directories: [] }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: async () => ({ sessions: [], directories: [] }),
    composer: async () => null,
    saveComposer: async () => {},
    backends: async () => ({
      selected: "opencode",
      backends: [
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.5.6", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (_handler: (envelope: BackendEventEnvelope) => void) => () => {},
    ...createOverviewLedgerMock(),
    ...createOverviewCacheMock(),
    ...diagnostics,
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return { store: state.store, mod: state, diagnostics };
}

/** Let the gated boot snapshot resolve and its .then land. */
async function settle(harness: Awaited<ReturnType<typeof boot>>): Promise<void> {
  harness.diagnostics.releaseSnapshot();
  await vi.waitFor(() => {
    expect(harness.store.diagnostics.length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("renderer diagnostics state", () => {
  it("seeds the panel from the app-global snapshot at boot", async () => {
    const { store } = await boot([entry(1, "error", "opencode serve exited (code=1)")]);

    expect(store.diagnostics.map((e) => e.text)).toEqual(["opencode serve exited (code=1)"]);
  });

  it("appends entries from the live feed", async () => {
    const { store, diagnostics } = await boot();

    diagnostics.emit({ entry: entry(1, "warn", "subscribing to codex events failed") });

    expect(store.diagnostics.map((e) => e.text)).toEqual(["subscribing to codex events failed"]);
  });

  it("empties on the app-global clear broadcast", async () => {
    const { store, mod, diagnostics } = await boot([entry(1, "error", "old failure")]);

    await mod.clearDiagnostics();

    expect(store.diagnostics).toEqual([]);
    expect(diagnostics.entries).toEqual([]);
  });

  it("counts unseen errors, and warns do not badge", async () => {
    const { mod, diagnostics } = await boot();

    diagnostics.emit({ entry: entry(1, "warn", "a warning") });
    expect(mod.unseenErrorCount.value).toBe(0);

    diagnostics.emit({ entry: entry(2, "error", "a failure") });
    expect(mod.unseenErrorCount.value).toBe(1);

    diagnostics.emit({ entry: entry(3, "error", "another failure") });
    expect(mod.unseenErrorCount.value).toBe(2);
  });

  it("marking the panel seen clears the badge but keeps the entries", async () => {
    const { store, mod, diagnostics } = await boot();
    diagnostics.emit({ entry: entry(1, "error", "a failure") });

    mod.markDiagnosticsSeen();

    expect(mod.unseenErrorCount.value).toBe(0);
    expect(store.diagnostics).toHaveLength(1);
  });

  it("merges a late boot snapshot instead of dropping what streamed in", async () => {
    // A backend spawn failing while the window is still booting is exactly
    // when entries stream before the snapshot resolves: the merge is by seq,
    // so nothing is lost and nothing is duplicated.
    const harness = await boot([], { gateSnapshot: true });
    harness.diagnostics.emit({ entry: entry(1, "error", "streamed first") });
    harness.diagnostics.emit({ entry: entry(2, "warn", "streamed second") });

    await settle(harness);

    expect(harness.store.diagnostics.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("a snapshot that lands with unseen entries still badges them", async () => {
    const harness = await boot([entry(7, "error", "failed before this window opened")], {
      gateSnapshot: true,
    });

    await settle(harness);

    expect(harness.mod.unseenErrorCount.value).toBe(1);
  });
});
