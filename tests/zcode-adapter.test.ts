import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/shared/types.js";
import {
  createZcodeAdapter,
  type ZcodeAdapterOptions,
  type ZcodeClient,
} from "../src/shared/zcode-adapter.js";

interface FakeClientSpec {
  /** method → result (or throw when the value is an Error). */
  replies?: Record<string, unknown | Error>;
  requests?: Array<{ method: string; params: unknown; result: unknown | Error }>;
}

/** Scripted client: static replies first, then an ordered queue. */
function fakeClient(spec: FakeClientSpec = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const queue = [...(spec.requests ?? [])];
  let notificationHandler: ((method: string, params: unknown) => void) | null = null;
  const client: ZcodeClient = {
    request<T = unknown>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params: params ?? {} });
      const queued = queue.find((entry) => entry.method === method);
      if (queued) {
        queue.splice(queue.indexOf(queued), 1);
        if (queued.result instanceof Error) return Promise.reject(queued.result);
        return Promise.resolve(queued.result as T);
      }
      const reply = spec.replies?.[method];
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve((reply ?? {}) as T);
    },
    setNotificationHandler(handler: (method: string, params: unknown) => void) {
      notificationHandler = handler;
    },
    setRequestHandler() {},
  };
  return {
    client,
    calls,
    emit(method: string, params: unknown) {
      notificationHandler?.(method, params);
    },
  };
}

function fakeOptions(overrides: Partial<ZcodeAdapterOptions> = {}) {
  const clients: ZcodeClient[] = [];
  const replacedCbs: Array<(client: ZcodeClient) => void> = [];
  const options: ZcodeAdapterOptions = {
    client: async () => clients[clients.length - 1],
    onClientReplaced(cb) {
      replacedCbs.push(cb);
    },
    lineagePath: "/tmp/lineage-zcode.test.json",
    homeDirectory: "/Users/test/home",
    now: () => 1_750_000_000_000,
    ...overrides,
  };
  return {
    options,
    addClient(client: ZcodeClient) {
      clients.push(client);
      return client;
    },
    replaceClient(client: ZcodeClient) {
      clients.push(client);
      for (const cb of replacedCbs) cb(client);
    },
  };
}

const USER_MESSAGE = {
  info: {
    id: "msg_u1",
    role: "user",
    time: { created: 1000, completed: null },
    model: { modelID: "GLM-5.3", providerID: "builtin:bigmodel-coding-plan", variant: "nothink" },
  },
  parts: [
    { type: "text", text: "帮我修 bug" },
    { type: "file", filename: "截图.png" },
  ],
};

const ASSISTANT_MESSAGE = {
  info: {
    id: "msg_a1",
    role: "assistant",
    parentID: "msg_u1",
    modelID: "GLM-5.3",
    providerID: "builtin:bigmodel-coding-plan",
    time: { created: 1100, completed: 2000 },
    tokens: { output: 155 },
    finish: "tool-calls",
  },
  parts: [
    { type: "step-start" },
    { type: "reasoning", text: "先看代码" },
    { type: "text", text: "好的" },
    { type: "tool", callId: "c1", tool: "read" },
  ],
};

