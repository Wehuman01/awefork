import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope } from "../src/shared/backend";
import type { AgentEvent, ChatMessage, SessionSummary, SubagentCall } from "../src/shared/types";

/**
 * Task-card state harness: same singleton-reset boot as the run-settle
 * harness, scripted around one assistant row whose only visible content is
 * a Task-tool delegation — the row shape that used to vanish from the pane
 * because it has neither text nor thinking.
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

const CALL: SubagentCall = {
  partId: "prt-task-1",
  tool: "task",
  agent: "review",
  title: "审查密码哈希迁移",
  prompt: "Review migration_007, focus on transaction boundaries.",
  status: "completed",
  result: "回填缺事务保护，其余正确。",
  childSessionId: "s1-sub",
  modelId: "glm/glm-5.3-flash",
  startedAt: 1_000,
  endedAt: 61_000,
};

const USER_ROW: ChatMessage = {
  id: "m1",
  role: "user",
  text: "帮我排查登录接口",
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

/** The delegation row: no text, no thinking — only the task call. Mid-run
 *  shape (completedAt null) so the live frames pass the settled-row guard. */
const TASK_ROW: ChatMessage = {
  ...USER_ROW,
  id: "m2",
  role: "assistant",
  text: "",
  toolNames: ["task"],
  taskCalls: [CALL],
  completedAt: null,
};

async function bootState() {
  vi.resetModules();
  const rows = [USER_ROW, TASK_ROW];
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [SESSION], lineage: {} }),
    messages: async () => rows,
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
    dirsAdd: async (_backend, directory) => [directory],
    dirsRemove: async () => [],
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
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({
      currentVersion: "0.2.5",
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
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  await state.selectSession("s1");
  return {
    store: state.store,
    paneMessages: state.paneMessages,
    open: state.openSubagentSession,
    close: state.closeSubagentSession,
    send: (event: AgentEvent) => onEnvelope?.({ backend: "opencode", event }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("renderer task cards", () => {
  it("folds live task cards and hides the streaming row they belong to", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send({
      type: "message.toolCall",
      sessionId: "s1",
      messageId: "m2",
      partId: "prt-task-1",
      call: { ...CALL, status: "running", result: null, endedAt: null },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.store.running.s1).toBe(true);
    expect(h.store.liveToolCalls).toHaveLength(1);
    expect(h.store.liveToolCalls[0]?.call.status).toBe("running");
    // the row itself is mid-run: it renders through the live card, not twice
    expect(h.paneMessages.value.filter((m) => m.id === "m2")).toHaveLength(0);

    // the settled snapshot replaces the card in place, same partId
    h.send({
      type: "message.toolCall",
      sessionId: "s1",
      messageId: "m2",
      partId: "prt-task-1",
      call: CALL,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.liveToolCalls).toHaveLength(1);
    expect(h.store.liveToolCalls[0]?.call.status).toBe("completed");
  });

  it("keeps a task-only assistant row in the pane after the run settles", async () => {
    const h = await bootState();
    // Before this feature the row vanished: no text, no thinking, no error.
    expect(h.paneMessages.value.some((m) => m.id === "m2" && m.taskCalls?.length)).toBe(true);
  });

  it("clears live cards when the run settles, handing over to the row", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send({
      type: "message.toolCall",
      sessionId: "s1",
      messageId: "m2",
      partId: "prt-task-1",
      call: { ...CALL, status: "running", result: null, endedAt: null },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.liveToolCalls).toHaveLength(1);

    h.send({ type: "session.idle", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.store.liveToolCalls).toHaveLength(0);
    expect(h.paneMessages.value.some((m) => m.id === "m2")).toBe(true);
  });

  it("drops task snapshots for a session that is not running (fork replay)", async () => {
    const h = await bootState();
    h.send({
      type: "message.toolCall",
      sessionId: "s1",
      messageId: "m2",
      partId: "prt-task-1",
      call: CALL,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.liveToolCalls).toHaveLength(0);
    expect(h.store.running.s1).toBeUndefined();
  });

  it("opens and closes the subagent drawer on the child session", async () => {
    const h = await bootState();
    h.open(CALL);
    expect(h.store.subagentView).toEqual({ call: CALL, sessionId: "s1-sub" });
    // a call without a child session has nothing to open
    h.open({ ...CALL, childSessionId: null });
    expect(h.store.subagentView).not.toBeNull();
    h.close();
    expect(h.store.subagentView).toBeNull();
  });
});
