import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { AgentEvent, ChatMessage, SessionSummary } from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * The sidebar's background-runs row. A window parked on one agent still
 * receives every other backend's events and tracks their runs in the parked
 * runtime (state.backgroundRuns), but nothing on screen said so — the user had
 * to switch to each agent to learn something was still going. This covers the
 * aggregation the row reads, and that it follows the real run state rather than
 * a cached snapshot.
 */

const OPENCODE_S1: SessionSummary = {
  id: "s1",
  title: "登录接口排查",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const CODEX_C1: SessionSummary = {
  ...OPENCODE_S1,
  id: "c1",
  title: "修一下刷新丢会话",
  directory: "/demo/awefork",
};

const USER_ROW: ChatMessage = {
  id: "m1",
  role: "user",
  text: "帮我修一下登录接口",
  thinking: "",
  toolNames: [],
  modelId: null,
  providerId: null,
  variant: null,
  attachmentNames: [],
  createdAt: 1,
  completedAt: 1,
  finish: null,
  outputTokens: null,
  error: null,
};

async function bootState() {
  vi.resetModules();
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async (backend: BackendId) => ({
      sessions: backend === "codex" ? [CODEX_C1] : [OPENCODE_S1],
      lineage: {},
    }),
    messages: async (_backend, sessionId) =>
      sessionId === "c1" ? [{ ...USER_ROW, id: "c1m1" }] : [USER_ROW],
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => OPENCODE_S1,
    fork: async () => OPENCODE_S1,
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
    tags: async () => ({ sessions: {}, colors: {} }),
    setSessionTags: async () => ({ sessions: {}, colors: {} }),
    setTagColor: async () => ({ sessions: {}, colors: {} }),
    deleteTag: async () => ({ sessions: {}, colors: {} }),
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
        { id: "codex", label: "codex", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({ deleteMessage: true, attachments: true, fileChanges: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.2.1", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (handler) => {
      onEnvelope = handler;
      return () => {};
    },
    overviewListings: async () => ({}),
    overviewPublishListing: async () => true,
    onOverviewListing: () => () => {},
    overviewRunning: async () => [],
    overviewBadge: async () => true,
    ...createOverviewLedgerMock(),
    ...createDiagnosticsMock(),
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return {
    state,
    store: state.store,
    send: (backend: BackendId, event: AgentEvent) => onEnvelope?.({ backend, event }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  const map = new Map<string, string>();
  map.set("awefork:settings", JSON.stringify({ labs: { sessionOverview: true } }));
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe("sidebar background-run counts", () => {
  it("counts a parked backend's in-flight runs", async () => {
    const h = await bootState();
    expect(h.state.backgroundRunCounts.value).toEqual([]);

    h.send("codex", { type: "message.started", sessionId: "c1", messageId: "m2" });

    expect(h.state.backgroundRunCounts.value).toEqual([{ backend: "codex", count: 1 }]);
  });

  it("drops the count once the parked run ends", async () => {
    const h = await bootState();
    h.send("codex", { type: "message.started", sessionId: "c1", messageId: "m2" });
    expect(h.state.backgroundRunCounts.value).toEqual([{ backend: "codex", count: 1 }]);

    h.send("codex", { type: "session.idle", sessionId: "c1" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.state.backgroundRunCounts.value).toEqual([]);
  });

  it("counts several parked runs in one backend", async () => {
    const h = await bootState();
    h.send("codex", { type: "message.started", sessionId: "c1", messageId: "m2" });
    h.send("codex", { type: "message.started", sessionId: "c2", messageId: "m3" });

    expect(h.state.backgroundRunCounts.value).toEqual([{ backend: "codex", count: 2 }]);
  });

  it("never counts the active backend — its runs are already on screen", async () => {
    const h = await bootState();
    h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m2" });

    expect(h.state.backgroundRunCounts.value).toEqual([]);
  });

  it("orders the rows by the switcher's backend order", async () => {
    const h = await bootState();
    h.send("codex", { type: "message.started", sessionId: "c1", messageId: "m2" });
    // The backend list decides the order, not the order runs arrived in, so
    // the row does not reshuffle as different agents start and finish.
    expect(h.state.backgroundRunCounts.value.map((entry) => entry.backend)).toEqual(["codex"]);
  });

  it("keeps the count across a switch back and forth", async () => {
    const h = await bootState();
    h.send("codex", { type: "message.started", sessionId: "c1", messageId: "m2" });
    expect(h.state.backgroundRunCounts.value).toEqual([{ backend: "codex", count: 1 }]);

    // Park codex's run, visit opencode, come back: the run is still in flight.
    await h.state.switchBackend("codex");
    await vi.advanceTimersByTimeAsync(1_000);
    // Now codex is the active backend, so its run is on screen, not in the row.
    expect(h.state.backgroundRunCounts.value).toEqual([]);

    await h.state.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.state.backgroundRunCounts.value).toEqual([{ backend: "codex", count: 1 }]);
  });
});