describe("zcode adapter", () => {
  it("maps session rows: origin from sessionKind, directory from workspace, sorted desc", async () => {
    const { client } = fakeClient({
      replies: {
        "session/list": {
          sessions: [
            {
              sessionId: "sess_a",
              title: "旧会话",
              sessionKind: "interactive",
              workspace: { workspaceKey: "/repo", workspacePath: "/repo" },
              createdAt: 1,
              updatedAt: 100,
            },
            {
              sessionId: "sess_fork",
              title: "分支",
              sessionKind: "fork",
              parentSessionId: "sess_a",
              workspace: { workspacePath: "/repo" },
              createdAt: 2,
              updatedAt: 200,
            },
            {
              sessionId: "sess_sub",
              title: "子任务",
              sessionKind: "subagent_child",
              parentSessionId: "sess_a",
              workspace: { workspacePath: "/repo" },
              createdAt: 3,
              updatedAt: 300,
            },
          ],
        },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    const sessions = await createZcodeAdapter(options).listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["sess_sub", "sess_fork", "sess_a"]);
    expect(sessions[1].origin).toBe("fork");
    expect(sessions[1].parentSessionId).toBe("sess_a");
    expect(sessions[0].origin).toBe("subagent");
    expect(sessions[2].origin).toBe("root");
    expect(sessions[2].directory).toBe("/repo");
  });

  it("maps messages from resume: user rows, assistant rows, tools, tokens, finish", async () => {
    const { client } = fakeClient({
      requests: [
        {
          method: "session/messages",
          params: { sessionId: "sess_x" },
          result: { messages: [USER_MESSAGE, ASSISTANT_MESSAGE] },
        },
      ],
      replies: { "session/resume": { messages: [] } },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    const rows = await createZcodeAdapter(options).messages("sess_x");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "msg_u1",
      role: "user",
      text: "帮我修 bug",
      attachmentNames: ["截图.png"],
      modelId: "GLM-5.3",
      variant: "nothink",
    });
    expect(rows[1]).toMatchObject({
      id: "msg_a1",
      role: "assistant",
      text: "好的",
      thinking: "先看代码",
      toolNames: ["read"],
      outputTokens: 155,
      finish: "tool-calls",
      completedAt: 2000,
    });
  });

  it("reads canonical rows from session/messages; resume only attaches", async () => {
    // The resume projection spells ids `messageId` and omits parts; the
    // adapter must not render from it.
    const { client, calls } = fakeClient({
      requests: [
        {
          method: "session/messages",
          params: { sessionId: "sess_x" },
          result: { messages: [USER_MESSAGE] },
        },
      ],
      replies: {
        "session/resume": { messages: [{ info: { role: "user", messageId: "compact_1" } }] },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    const rows = await createZcodeAdapter(options).messages("sess_x");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("msg_u1");
    expect(calls.map((call) => call.method)).toEqual(["session/resume", "session/messages"]);
  });

  it("fork cuts at the last message of the anchor turn and records lineage", async () => {
    const secondUser = {
      info: { id: "msg_u2", role: "user", time: { created: 3000 } },
      parts: [{ type: "text", text: "换个思路" }],
    };
    const reply = {
      info: { id: "msg_a2", role: "assistant", time: { created: 4000, completed: 4500 } },
      parts: [{ type: "text", text: "第二条" }],
    };
    const { client, calls } = fakeClient({
      requests: [
        {
          method: "session/messages",
          result: { messages: [USER_MESSAGE, ASSISTANT_MESSAGE, secondUser, reply] },
        },
      ],
      replies: {
        "session/resume": {},
        "session/fork": { forkedSessionId: "sess_new", parentSessionId: "sess_x" },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    // recordFork writes through the shared lineage store; its file shape is
    // covered by lineage-store's own tests.
    options.lineagePath = "/tmp/awefork-zcode-adapter-test/lineage.json";
    const summary = await createZcodeAdapter(options).fork("sess_x", "msg_u2");
    const forkCall = calls.find((call) => call.method === "session/fork");
    expect(forkCall?.params).toEqual({
      sessionId: "sess_x",
      target: { kind: "message", messageId: "msg_a2" },
    });
    expect(summary.id).toBe("sess_new");
    expect(summary.origin).toBe("fork");
    expect(summary.parentSessionId).toBe("sess_x");
  });

  it("fork at latest passes the final message id", async () => {
    const { client, calls } = fakeClient({
      requests: [
        {
          method: "session/messages",
          result: { messages: [USER_MESSAGE, ASSISTANT_MESSAGE] },
        },
      ],
      replies: {
        "session/resume": {},
        "session/fork": { forkedSessionId: "sess_new2" },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    options.lineagePath = "/tmp/awefork-zcode-adapter-test/lineage2.json";
    await createZcodeAdapter(options).fork("sess_x", null);
    const forkCall = calls.find((call) => call.method === "session/fork");
    expect(forkCall?.params).toMatchObject({
      target: { kind: "message", messageId: "msg_a1" },
    });
  });

  it("empty-context fork creates in the parent's workspace — no native fork", async () => {
    const { client, calls } = fakeClient({
      replies: {
        "session/list": {
          sessions: [
            {
              sessionId: "sess_x",
              workspace: { workspaceKey: "/demo/shop-api", workspacePath: "/demo/shop-api" },
            },
          ],
        },
        "session/create": { session: { sessionId: "sess_empty" } },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    options.lineagePath = "/tmp/awefork-zcode-adapter-test/lineage3.json";
    const summary = await createZcodeAdapter(options).fork("sess_x", "msg_u1", {
      context: "none",
    });
    const createCall = calls.find((call) => call.method === "session/create");
    expect(createCall?.params).toEqual({
      workspace: { workspaceKey: "/demo/shop-api", workspacePath: "/demo/shop-api" },
    });
    expect(calls.some((call) => call.method === "session/fork")).toBe(false);
    expect(summary).toMatchObject({ id: "sess_empty", origin: "fork", parentSessionId: "sess_x" });
  });

  it("prompt sets the model, subscribes before send, and surfaces failures", async () => {
    const { client, calls } = fakeClient({
      replies: {
        "session/subscribe": { eventSeq: 0 },
        "session/send": { accepted: true, stateRevision: 1 },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    const events: AgentEvent[] = [];
    const adapter = createZcodeAdapter(options);
    await adapter.subscribe((event) => events.push(event));
    await adapter.prompt("sess_x", "继续", {
      providerId: "zc-aweshare",
      modelId: "hub/deepseek-v4-pro",
      variant: "high",
    });
    const order = calls.map((call) => call.method);
    expect(order).toEqual(["session/setModel", "session/subscribe", "session/send"]);
    expect(calls[0].params).toMatchObject({
      sessionId: "sess_x",
      model: { providerId: "zc-aweshare", modelId: "hub/deepseek-v4-pro", variant: "high" },
    });

    const boom = fakeClient({
      replies: {
        "session/subscribe": { eventSeq: 0 },
        "session/send": new Error("A prompt is already running for this session"),
      },
    });
    const failing = fakeOptions();
    failing.options.client = async () => boom.client;
    const failEvents: AgentEvent[] = [];
    const failingAdapter = createZcodeAdapter(failing.options);
    await failingAdapter.subscribe((event) => failEvents.push(event));
    await expect(failingAdapter.prompt("sess_y", "text")).rejects.toThrow();
    const errorEvent = failEvents.find((event) => event.type === "server.error");
    expect(errorEvent).toMatchObject({ sessionId: "sess_y" });
    if (errorEvent?.type === "server.error") {
      expect(errorEvent.message).toContain("正在运行");
    }
  });

  it("normalizes session/event notifications into AgentEvents", async () => {
    const { client, emit } = fakeClient({});
    const { options } = fakeOptions();
    options.client = async () => client;
    const events: AgentEvent[] = [];
    await createZcodeAdapter(options).subscribe((event) => events.push(event));
    const push = (type: string, payload: unknown) =>
      emit("session/event", { sessionId: "sess_x", type, payload });
    push("turn_started", { turnId: "turn_1" });
    push("turn_complete", {});
    push("session_title_updated", {});
    push("turn_error", { message: "额度不足" });
    expect(events).toEqual([
      { type: "message.started", sessionId: "sess_x", messageId: "turn_1" },
      { type: "session.idle", sessionId: "sess_x" },
      { type: "session.updated", sessionId: "sess_x" },
      { type: "session.updated", sessionId: "sess_x" },
      { type: "server.error", sessionId: "sess_x", message: "额度不足" },
      { type: "session.idle", sessionId: "sess_x" },
    ]);
  });

  it("re-attaches handlers on client replacement and announces reconnection", async () => {
    const first = fakeClient({});
    const { options, replaceClient } = fakeOptions();
    options.client = async () => first.client;
    const events: AgentEvent[] = [];
    await createZcodeAdapter(options).subscribe((event) => events.push(event));
    const second = fakeClient({});
    replaceClient(second.client);
    second.emit("session/event", { sessionId: "sess_x", type: "turn_complete", payload: {} });
    expect(events.some((event) => event.type === "server.reconnected")).toBe(true);
    expect(events.some((event) => event.type === "session.idle")).toBe(true);
  });

  it("reads models from the v2 provider config", async () => {
    const { options } = fakeOptions({
      readProviderConfig: async () =>
        JSON.stringify({
          provider: {
            "zc-aweshare": {
              name: "zc-aweshare",
              enabled: true,
              models: {
                "hub/deepseek-v4-pro": {
                  name: "hub/deepseek-v4-pro",
                  reasoning: { variants: ["none", "low", "medium", "high", "xhigh", "max"] },
                  modalities: { input: ["text", "image"] },
                },
              },
            },
            "disabled-provider": {
              enabled: false,
              models: { "m/1": { name: "m/1" } },
            },
          },
        }),
    });
    const models = await createZcodeAdapter(options).listModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      providerId: "zc-aweshare",
      modelId: "hub/deepseek-v4-pro",
      attachment: true,
      variants: ["none", "low", "medium", "high", "xhigh", "max"],
    });
  });

  it("createSession uses the caller directory or the injected home", async () => {
    const { client, calls } = fakeClient({
      replies: {
        "session/create": {
          session: {
            sessionId: "sess_new",
            title: "New session",
            workspace: { workspacePath: "/repo" },
            createdAt: 10,
            updatedAt: 10,
          },
        },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    const summary = await createZcodeAdapter(options).createSession("/repo");
    expect(summary.id).toBe("sess_new");
    expect(calls[0].params).toMatchObject({
      workspace: { workspaceKey: "/repo", workspacePath: "/repo" },
    });

    const home = fakeClient({
      replies: { "session/create": { session: { sessionId: "sess_home" } } },
    });
    const homeCalls = home.calls;
    const homeOptions = fakeOptions();
    homeOptions.options.client = async () => home.client;
    await createZcodeAdapter(homeOptions.options).createSession(null);
    expect(homeCalls[0].params).toMatchObject({
      workspace: { workspacePath: "/Users/test/home" },
    });
  });

  it("rejects the operations the backend cannot do", async () => {
    const { options } = fakeOptions();
    const adapter = createZcodeAdapter(options);
    await expect(adapter.deleteSession("sess_x")).rejects.toThrow("zcode");
    await expect(adapter.deleteMessage("sess_x", "msg_1")).rejects.toThrow("zcode");
    await expect(adapter.renameSession("sess_x", "新标题")).rejects.toThrow("zcode");
    await expect(adapter.exportSession("sess_x", null)).rejects.toThrow("zcode");
    await expect(adapter.respondInteraction("req", { decision: "deny" })).rejects.toThrow();
  });

  it("drops model-only harness rows but keeps real and legacy user rows", async () => {
    const modelOnly = {
      info: {
        id: "msg_hl",
        role: "user",
        metadata: { source: "todo_reminder", visibility: "model-only" },
      },
      parts: [
        {
          type: "text",
          text: "The TodoWrite tool hasn't been used recently…",
          synthetic: true,
          metadata: { runtimeMessage: { source: "todo_reminder" }, visibility: "model-only" },
        },
      ],
    };
    const realUser = {
      info: {
        id: "msg_real",
        role: "user",
        time: { created: 200 },
        semantics: { origin: "real_user", uiVisibility: "visible" },
      },
      parts: [{ type: "text", text: "这是我打的字" }],
    };
    const legacyUser = {
      // Older real-user rows carry neither metadata nor semantics — only a
      // negative check keeps them.
      info: { id: "msg_legacy", role: "user", time: { created: 300 } },
      parts: [{ type: "text", text: "旧版本真实输入" }],
    };
    const { client } = fakeClient({
      requests: [
        {
          method: "session/messages",
          result: { messages: [modelOnly, realUser, legacyUser] },
        },
      ],
      replies: { "session/resume": {} },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    const rows = await createZcodeAdapter(options).messages("sess_x");
    expect(rows.map((row) => row.id)).toEqual(["msg_real", "msg_legacy"]);
    expect(rows[0].text).toBe("这是我打的字");
    expect(rows[1].text).toBe("旧版本真实输入");
  });

  it("fork ignores synthetic user rows when walking to the turn cut", async () => {
    // A model-only row dropped mid-turn must not stop the turn walk early.
    const syntheticUser = {
      info: {
        id: "msg_syn",
        role: "user",
        metadata: { source: "background_task", visibility: "model-only" },
      },
      parts: [
        {
          type: "text",
          text: "后台任务完成",
          synthetic: true,
          metadata: { visibility: "model-only" },
        },
      ],
    };
    const reply3 = {
      info: { id: "msg_a3", role: "assistant", time: { created: 5000, completed: 5500 } },
      parts: [{ type: "text", text: "第三条" }],
    };
    const reply4 = {
      info: { id: "msg_a4", role: "assistant", time: { created: 6000, completed: 6500 } },
      parts: [{ type: "text", text: "第四条" }],
    };
    const { client, calls } = fakeClient({
      requests: [
        {
          method: "session/messages",
          result: {
            messages: [
              USER_MESSAGE, // msg_u1 (real user, anchor)
              ASSISTANT_MESSAGE, // msg_a1
              syntheticUser, // mid-turn, must be ignored by the walk
              reply3, // msg_a3
              reply4, // msg_a4 — last of the anchor turn
            ],
          },
        },
      ],
      replies: {
        "session/resume": {},
        "session/fork": { forkedSessionId: "sess_forked" },
      },
    });
    const { options } = fakeOptions();
    options.client = async () => client;
    options.lineagePath = "/tmp/awefork-zcode-adapter-test/lineage3.json";
    await createZcodeAdapter(options).fork("sess_x", "msg_u1");
    const forkCall = calls.find((call) => call.method === "session/fork");
    expect(forkCall?.params).toEqual({
      sessionId: "sess_x",
      target: { kind: "message", messageId: "msg_a4" },
    });
  });

  it("re-subscribes a session after the client respawns", async () => {
    const first = fakeClient({
      replies: { "session/subscribe": { eventSeq: 0 }, "session/send": { accepted: true } },
    });
    const { options, addClient, replaceClient } = fakeOptions();
    addClient(first.client);
    const adapter = createZcodeAdapter(options);
    await adapter.subscribe(() => {});
    await adapter.prompt("sess_x", "第一轮", {} as never);

    // Simulate the app-server restarting: a fresh process with no
    // subscriptions. The adapter must forget the old subscription and
    // re-subscribe when prompting again.
    const second = fakeClient({
      replies: { "session/subscribe": { eventSeq: 0 }, "session/send": { accepted: true } },
    });
    replaceClient(second.client);
    await adapter.prompt("sess_x", "重生后再发一条", {});
    const subscribeCalls = second.calls.filter((call) => call.method === "session/subscribe");
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0].params).toEqual({ sessionId: "sess_x" });
  });
});
