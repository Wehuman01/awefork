import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { AgentEvent, ChatMessage, SessionSummary } from "../src/shared/types";
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

async function bootState(options: { runError?: string | null } = {}) {
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
    dirsAdd: async (_backend, directory) => [directory],
    dirsRemove: async () => [],
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
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return {
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
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unknown");
    expect(h.state.overviewStats.value.unknown).toBe(1);
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
    expect(rowOf(h, "codex", "c1")?.status).toBe("unknown");
    expect(h.state.overviewAgents.value).toEqual(["opencode", "codex"]);
  });

  it("fills the trigger counts with one delayed boot sweep", async () => {
    const h = await bootState();
    expect(rowOf(h, "codex", "c1")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(rowOf(h, "codex", "c1")?.status).toBe("unknown");
    expect(h.state.overviewStats.value.unknown).toBe(2);
  });

  it("uses an explicit idle event to resolve a session's unknown status", async () => {
    const h = await bootState();
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unknown");

    h.send("opencode", { type: "session.idle", sessionId: "s1" });

    expect(rowOf(h, "opencode", "s1")?.status).toBe("idle");
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
  });

  it("keeps the panel and the unread badge when the session is gone", async () => {
    const h = await bootState();
    h.state.openOverviewPanel();
    await vi.advanceTimersByTimeAsync(0);

    const landed = await h.state.jumpToOverviewSession("codex", "deleted-in-tui");
    expect(landed).toBe(false);
    expect(h.store.overview.open).toBe(true);
    expect(h.store.overview.error).toBeTruthy();
    // The switch already landed (it precedes the existence check), so the
    // session is simply not selected — the panel never claims it arrived.
    expect(h.store.selectedId).not.toBe("deleted-in-tui");
  });

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
    await runAndSettle(h, "opencode", "s1");
    expect(rowOf(h, "opencode", "s1")?.status).toBe("unread");

    // A second run settles while the jump's message load is in flight; the
    // jump pinned revision 1, so revision 2 has to stay unread.
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
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
