import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { AgentEvent, AgentInteractionRequest, SessionSummary } from "../src/shared/types";

/**
 * The renderer state module is a singleton, so every test boots a fresh
 * instance via vi.resetModules + dynamic import, backed by a scripted
 * window.awefork. Fake timers drive the 30s auto-deny deadline.
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

function commandApproval(requestId: string, sessionId = "s1"): AgentInteractionRequest {
  return {
    requestId,
    sessionId,
    kind: "command-approval",
    title: "允许执行命令？",
    detail: "Codex 请求执行一条命令。",
    command: "rm -rf /",
    cwd: "/demo/shop-api",
    reason: "clean rebuild",
  };
}

async function bootState(
  options: {
    promptError?: Error;
    tags?: { sessions: Record<string, string[]>; colors: Record<string, number> };
    trash?: { id: string; title: string; deletedAt: number }[];
  } = {},
) {
  vi.resetModules();
  const replies: Array<{ backend: BackendId; requestId: string; response: unknown }> = [];
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
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
    prompt: vi.fn(async () => {
      if (options.promptError) throw options.promptError;
    }),
    abort: async () => {},
    respondInteraction: async (backend, requestId, response) => {
      replies.push({ backend, requestId, response });
    },
    renameSession: async () => {},
    openSessionTerminal: async () => ({ ok: true }),
    pins: async () => [],
    togglePin: async () => [],
    dirs: async () => [],
    dirsAdd: async (_backend, directory) => [directory],
    dirsRemove: async () => [],
    pickDirectory: async () => null,
    tags: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    setSessionTags: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    setTagColor: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    deleteTag: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    addTagsToSessions: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    setForkTagPref: vi.fn(async () => options.tags ?? { sessions: {}, colors: {} }),
    trash: async () => options.trash ?? [],
    trashAdd: async () => [],
    trashRemove: async () => [],
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
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  const history = await import("../src/renderer/src/history");
  await state.init();
  return {
    store: state.store,
    history: history.history,
    api,
    replies,
    send: (backend: BackendId, event: AgentEvent) => onEnvelope?.({ backend, event }),
    selectSession: state.selectSession,
    sendPrompt: state.sendPrompt,
    respondInteraction: state.respondInteraction,
    deleteTag: state.deleteTag,
    setSessionTags: state.setSessionTags,
    undoSteps: history.undoSteps,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("renderer interaction state", () => {
  it("leaves no message polling or watchdog behind when a prompt rejects", async () => {
    const h = await bootState({
      promptError: new Error("codex prompt failed: not logged in"),
    });
    await h.selectSession("s1");
    const messagesCallsAfterLoad = (h.api.messages as ReturnType<typeof vi.fn>).mock.calls.length;

    await h.sendPrompt("帮我修一下", null);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.actionError).toContain("not logged in");

    // The watchdog polls messages every 1.5s while armed; a rejected prompt
    // never arms it, so the call count must stay flat.
    await vi.advanceTimersByTimeAsync(10_000);
    expect((h.api.messages as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      messagesCallsAfterLoad,
    );
  });

  it("restores the visible tags when a global delete cannot be persisted", async () => {
    const h = await bootState({
      tags: { sessions: { s1: ["执行", "咨询"] }, colors: { 执行: 210 } },
    });
    (h.api.deleteTag as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk full"));

    await h.deleteTag("执行");

    expect(h.store.tags).toEqual({ s1: ["执行", "咨询"] });
    expect(h.store.tagColors).toEqual({ 执行: 210 });
    expect(h.store.tagDeletedToast).toBeNull();
    expect(h.store.actionError).toContain("disk full");
  });

  it("does not retain tags for sessions flushed from the startup trash", async () => {
    const h = await bootState({
      tags: { sessions: { s1: ["执行"] }, colors: { 执行: 210 } },
      trash: [{ id: "s1", title: SESSION.title, deletedAt: 1 }],
    });

    expect(h.store.trash).toEqual([]);
    expect(h.store.tags).toEqual({});
    expect(h.store.tagColors).toEqual({});
    expect(h.api.deleteSession).toHaveBeenCalledWith("codex", "s1");
  });

  it("undoes only the deleted tag on sessions that still exist", async () => {
    const h = await bootState({
      tags: {
        sessions: { s1: ["执行", "咨询"], gone: ["执行", "归档"] },
        colors: { 执行: 210 },
      },
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
    // The user removed the remaining tag before clicking undo.
    await h.setSessionTags("s1", []);
    // Undo the tag edit back to its pre-edit value, then undo the deleteTag
    // itself — the journal walks them LIFO, most recent first. Because the
    // "clear to []" edit lands between the delete and the undo, the deleteTag
    // undo re-attaches 执行 onto the tags that edit restored, so the final
    // re-create call carries both 咨询 and 执行 (the old single-op undo that
    // only reversed the delete produced just ["执行"]).
    await h.undoSteps(1);
    await h.undoSteps(1);

    expect(h.api.setSessionTags).toHaveBeenCalledWith("codex", "s1", ["咨询", "执行"]);
    expect(h.api.setSessionTags).not.toHaveBeenCalledWith("codex", "gone", expect.anything());
    expect(h.api.setTagColor).toHaveBeenCalledWith("codex", "执行", 210);
  });

  it("queues an interaction request and exposes its auto-deny deadline", async () => {
    const h = await bootState();
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1") });

    expect(h.store.interactions.codex).toHaveLength(1);
    expect(h.store.interactions.codex[0]?.kind).toBe("command-approval");
    expect(h.store.interactionDeadlines["codex:req-1"]).toBeTypeOf("number");
    // Duplicate deliveries (a replayed envelope) must not queue twice.
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1") });
    expect(h.store.interactions.codex).toHaveLength(1);
  });

  it("sends an explicit deny exactly once and never fires the late timer", async () => {
    const h = await bootState();
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1") });
    const request = h.store.interactions.codex[0];

    h.respondInteraction(request, { decision: "deny" });
    expect(h.replies).toEqual([
      { backend: "codex", requestId: "req-1", response: { decision: "deny" } },
    ]);
    expect(h.store.interactions.codex).toHaveLength(0);
    expect(h.store.interactionDeadlines["codex:req-1"]).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.replies).toHaveLength(1); // the cleared timer stayed cleared
  });

  it("auto-denies once at the 30s deadline and cleans up", async () => {
    const h = await bootState();
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1") });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(h.replies).toHaveLength(0);
    expect(h.store.interactions.codex).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.replies).toEqual([
      { backend: "codex", requestId: "req-1", response: { decision: "deny" } },
    ]);
    expect(h.store.interactions.codex).toHaveLength(0);
    expect(h.store.interactionDeadlines["codex:req-1"]).toBeUndefined();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.replies).toHaveLength(1);
  });

  it("routes a background backend's timeout reply to its own backend", async () => {
    const h = await bootState(); // active backend is codex
    h.send("opencode", {
      type: "interaction.requested",
      request: commandApproval("bg-1"),
    });

    expect(h.store.interactions.codex).toHaveLength(0);
    expect(h.store.interactions.opencode).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.replies).toEqual([
      { backend: "opencode", requestId: "bg-1", response: { decision: "deny" } },
    ]);
  });

  it("drops a session's pending interactions when the turn goes idle", async () => {
    const h = await bootState();
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1", "s1") });
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-2", "s2") });

    h.send("codex", { type: "session.idle", sessionId: "s1" });
    expect(h.store.interactions.codex.map((item) => item.requestId)).toEqual(["req-2"]);

    // The survivor keeps its timer; idle for another session must not reply.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.replies).toHaveLength(0);
  });

  it("drops every queued interaction on a connection-level server error", async () => {
    const h = await bootState();
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1") });
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-2", "s2") });

    h.send("codex", { type: "server.error", message: "codex: stream dead" });
    expect(h.store.interactions.codex).toHaveLength(0);
    expect(h.store.interactionDeadlines).toEqual({});

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.replies).toHaveLength(0);
  });

  it("keeps other sessions' interactions when one session's run fails", async () => {
    const h = await bootState();
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-1", "s1") });
    h.send("codex", { type: "interaction.requested", request: commandApproval("req-2", "s2") });

    h.send("codex", {
      type: "server.error",
      sessionId: "s1",
      message: "codex: turn failed",
    });
    expect(h.store.interactions.codex.map((item) => item.requestId)).toEqual(["req-2"]);
    expect(h.store.interactionDeadlines["codex:req-2"]).toBeTypeOf("number");
    expect(h.store.interactionDeadlines["codex:req-1"]).toBeUndefined();
  });
});
