import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi, TagStore } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";

/**
 * Backend-switch cache regression harness: the state module is a singleton,
 * so every test boots a fresh instance via vi.resetModules + dynamic import,
 * backed by a scripted window.awefork. The app starts on opencode with
 * session s1; codex boots with session c1. The scripted opencode session
 * list is mutable so a test can play "the TUI created a session while the
 * backend was parked".
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

const OPENCODE_S2: SessionSummary = {
  ...OPENCODE_S1,
  id: "s2",
  title: "终端里新开的会话",
  updatedAt: OPENCODE_S1.updatedAt + 1000,
};

const CODEX_C1: SessionSummary = {
  ...OPENCODE_S1,
  id: "c1",
  title: "codex 会话",
};

const S1_USER: ChatMessage = {
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

async function bootState(
  options: { archive?: { sessions: { id: string; archivedAt: number }[] } } = {},
) {
  vi.resetModules();
  let opencodeSessions = [OPENCODE_S1];
  const messagesCalls: Array<{ backend: BackendId; sessionId: string }> = [];
  const opencodeTags: TagStore = { sessions: { s1: ["执行"] }, colors: {} };
  const codexTags: TagStore = { sessions: { c1: ["评审"] }, colors: {} };
  const api: AweforkApi = {
    ready: vi.fn(async () => ({ ok: true })),
    sessions: vi.fn(async (backend: BackendId) =>
      backend === "codex"
        ? { sessions: [CODEX_C1], lineage: {} }
        : { sessions: [...opencodeSessions], lineage: {} },
    ),
    messages: vi.fn(async (backend: BackendId, sessionId: string) => {
      messagesCalls.push({ backend, sessionId });
      return sessionId === "s1" ? [S1_USER] : [];
    }),
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
    tags: vi.fn(
      async (backend: BackendId): Promise<TagStore> =>
        backend === "codex" ? codexTags : opencodeTags,
    ),
    setSessionTags: vi.fn(async (): Promise<TagStore> => opencodeTags),
    setTagColor: vi.fn(async (): Promise<TagStore> => ({ sessions: {}, colors: {} })),
    deleteTag: vi.fn(async (): Promise<TagStore> => ({ sessions: {}, colors: {} })),
    trash: async () => [],
    trashAdd: async () => [],
    trashRemove: async () => [],
    archive: async () => ({
      sessions: options.archive?.sessions ?? [],
      directories: [],
    }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: vi.fn(async () => ({ sessions: [], directories: [] })),
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
    onEvent: (_handler: (envelope: BackendEventEnvelope) => void) => () => {},
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return {
    store: state.store,
    api,
    messagesCalls,
    switchBackend: state.switchBackend,
    selectSession: state.selectSession,
    setSessionTags: state.setSessionTags,
    refreshSessions: state.refreshSessions,
    /** Play a TUI-side change the parked backend will surface on return. */
    addOpencodeSession: () => {
      opencodeSessions = [OPENCODE_S1, OPENCODE_S2];
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

function callsFor(
  calls: Array<{ backend: BackendId; sessionId: string }>,
  backend: BackendId,
  sessionId: string,
): number {
  return calls.filter((c) => c.backend === backend && c.sessionId === sessionId).length;
}

describe("backend switch cache", () => {
  it("repaints a visited backend from its parked workspace without refetching messages", async () => {
    const h = await bootState();
    expect(h.store.selectedId).toBe("s1");
    // The boot loaded s1's canvas messages once.
    expect(callsFor(h.messagesCalls, "opencode", "s1")).toBe(1);

    await h.switchBackend("codex");
    expect(h.store.activeBackend).toBe("codex");
    expect(h.store.selectedId).toBe("c1");
    expect(callsFor(h.messagesCalls, "codex", "c1")).toBe(1);

    // Switch back: the parked workspace lands synchronously with the switch —
    // booted, sessions and selection restored — and the cached session's
    // messages are NOT fetched again (only the background list refresh runs).
    await h.switchBackend("opencode");
    expect(h.store.booted).toBe(true);
    expect(h.store.activeBackend).toBe("opencode");
    expect(h.store.selectedId).toBe("s1");
    expect(h.store.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(h.store.messagesBySession.s1).toEqual([S1_USER]);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsFor(h.messagesCalls, "opencode", "s1")).toBe(1);
  });

  it("picks up sessions created while the backend was parked", async () => {
    const h = await bootState();
    await h.switchBackend("codex");
    h.addOpencodeSession();

    await h.switchBackend("opencode");
    // The cached view paints first…
    expect(h.store.sessions.map((s) => s.id)).toEqual(["s1"]);
    // …then the background refresh lands the parked-period change. The new
    // session is a separate root, so it lands in the sidebar (the canvas
    // keeps showing the selected story) and loads when selected.
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(callsFor(h.messagesCalls, "opencode", "s2")).toBe(0);

    await h.selectSession("s2");
    expect(callsFor(h.messagesCalls, "opencode", "s2")).toBe(1);
    expect(h.store.selectedId).toBe("s2");
  });

  it("keeps the offline copy honest: a failed revalidate marks the error and keeps the cache", async () => {
    const h = await bootState();
    await h.switchBackend("codex");
    (h.api.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "server died",
    });

    await h.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.booted).toBe(true);
    expect(h.store.connectionError).toContain("server died");
    // Cached sessions survive the failed refresh — the canvas stays readable.
    expect(h.store.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("does not apply an old backend's tag-write result to the active backend", async () => {
    const h = await bootState();
    let resolveWrite!: (store: TagStore) => void;
    (h.api.setSessionTags as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<TagStore>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const write = h.setSessionTags("s1", ["执行", "待办"]);
    await h.switchBackend("codex");
    expect(h.store.activeBackend).toBe("codex");
    expect(h.store.tags).toEqual({ c1: ["评审"] });

    resolveWrite({ sessions: { s1: ["执行", "待办"] }, colors: {} });
    await write;

    expect(h.store.activeBackend).toBe("codex");
    expect(h.store.tags).toEqual({ c1: ["评审"] });
    expect(h.api.setSessionTags).toHaveBeenCalledWith("opencode", "s1", ["执行", "待办"]);

    await h.switchBackend("opencode");
    expect(h.store.tags).toEqual({ s1: ["执行", "待办"] });
  });

  it("drops a session refresh that lands after a backend switch", async () => {
    const h = await bootState();
    let resolveSessions!: (value: Awaited<ReturnType<AweforkApi["sessions"]>>) => void;
    (h.api.sessions as ReturnType<typeof vi.fn>).mockImplementation((backend: BackendId) =>
      backend === "opencode"
        ? new Promise((resolve) => {
            resolveSessions = resolve;
          })
        : Promise.resolve({ sessions: [CODEX_C1], lineage: {} }),
    );

    // A refresh of the opencode list is still in flight when the user leaves
    // for codex — the codex boot then settles before the old fetch resolves.
    const stale = h.refreshSessions();
    await h.switchBackend("codex");
    expect(h.store.activeBackend).toBe("codex");
    expect(h.store.selectedId).toBe("c1");

    resolveSessions({ sessions: [OPENCODE_S1], lineage: {} });
    await stale;

    // The stale result must not repaint the parked backend's sessions into
    // the codex view, steal the selection back, or fetch s1's messages from
    // the codex server (a cross-backend id the server would reject).
    expect(h.store.sessions.map((s) => s.id)).toEqual(["c1"]);
    expect(h.store.selectedId).toBe("c1");
    expect(callsFor(h.messagesCalls, "codex", "s1")).toBe(0);
  });

  it("keeps archived sessions when a refresh returns an empty list", async () => {
    // Boot with an archived entry for a live session: a healthy refresh keeps
    // it (the session exists server-side).
    const h = await bootState({ archive: { sessions: [{ id: "s1", archivedAt: 1 }] } });
    expect(h.store.archive.sessions).toEqual([{ id: "s1", archivedAt: 1 }]);

    // A cold server answering before its session scan finishes returns an
    // empty list — that is not proof the sessions died, so the archive must
    // survive it instead of being pruned away.
    (h.api.sessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      lineage: {},
    });
    await h.refreshSessions();
    expect(h.store.archive.sessions).toEqual([{ id: "s1", archivedAt: 1 }]);
    expect(h.api.archiveRemove).not.toHaveBeenCalled();
  });
});
