import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type {
  AgentEvent,
  ChatMessage,
  PersistedComposer,
  SessionSummary,
} from "../src/shared/types";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * The session overview over the real store: which status a row projects after
 * a run settles, what a lost connection is allowed to claim, and how a jump
 * across agents behaves when it works and when the session is gone. Boots a
 * fresh state module per test (it is a singleton) over a scripted window.
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
  updatedAt: 1_726_000_100_000,
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

function assistantRow(error: string | null = null): ChatMessage {
  return { ...USER_ROW, id: "m2", role: "assistant", text: "修好了", error };
}

async function bootState(
  options: {
    runError?: string | null;
    beforeInit?: (api: AweforkApi) => void | Promise<void>;
  } = {},
) {
  vi.resetModules();
  const rows = [USER_ROW, assistantRow(options.runError ?? null)];
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
  let failMessages = false;
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async (backend: BackendId) => ({
      sessions: backend === "codex" ? [CODEX_C1] : [OPENCODE_S1],
      lineage: {},
    }),
    messages: async (_backend, sessionId) => {
      if (failMessages) throw new Error("backend gone");
      return sessionId === "c1" ? [{ ...USER_ROW, id: "c1m1" }] : rows;
    },
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
    capabilities: async () => ({ deleteMessage: true, attachments: true, fileChanges: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({
      currentVersion: "0.2.1",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (handler: (envelope: BackendEventEnvelope) => void) => {
      onEnvelope = handler;
      return () => {};
    },
    ...createOverviewLedgerMock(),
  };
  await options.beforeInit?.(api);
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return {
    api,
    state,
    store: state.store,
    send: (backend: BackendId, event: AgentEvent) => onEnvelope?.({ backend, event }),
    failMessages: (value: boolean) => {
      failMessages = value;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // The ledger persists through localStorage; keep every test isolated.
  const map = new Map<string, string>();
  // The overview is a labs feature — off by default. It must be on in storage
  // before the settings module boots (state reads it at import time), or
  // refreshOverviewSessions turns into a no-op and no row ever lists.
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

function rowOf(h: Awaited<ReturnType<typeof bootState>>, backend: BackendId, id: string) {
  return h.state.overviewRows.value.find((row) => row.backend === backend && row.session.id === id);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function prepareNavigation(h: Awaited<ReturnType<typeof bootState>>, target = "c1") {
  const turn = h.state.turnGraph.value.nodes.find((node) => node.kind === "turn");
  if (turn?.kind !== "turn") throw new Error("missing original turn");
  await h.state.selectTurn(turn);
  h.state.openOverviewPanel();
  await vi.advanceTimersByTimeAsync(0);
  await h.api.overviewRecordSettle("codex", target, false, "unseen-result");
  const ledger = { ...h.store.overviewRead };
  const markSeen = vi.fn(h.api.overviewMarkSeen);
  h.api.overviewMarkSeen = markSeen;
  return { turnId: turn.id, ledger, markSeen };
}

function expectFailedNavigation(
  h: Awaited<ReturnType<typeof bootState>>,
  original: Awaited<ReturnType<typeof prepareNavigation>>,
) {
  expect(h.store.activeBackend).toBe("opencode");
  expect(h.store.selectedId).toBe("s1");
  expect(h.store.selectedTurnId).toBe(original.turnId);
  expect(h.store.overview.open).toBe(true);
  expect(h.store.overview.error).toBeTruthy();
  expect(h.store.overview.jumpingKey).toBeNull();
  expect(h.store.overviewRead).toEqual(original.ledger);
  expect(original.markSeen).not.toHaveBeenCalled();
}

/**
 * Seed the tab preference before the state module boots: settings are read
 * from storage at import time, so the flag has to be in place before
 * bootState imports the module under test.
 */
function seedTabPreference(sessionsInNewTab: boolean): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(
    "awefork:settings",
    JSON.stringify({ labs: { sessionOverview: true }, canvas: { sessionsInNewTab } }),
  );
}

/** Two unrelated stories in the active backend, so a jump has somewhere to go. */
async function bootTwoStories(sessionsInNewTab: boolean) {
  seedTabPreference(sessionsInNewTab);
  const h = await bootState();
  const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
  const sessions = api.sessions;
  api.sessions = async (backend: BackendId) =>
    backend === "opencode"
      ? {
          sessions: [OPENCODE_S1, { ...OPENCODE_S1, id: "s2", title: "另一条故事" }],
          lineage: {},
        }
      : sessions(backend);
  await h.state.refreshSessions();
  await h.state.selectSession("s1");
  await vi.advanceTimersByTimeAsync(0);
  return h;
}

/** started → idle, flushing the async finishRun chain. */
async function runAndSettle(
  h: Awaited<ReturnType<typeof bootState>>,
  backend: BackendId,
  sessionId: string,
): Promise<void> {
  h.send(backend, { type: "message.started", sessionId, messageId: "m2" });
  h.send(backend, { type: "session.idle", sessionId });
  await vi.advanceTimersByTimeAsync(1_000);
}

describe("overview rows over the store", () => {
  it("lists the visible backend's sessions and projects them from live state", async () => {
    const h = await bootState();
    expect(rowOf(h, "opencode", "s1")?.status).toBe("idle");
    expect(h.state.overviewStats.value.unknown).toBe(0);
  });

  it("hides agent-spawned subagent sessions from the overview", async () => {
    // Regression: the overview used visibleSessions raw, which drops trash and
    // archive but keeps subagents (buildSessionTree is what hides those). A
    // subagent's run therefore reappeared in the overview as a row the user
    // never saw anywhere else, and its result counted in the trigger's numbers.
    const h = await bootState();
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.sessions = async () => ({
      sessions: [
        { ...OPENCODE_S1 },
        {
          ...OPENCODE_S1,
          id: "sub-1",
          title: "子 agent",
          parentSessionId: "s1",
          origin: "subagent" as const,
        },
      ],
      lineage: {},
    });
    await h.state.refreshSessions();

    // Its parent stays; the subagent is gone from every overview surface.
    expect(rowOf(h, "opencode", "s1")).toBeDefined();
    expect(rowOf(h, "opencode", "sub-1")).toBeUndefined();
    expect(h.state.overviewStats.value.unknown).toBe(0);
    // ...and the run it observed is not attributed to it either.
    h.send("opencode", { type: "message.started", sessionId: "sub-1", messageId: "m2" });
    expect(rowOf(h, "opencode", "sub-1")).toBeUndefined();
    expect(h.state.overviewStats.value.running).toBe(0);
  });

  it("turns a settled run into an unread row, and viewing it into read", async () => {
    const h = await bootState();
    await runAndSettle(h, "opencode", "s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unread");
    expect(h.state.overviewStats.value.unread).toBe(1);

    await h.state.selectSession("s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("read");
    expect(h.state.overviewStats.value.unread).toBe(0);
  });

  it("reports a failed run as failed, not as a new result", async () => {
    const h = await bootState({ runError: "provider 500" });
    await runAndSettle(h, "opencode", "s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("failed");
    expect(h.state.overviewStats.value.unread).toBe(0);

    // Viewing the failure clears the badge without erasing the record.
    await h.state.selectSession("s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("read");
    expect(h.store.overviewRead["opencode:s1"]?.failed).toBe(true);
  });

  it("keeps an explicit failure even when an idle frame follows it", async () => {
    const h = await bootState();
    h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send("opencode", { type: "server.error", message: "boom", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rowOf(h, "opencode", "s1")?.status).toBe("failed");

    // The run's own idle lands afterwards; it must not turn the failure into a
    // "new result" (or a second revision).
    h.send("opencode", { type: "session.idle", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rowOf(h, "opencode", "s1")?.status).toBe("failed");
    expect(h.store.overviewRead["opencode:s1"]?.revision).toBe(1);
  });

  it("counts a run once across repeated errors and the following idle", async () => {
    const h = await bootState();
    h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send("opencode", { type: "server.error", message: "boom", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);
    h.send("opencode", { type: "server.error", message: "boom", sessionId: "s1" });
    h.send("opencode", { type: "session.idle", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.store.overviewRead["opencode:s1"]?.revision).toBe(1);
    expect(h.store.overviewRead["opencode:s1"]?.failed).toBe(true);
  });

  it("keeps one revision when main already recorded the result", async () => {
    // Regression: the settle was folded locally before its IPC and main's
    // answer was merged by max revision. Whenever main deduped the mint —
    // another window had already recorded this message, or this window had
    // observed it earlier — the local copy kept the phantom revision. `seen`
    // could never reach it, so the row stayed 新结果 in that window until it
    // restarted, no matter which window the user viewed the result in.
    const h = await bootState();
    await h.api.overviewRecordSettle("opencode", "s1", false, "message:opencode:s1:m2");
    expect(h.store.overviewRead["opencode:s1"]?.revision).toBe(1);
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unread");

    await runAndSettle(h, "opencode", "s1");

    expect(h.store.overviewRead["opencode:s1"]?.revision).toBe(1);
    // Viewing it clears the badge instead of chasing a revision only this
    // window believes in.
    await h.state.selectSession("s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("read");
    expect(h.state.overviewStats.value.unread).toBe(0);
  });

  it("records the result locally when the ledger write fails", async () => {
    // The offline path keeps its own fold: an unreachable main process still
    // shows the badge, and the boot merge carries the revision back later.
    const h = await bootState();
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.overviewRecordSettle = async () => {
      throw new Error("main gone");
    };

    await runAndSettle(h, "opencode", "s1");

    expect(h.store.overviewRead["opencode:s1"]?.revision).toBe(1);
    expect(h.store.overviewRead["opencode:s1"]?.settleId).toBe("message:opencode:s1:m2");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unread");
  });

  it("calls a silent watchdog timeout unknown instead of minting a result", async () => {
    const h = await bootState();
    h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m2" });
    // Nothing ever completes and no delta arrives: the watchdog runs out of
    // patience (160 ticks) and must not claim the run finished.
    await vi.advanceTimersByTimeAsync(161 * 1500);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.state.overviewRows.value.find((row) => row.session.id === "s1")?.status).toBe(
      "unknown",
    );
    expect(h.store.overviewRead["opencode:s1"]).toBeUndefined();
  });

  it("calls a lost connection unknown, not failed", async () => {
    const h = await bootState();
    h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m2" });
    h.failMessages(true);
    await vi.advanceTimersByTimeAsync(20 * 1500);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.state.overviewRows.value.find((row) => row.session.id === "s1")?.status).toBe(
      "unknown",
    );
    h.failMessages(false);
    await h.state.selectSession("s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unknown");
  });

  it("counts a queued ask as 等你处理 above everything else", async () => {
    const h = await bootState();
    h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send("opencode", {
      type: "interaction.requested",
      request: {
        requestId: "req-1",
        sessionId: "s1",
        kind: "command-approval",
        title: "允许执行命令？",
        detail: "rm -rf node_modules",
        command: "rm -rf node_modules",
      },
    });
    expect(rowOf(h, "opencode", "s1")?.status).toBe("waiting");
    expect(rowOf(h, "opencode", "s1")?.pending).toBe(1);
  });

  it("lists another agent's sessions once the panel refreshes them", async () => {
    const h = await bootState();
    expect(h.state.overviewRows.value.map((row) => row.backend)).toEqual(["opencode"]);

    h.state.openOverviewPanel();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.overview.open).toBe(true);
    expect(rowOf(h, "codex", "c1")?.status).toBe("idle");
    expect(h.state.overviewStats.value.unknown).toBe(0);
    expect(h.state.overviewAgents.value).toEqual(["opencode", "codex"]);
  });

  it("fills the trigger counts with one delayed boot sweep", async () => {
    const h = await bootState();
    expect(rowOf(h, "codex", "c1")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(rowOf(h, "codex", "c1")?.status).toBe("idle");
    expect(h.state.overviewStats.value.unknown).toBe(0);
  });

  it("keeps a backend's explicit unknown status", async () => {
    const h = await bootState({
      beforeInit: (api) => {
        api.sessions = async (backend) => ({
          sessions: [
            { ...(backend === "codex" ? CODEX_C1 : OPENCODE_S1), runtimeStatus: "unknown" },
          ],
          lineage: {},
        });
      },
    });
    await h.state.refreshOverviewSessions();
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unknown");
    expect(rowOf(h, "codex", "c1")?.status).toBe("unknown");
    expect(h.state.overviewStats.value.unknown).toBe(2);
  });

  it("restores a persisted unknown marker until an explicit idle event resolves it", async () => {
    const h = await bootState({
      beforeInit: async (api) => {
        await api.overviewSetUnknown("opencode", "s1", true, "previous-launch-run");
      },
    });
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unknown");
    expect(h.state.overviewStats.value.unknown).toBe(1);
    h.send("opencode", { type: "session.idle", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(0);

    expect(rowOf(h, "opencode", "s1")?.status).toBe("idle");
    expect(h.state.overviewStats.value.unknown).toBe(0);
    expect(h.store.overviewUnknown["opencode:s1"]).toBeUndefined();
    expect((await h.api.overviewLedger()).unknown["opencode:s1"]).toBeUndefined();
    expect(h.store.overviewRead["opencode:s1"]).toBeUndefined();
  });

  it("keeps one agent's listing failure from blanking the others", async () => {
    const h = await bootState();
    const sessions = h.state.refreshOverviewSessions;
    // Codex's list dies; opencode's own rows come from the live workspace.
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.sessions = async (backend: BackendId) => {
      if (backend === "codex") throw new Error("codex server down");
      return { sessions: [OPENCODE_S1], lineage: {} };
    };
    await sessions();
    expect(h.state.overviewRemoteError("codex")).toBe("codex server down");
    expect(rowOf(h, "opencode", "s1")).toBeDefined();
  });

  it("keeps the parked session list and reports when its refresh is stale", async () => {
    const h = await bootState();
    h.state.openOverviewPanel();
    await vi.advanceTimersByTimeAsync(0);
    await h.state.switchBackend("codex");
    await h.state.switchBackend("opencode");
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.sessions = async (backend: BackendId) => {
      if (backend === "codex") throw new Error("codex server down");
      return { sessions: [OPENCODE_S1], lineage: {} };
    };

    await h.state.refreshOverviewSessions();

    expect(rowOf(h, "codex", "c1")?.session.title).toBe(CODEX_C1.title);
    expect(h.state.overviewRemoteError("codex")).toBe("codex server down");
  });
});

describe("overview navigation", () => {
  it("jumps across agents, closes the panel and marks the result seen", async () => {
    const h = await bootState();
    h.state.openOverviewPanel();
    await vi.advanceTimersByTimeAsync(0);

    // A result on the codex session, unseen.
    h.send("codex", { type: "message.started", sessionId: "c1", messageId: "m2" });
    h.send("codex", { type: "session.idle", sessionId: "c1" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rowOf(h, "codex", "c1")?.status).toBe("unread");

    const landed = await h.state.jumpToOverviewSession("codex", "c1");
    expect(landed).toBe(true);
    expect(h.store.activeBackend).toBe("codex");
    expect(h.store.selectedId).toBe("c1");
    expect(h.store.selectedTurnId).toBeTruthy();
    expect(h.store.turnJumpRequest?.nodeId).toBe(h.store.selectedTurnId);
    expect(h.store.overview.open).toBe(false);
    expect(rowOf(h, "codex", "c1")?.status).toBe("read");
    // The freshly entered workspace owns one blank tab, and the jump lands in
    // it: opening a second tab there would only leave an empty one behind.
    expect(h.store.canvasTabs.length).toBe(1);
  });

  it("opens the target's story in a new tab when the tab preference is on", async () => {
    const h = await bootTwoStories(true);
    expect(h.store.canvasTabs.length).toBe(1);

    const landed = await h.state.jumpToOverviewSession("opencode", "s2");

    expect(landed).toBe(true);
    expect(h.store.selectedId).toBe("s2");
    expect(h.store.overview.open).toBe(false);
    // The story the user was reading stays parked in its own tab.
    expect(h.store.canvasTabs.length).toBe(2);
    expect(h.store.canvasTabs[0]?.selectedId).toBe("s1");
    expect(h.store.canvasTabs[1]?.selectedId).toBe("s2");
  });

  it("switches in place when the tab preference is off", async () => {
    const h = await bootTwoStories(false);
    expect(h.store.canvasTabs.length).toBe(1);

    const landed = await h.state.jumpToOverviewSession("opencode", "s2");

    expect(landed).toBe(true);
    expect(h.store.selectedId).toBe("s2");
    expect(h.store.overview.open).toBe(false);
    expect(h.store.canvasTabs.length).toBe(1);
    expect(h.store.canvasTabs[0]?.selectedId).toBe("s2");
  });

  it("switches to the tab an already-open story owns instead of duplicating it", async () => {
    const h = await bootTwoStories(true);
    await h.state.openCanvasTab("s2");
    expect(h.store.canvasTabs.length).toBe(2);
    // Back to the s1 tab, then jump to s2: the jump activates s2's tab.
    await h.state.activateCanvasTab(h.store.canvasTabs[0]?.id ?? "");
    expect(h.store.selectedId).toBe("s1");

    const landed = await h.state.jumpToOverviewSession("opencode", "s2");

    expect(landed).toBe(true);
    expect(h.store.selectedId).toBe("s2");
    expect(h.store.overview.open).toBe(false);
    // One story, one tab — the strip never grows a second s2.
    expect(h.store.canvasTabs.length).toBe(2);
    expect(h.store.canvasTabs.filter((t) => t.rootId === "s2").length).toBe(1);
  });

  it("lands quietly when the target is already the session on screen", async () => {
    const h = await bootTwoStories(true);
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    const messages = vi.fn(api.messages);
    api.messages = messages;

    const landed = await h.state.jumpToOverviewSession("opencode", "s1");

    expect(landed).toBe(true);
    expect(h.store.selectedId).toBe("s1");
    expect(h.store.overview.open).toBe(false);
    // Already on screen: nothing to switch to, no new tab, no reload.
    expect(h.store.canvasTabs.length).toBe(1);
    expect(messages).not.toHaveBeenCalled();
  });

  it("keeps the panel and the unread badge when the session is gone", async () => {
    const h = await bootState();
    const original = await prepareNavigation(h, "deleted-in-tui");

    const landed = await h.state.jumpToOverviewSession("codex", "deleted-in-tui");
    expect(landed).toBe(false);
    expectFailedNavigation(h, original);
  });

  it("returns to the original selection when the target's messages cannot load", async () => {
    const h = await bootState();
    const original = await prepareNavigation(h);
    const messages = h.api.messages;
    h.api.messages = async (backend, sessionId) => {
      if (backend === "codex") throw new Error("message reader unavailable");
      return messages(backend, sessionId);
    };

    expect(await h.state.jumpToOverviewSession("codex", "c1")).toBe(false);

    expectFailedNavigation(h, original);
    expect(h.store.overview.error).toContain("message reader unavailable");
  });

  it.each(["selectBackend", "ready"] as const)(
    "restores the original selection when %s throws an IPC error",
    async (method) => {
      const h = await bootState();
      const original = await prepareNavigation(h);
      h.api[method] = async (backend) => {
        if (backend === "codex") throw new Error("IPC disconnected");
        return { ok: true };
      };

      expect(await h.state.jumpToOverviewSession("codex", "c1")).toBe(false);

      expectFailedNavigation(h, original);
      expect(h.store.overview.error).toContain("IPC disconnected");
    },
  );

  it.each(["refuses", "throws"] as const)(
    "reports when returning to the original backend %s",
    async (failure) => {
      const h = await bootState();
      const original = await prepareNavigation(h, "deleted-in-tui");
      h.api.selectBackend = async (backend) => {
        if (backend === "opencode") {
          if (failure === "throws") throw new Error("return unavailable");
          return { ok: false, error: "return unavailable" };
        }
        return { ok: true };
      };

      expect(await h.state.jumpToOverviewSession("codex", "deleted-in-tui")).toBe(false);

      expect(h.store.activeBackend).toBe("codex");
      expect(h.store.overview.open).toBe(true);
      expect(h.store.overview.error).toMatch(/未能返回|couldn't return/i);
      expect(h.store.overview.error).toMatch(/找不到这条会话|That session is gone/);
      expect(h.store.overview.error).toContain("opencode");
      expect(h.store.overview.error).toContain("return unavailable");
      expect(h.store.overviewRead).toEqual(original.ledger);
      expect(original.markSeen).not.toHaveBeenCalled();
    },
  );

  it("keeps an unrelated result unread when a cached backend revalidates during a failed jump", async () => {
    const h = await bootState();
    await h.state.switchBackend("codex");
    await h.state.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(0);
    const original = await prepareNavigation(h, "c2");
    const sessions = h.api.sessions;
    const refresh = vi.fn(async (backend: BackendId) =>
      backend === "codex"
        ? { sessions: [{ ...CODEX_C1, id: "c2" }], lineage: {} }
        : sessions(backend),
    );
    h.api.sessions = refresh;

    expect(await h.state.jumpToOverviewSession("codex", "deleted-in-tui")).toBe(false);
    await vi.advanceTimersByTimeAsync(0);

    expectFailedNavigation(h, original);
    expect(h.store.overviewRead["codex:c2"]?.seen).toBe(0);
    expect(refresh.mock.calls.filter(([backend]) => backend === "codex").length).toBeGreaterThan(1);
  });

  it.each([true, false])(
    "ignores a cached backend's delayed ready result after returning (ok=%s)",
    async (ok) => {
      const h = await bootState();
      await h.state.switchBackend("codex");
      await h.state.switchBackend("opencode");
      await vi.advanceTimersByTimeAsync(0);
      const original = await prepareNavigation(h, "deleted-in-tui");
      const ready = deferred<Awaited<ReturnType<AweforkApi["ready"]>>>();
      h.api.ready = async (backend) => (backend === "codex" ? ready.promise : { ok: true });
      const sessions = vi.fn(h.api.sessions);
      h.api.sessions = sessions;

      expect(await h.state.jumpToOverviewSession("codex", "deleted-in-tui")).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      const callsBeforeOldReady = sessions.mock.calls.length;
      ready.resolve({ ok, error: "stale codex ready" });
      await vi.advanceTimersByTimeAsync(0);

      expectFailedNavigation(h, original);
      expect(sessions).toHaveBeenCalledTimes(callsBeforeOldReady);
      expect(h.store.connectionError).toBeNull();
    },
  );

  it.each([false, true])(
    "preserves a backend the user selects while a jump is loading (switch pending=%s)",
    async (switchPending) => {
      const h = await bootState();
      await h.state.switchBackend("codex");
      await h.state.switchBackend("opencode");
      await vi.advanceTimersByTimeAsync(0);
      const original = await prepareNavigation(h);
      const sessions = h.api.sessions;
      h.api.sessions = async (backend) =>
        backend === "pi"
          ? { sessions: [{ ...OPENCODE_S1, id: "p1" }], lineage: {} }
          : backend === "codex"
            ? { sessions: [CODEX_C1, { ...CODEX_C1, id: "c2" }], lineage: {} }
            : sessions(backend);
      const messages = h.api.messages;
      const loading = deferred<void>();
      const pending = deferred<ChatMessage[]>();
      h.api.messages = async (backend, sessionId) => {
        if (backend === "codex" && sessionId === "c2") {
          loading.resolve();
          return pending.promise;
        }
        return messages(backend, sessionId);
      };
      const select = h.api.selectBackend;
      const switching = deferred<void>();
      const selected = deferred<Awaited<ReturnType<AweforkApi["selectBackend"]>>>();
      const selectBackend = vi.fn(async (backend: BackendId) => {
        if (backend === "pi" && switchPending) {
          switching.resolve();
          return selected.promise;
        }
        return select(backend);
      });
      h.api.selectBackend = selectBackend;

      const jump = h.state.jumpToOverviewSession("codex", "c2");
      await loading.promise;
      const manualSwitch = h.state.switchBackend("pi");
      if (switchPending) await switching.promise;
      else await manualSwitch;
      pending.resolve([{ ...USER_ROW, id: "c1m1" }]);

      expect(await jump).toBe(false);
      if (switchPending) {
        selected.resolve({ ok: true });
        await manualSwitch;
      }
      expect(h.store.activeBackend).toBe("pi");
      expect(h.store.selectedId).toBe("p1");
      expect(h.store.overview.open).toBe(true);
      expect(h.store.overview.error).toBeTruthy();
      expect(h.store.overviewRead).toEqual(original.ledger);
      expect(original.markSeen.mock.calls.map(([backend]) => backend)).toEqual(["pi"]);
      expect(selectBackend.mock.calls.map(([backend]) => backend)).toEqual(["codex", "pi"]);
    },
  );

  it("keeps the panel open when the target backend refuses the switch", async () => {
    const h = await bootState();
    h.state.openOverviewPanel();
    await vi.advanceTimersByTimeAsync(0);
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.selectBackend = async () => ({ ok: false, error: "codex CLI missing" });

    const landed = await h.state.jumpToOverviewSession("codex", "c1");
    expect(landed).toBe(false);
    expect(h.store.activeBackend).toBe("opencode");
    expect(h.store.overview.open).toBe(true);
    expect(h.store.overview.error).toBeTruthy();
  });

  it("does not clear a result that landed while the jump was loading", async () => {
    const h = await bootState();
    h.state.openOverviewPanel();
    await vi.advanceTimersByTimeAsync(0);
    // A second story, selected, so the jump to s1 really loads its messages
    // (a jump to the session already on screen switches nothing and reloads
    // nothing — there is no load to land a result in).
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    const sessions = api.sessions;
    api.sessions = async (backend: BackendId) =>
      backend === "opencode"
        ? {
            sessions: [OPENCODE_S1, { ...OPENCODE_S1, id: "s2", title: "另一条故事" }],
            lineage: {},
          }
        : sessions(backend);
    await h.state.refreshSessions();
    await h.state.selectSession("s2");
    await runAndSettle(h, "opencode", "s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unread");

    // A second run settles while the jump's message load is in flight; the
    // jump pinned revision 1, so revision 2 has to stay unread.
    const originalMessages = api.messages;
    api.messages = async (backend: BackendId, sessionId: string) => {
      if (sessionId === "s1") {
        h.send("opencode", { type: "message.started", sessionId: "s1", messageId: "m3" });
        h.send("opencode", { type: "session.idle", sessionId: "s1" });
        await Promise.resolve();
      }
      return originalMessages(backend, sessionId);
    };
    await h.state.jumpToOverviewSession("opencode", "s1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.store.overviewRead["opencode:s1"]?.revision).toBe(2);
    expect(h.store.overviewRead["opencode:s1"]?.seen).toBe(1);
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unread");
  });
});

describe("workspace work left pending by a return", () => {
  it("discards an archive prune that finishes after returning to another backend", async () => {
    const opencodeArchive = {
      sessions: [],
      directories: [{ path: "/opencode-archive", archivedAt: 1 }],
    };
    const h = await bootState({
      beforeInit: (api) => {
        api.archive = async (backend) =>
          backend === "codex"
            ? { sessions: [{ id: "c1", archivedAt: 1 }], directories: [] }
            : opencodeArchive;
      },
    });
    await h.state.switchBackend("codex");
    await h.state.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(0);
    const sessions = h.api.sessions;
    h.api.sessions = async (backend) =>
      backend === "codex"
        ? { sessions: [{ ...CODEX_C1, id: "c2" }], lineage: {} }
        : sessions(backend);
    const pruning = deferred<void>();
    const pruned = deferred<Awaited<ReturnType<AweforkApi["archiveRemove"]>>>();
    h.api.archiveRemove = async (backend) => {
      if (backend === "codex") {
        pruning.resolve();
        return pruned.promise;
      }
      return opencodeArchive;
    };
    const messages = vi.fn(h.api.messages);
    h.api.messages = messages;

    await h.state.switchBackend("codex");
    await pruning.promise;
    await h.state.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(0);
    pruned.resolve({
      sessions: [],
      directories: [{ path: "/codex-archive", archivedAt: 2 }],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.store.activeBackend).toBe("opencode");
    expect(h.store.archive).toEqual(opencodeArchive);
    expect(h.store.selectedId).toBe("s1");
    expect(messages.mock.calls.some(([backend, id]) => backend === "opencode" && id === "c2")).toBe(
      false,
    );
  });

  it.each(["composer", "anchor"] as const)(
    "discards a stale %s restore after returning to another backend",
    async (phase) => {
      const ownModel = { providerId: "opencode", modelId: "own-model" };
      const targetModel = { providerId: "codex", modelId: "target-model" };
      const originalComposer: PersistedComposer = {
        draft: {
          sessionId: "s1",
          atMessageId: null,
          text: "opencode draft",
          model: ownModel,
          attachments: [],
        },
        paneModels: { s1: ownModel },
        lastModel: ownModel,
        favoriteModels: [ownModel],
        recentModels: [ownModel],
      };
      const targetComposer: PersistedComposer = {
        draft: {
          sessionId: "c1",
          atMessageId: null,
          text: "codex draft",
          model: targetModel,
          attachments: [],
        },
        paneModels: { c1: targetModel },
        lastModel: targetModel,
        favoriteModels: [targetModel],
        recentModels: [targetModel],
      };
      const h = await bootState({
        beforeInit: (api) => {
          api.composer = async (backend) => (backend === "opencode" ? originalComposer : null);
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      await h.state.switchBackend("codex");
      await vi.advanceTimersByTimeAsync(0);
      await h.state.switchBackend("opencode");
      await vi.advanceTimersByTimeAsync(0);
      const started = deferred<void>();
      const composer = deferred<PersistedComposer>();
      const anchor = deferred<ChatMessage[]>();
      h.api.composer = async (backend) => {
        if (backend === "opencode") return originalComposer;
        if (phase === "composer") {
          started.resolve();
          return composer.promise;
        }
        return targetComposer;
      };
      const originalMessages = h.api.messages;
      const messages = vi.fn(async (backend: BackendId, sessionId: string) => {
        if (phase === "anchor" && backend === "codex" && sessionId === "c1") {
          started.resolve();
          return anchor.promise;
        }
        return originalMessages(backend, sessionId);
      });
      h.api.messages = messages;

      await h.state.switchBackend("codex");
      await started.promise;
      await h.state.switchBackend("opencode");
      await vi.advanceTimersByTimeAsync(0);
      composer.resolve(targetComposer);
      anchor.resolve([{ ...USER_ROW, id: "c1m1" }]);
      await vi.advanceTimersByTimeAsync(0);

      expect(h.store.activeBackend).toBe("opencode");
      expect(h.store.selectedId).toBe("s1");
      expect(h.store.draft).toMatchObject({
        sessionId: "s1",
        text: "opencode draft",
        model: ownModel,
      });
      expect(h.store.paneModels).toEqual({ s1: ownModel });
      expect(h.store.lastModel).toEqual(ownModel);
      expect(h.store.favoriteModels).toEqual([ownModel]);
      expect(h.store.recentModels).toEqual([ownModel]);
      expect(
        messages.mock.calls.some(([backend, id]) => backend === "opencode" && id === "c1"),
      ).toBe(false);
    },
  );
});
