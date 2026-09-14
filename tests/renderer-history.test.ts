import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { AgentEvent, SessionSummary } from "../src/shared/types";

/**
 * Integration tests wiring the operation-history journal into the renderer
 * state layer. Boots a fresh state+history module pair under a scripted
 * window.awefork, then drives real undo/redo closures across the IPC bridge.
 * Fake timers keep the toast auto-clear and watchdog timers from flaking.
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

async function bootState(
  options: {
    tags?: { sessions: Record<string, string[]>; colors: Record<string, number> };
    trash?: { id: string; title: string; deletedAt: number }[];
  } = {},
) {
  vi.resetModules();
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
  const confirm = vi.fn(() => true);
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [SESSION], lineage: {} }),
    messages: vi.fn(async () => []),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => SESSION,
    fork: async () => SESSION,
    deleteSession: vi.fn(async () => []),
    deleteMessage: async () => {},
    prompt: vi.fn(async () => {}),
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: vi.fn(async () => {}),
    openSessionTerminal: async () => ({ ok: true }),
    pins: async () => [],
    togglePin: vi.fn(async () => []),
    dirs: async () => [],
    dirsAdd: async (_backend, directory) => [directory],
    dirsRemove: async () => [],
    pickDirectory: async () => null,
    tags: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    setSessionTags: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    setTagColor: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    deleteTag: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    trash: async () => options.trash ?? [],
    trashAdd: vi.fn(async () => [{ id: "s1", title: SESSION.title, deletedAt: 1 }]),
    trashRemove: vi.fn(async () => []),
    archive: async () => ({ sessions: [], directories: [] }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: async () => ({ sessions: [], directories: [] }),
    composer: async () => null,
    saveComposer: async () => {},
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    backends: async () => ({
      selected: "codex",
      backends: [
        { id: "codex", label: "codex", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    capabilities: async () => ({ deleteMessage: false, attachments: false, fileChanges: false }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({
      currentVersion: "0.2.0",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    onEvent: (handler) => {
      onEnvelope = handler;
      return () => {};
    },
  };
  (globalThis as unknown as { window: { awefork: AweforkApi; confirm: typeof confirm } }).window = {
    awefork: api,
    confirm,
  };
  const state = await import("../src/renderer/src/state");
  const history = await import("../src/renderer/src/history");
  await state.init();
  return {
    store: state.store,
    api,
    history,
    confirm,
    send: (backend: BackendId, event: AgentEvent) => onEnvelope?.({ backend, event }),
    selectSession: state.selectSession,
    togglePin: state.togglePin,
    deleteSession: state.deleteSession,
    deleteTag: state.deleteTag,
    renameSession: state.renameSession,
    createSession: state.createSession,
    sendPrompt: state.sendPrompt,
  };
}

type H = Awaited<ReturnType<typeof bootState>>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("history-wired renderer operations", () => {
  it("records a togglePin and walks it with real undo/redo closures", async () => {
    const h = await bootState();
    await h.togglePin("s1");
    expect(h.history.history.entries).toHaveLength(1);
    expect(h.api.togglePin).toHaveBeenCalledTimes(1);

    await h.history.undoSteps(1);
    expect(h.api.togglePin).toHaveBeenCalledTimes(2);
    expect(h.history.history.cursor).toBe(0);

    await h.history.redoSteps(1);
    expect(h.api.togglePin).toHaveBeenCalledTimes(3);
    expect(h.history.history.cursor).toBe(1);
  });

  it("soft-deletes a session, then undo restores it and redo re-confirms", async () => {
    const h = await bootState();
    await h.deleteSession("s1");
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.api.trashAdd).toHaveBeenCalledWith("codex", "s1", SESSION.title);
    expect(h.store.trash).toContain("s1");
    expect(h.store.deletedToast?.entryId).toBeTypeOf("number");

    await h.history.undoSteps(1);
    expect(h.api.trashRemove).toHaveBeenCalledWith("codex", "s1");
    expect(h.store.trash).toEqual([]);
    expect(h.store.sessions.some((s) => s.id === "s1")).toBe(true);

    await h.history.redoSteps(1);
    // Redo re-confirms and re-runs the soft delete against the server.
    expect(h.confirm).toHaveBeenCalledTimes(2);
    expect(h.api.trashAdd).toHaveBeenCalledTimes(2);
    expect(h.store.trash).toContain("s1");
  });

  it("does not hard-delete after a soft delete when a new op runs (no flush)", async () => {
    const h = await bootState();
    await h.deleteSession("s1");
    await h.togglePin("s1");
    // The old "next operation finalizes pending deletes" behavior is gone;
    // the delete only ever went to the trash, never to the server backend.
    expect(h.api.deleteSession).not.toHaveBeenCalled();
  });

  it("re-attaches a deleted tag to surviving sessions on undo", async () => {
    const h = await bootState({
      tags: { sessions: { s1: ["执行", "咨询"], gone: ["执行", "归档"] }, colors: { 执行: 210 } },
    });
    (h.api.deleteTag as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: { s1: ["咨询"] },
      colors: {},
    });
    (h.api.setSessionTags as ReturnType<typeof vi.fn>).mockImplementation(
      async (_backend: BackendId, sessionId: string, tags: string[]) => ({
        sessions: { [sessionId]: tags },
        colors: {},
      }),
    );
    (h.api.setTagColor as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: { s1: ["执行"] },
      colors: { 执行: 210 },
    });

    await h.deleteTag("执行");
    await h.history.undoSteps(1);

    // The re-attach re-creates s1's tags (append the deleted one) and
    // restores the picked hue; the non-surviving session is left alone.
    expect(h.api.setSessionTags).toHaveBeenCalledWith("codex", "s1", ["咨询", "执行"]);
    expect(h.api.setSessionTags).not.toHaveBeenCalledWith("codex", "gone", expect.anything());
    expect(h.api.setTagColor).toHaveBeenCalledWith("codex", "执行", 210);
  });

  it("renames back to the previous title on undo", async () => {
    const h = await bootState();
    await h.renameSession("s1", "新标题");
    expect(h.api.renameSession).toHaveBeenLastCalledWith("codex", "s1", "新标题");
    expect(h.store.sessions.find((s) => s.id === "s1")?.title).toBe("新标题");

    await h.history.undoSteps(1);
    expect(h.api.renameSession).toHaveBeenLastCalledWith("codex", "s1", "登录接口排查");
  });

  it("records a non-undoable lock for a successful sendPrompt", async () => {
    const h = await bootState();
    await h.sendPrompt("帮我改一下");
    expect(h.history.history.entries).toHaveLength(1);
    expect(h.history.history.entries[0]?.undoable).toBe(false);
    const cursor = h.history.history.cursor;

    const ret = await h.history.undoSteps(1);
    expect(ret).toBe(false);
    expect(h.history.history.cursor).toBe(cursor);
  });

  it("hard-deletes the created session when a createSession is undone", async () => {
    const h = await bootState();
    await h.createSession();
    await h.history.undoSteps(1);
    expect(h.api.deleteSession).toHaveBeenCalledWith("codex", "s1");
  });
});
