import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_NOT_LOGGED_IN_MESSAGE,
  type CodexRpc,
  createCodexAdapter,
  OWNED_ELSEWHERE_MESSAGE,
} from "../src/shared/codex-adapter";
import type { AgentEvent, AgentInteractionRequest, PromptAttachment } from "../src/shared/types";

/**
 * Scripted JSON-RPC stand-in: one handler per method (keyed on params when a
 * method is called for several threads), plus direct access to whatever
 * notification handler the adapter installed.
 */
type RequestHandler = (params: Record<string, unknown>) => unknown;

function fakeClient(handlers: Record<string, RequestHandler>) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let onNotification: (method: string, params: unknown) => void = () => {};
  let onRequest: ((method: string, params: unknown) => unknown | Promise<unknown>) | undefined;
  const client: CodexRpc = {
    async request<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`no fixture for ${method}`);
      return handler((params ?? {}) as Record<string, unknown>) as T;
    },
    setNotificationHandler(handler) {
      onNotification = handler;
    },
    setRequestHandler(handler) {
      onRequest = handler;
    },
  };
  return {
    client,
    calls,
    callsOf: (method: string) => calls.filter((c) => c.method === method),
    notify: (method: string, params: unknown) => onNotification(method, params),
    /** Drive a codex server→client request through the adapter's handler. */
    serverRequest: (method: string, params: unknown): Promise<unknown> => {
      if (!onRequest) throw new Error("adapter never installed a request handler");
      return Promise.resolve(onRequest(method, params));
    },
  };
}

const dirs: string[] = [];

async function tempLineagePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "awefork-codex-"));
  dirs.push(dir);
  return join(dir, "lineage-codex.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A completed turn shaped like real `thread/turns/list itemsView:"full"` data. */
const TURN_FIXTURE = {
  id: "turn-1",
  status: "completed",
  startedAt: 1726000000,
  completedAt: 1726000042,
  items: [
    {
      type: "userMessage",
      id: "u1",
      content: [{ text: "帮我看看登录接口" }, { text: "顺便看看限流" }],
    },
    {
      type: "reasoning",
      id: "r1",
      content: [{ text: "先读代码" }],
      summary: ["规划步骤"],
    },
    { type: "commandExecution", id: "c1", command: "rg login" },
    { type: "mcpToolCall", id: "m1", server: "aweshelf", tool: "search" },
    { type: "agentMessage", id: "a1", text: "登录接口在 src/auth.ts" },
  ],
};

const THREAD_FIXTURE = {
  id: "s1",
  cwd: "/demo/shop-api",
  model: "gpt-5-codex",
  modelProvider: "openai",
  reasoningEffort: "high",
  createdAt: 1726000000,
  updatedAt: 1726000042,
};

/** A later turn of the same thread, sent after the model was switched. */
const SWITCHED_TURN_FIXTURE = {
  id: "turn-2",
  status: "completed",
  startedAt: 1726000100,
  completedAt: 1726000110,
  items: [
    { type: "userMessage", id: "u2", content: [{ text: "换个模型继续" }] },
    { type: "agentMessage", id: "a2", text: "好，换这个" },
  ],
};

function turnPageFixture(turns: unknown[]) {
  return { data: turns, nextCursor: null };
}

/**
 * A TUI-forked thread's first turns/list answer serves only the forked-from
 * prefix (the parent's turns, reconstructed from its rollout); the thread's
 * own post-fork turns appear only after thread/resume loads the rollout.
 */
const PREFIX_TURN = {
  id: "turn-prefix",
  status: "completed",
  startedAt: 1726000000,
  completedAt: 1726000010,
  items: [{ type: "userMessage", id: "u0", content: ["fork 前的问题"] }],
};

const OWN_TURN = {
  id: "turn-own",
  status: "completed",
  startedAt: 1726000020,
  completedAt: 1726000030,
  items: [{ type: "userMessage", id: "u1", content: ["fork 后的新问题"] }],
};

describe("createCodexAdapter messages()", () => {
  it("maps a Turn into user and assistant rows, seconds → milliseconds", async () => {
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    expect(rows).toHaveLength(2);

    const [user, assistant] = rows;
    expect(user).toMatchObject({
      id: "u1",
      role: "user",
      text: "帮我看看登录接口\n顺便看看限流",
      createdAt: 1726000000000,
      providerId: "codex",
      modelId: "gpt-5-codex",
      variant: "high",
    });
    expect(assistant).toMatchObject({
      id: "turn-1",
      role: "assistant",
      text: "登录接口在 src/auth.ts",
      thinking: "先读代码\n\n规划步骤",
      toolNames: ["shell · rg login", "aweshelf/search"],
      createdAt: 1726000000000,
      completedAt: 1726000042000,
      finish: "stop",
    });
  });

  it("surfaces staged image names as the user row's attachment names", async () => {
    // codex echoes each sent image back as a localImage part holding the
    // staged file's path; the basename is the filename the user attached.
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        turnPageFixture([
          {
            ...TURN_FIXTURE,
            items: [
              {
                type: "userMessage",
                id: "u1",
                content: [
                  { type: "text", text: "看看这个报错", text_elements: [] },
                  {
                    type: "localImage",
                    detail: null,
                    path: "/var/folders/tmp/awefork-codex-att-9f2/screenshot.png",
                  },
                ],
              },
              ...TURN_FIXTURE.items.slice(1),
            ],
          },
        ]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    expect(rows[0]).toMatchObject({
      role: "user",
      text: "看看这个报错",
      attachmentNames: ["screenshot.png"],
    });
  });

  it("treats a not-yet-materialized thread as empty instead of erroring", async () => {
    // Regression: messages() runs right after thread/start (new session), and
    // turns/list refuses a thread with no rollout yet ("is not materialized
    // yet"); that surfaced as an awefork:messages error toast on every fresh
    // codex session.
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => {
        throw new Error(
          "thread s1 is not materialized yet; thread/turns/list is unavailable before first user message",
        );
      },
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    await expect(adapter.messages("s1")).resolves.toEqual([]);
    // No resume either: an empty fresh thread must not take the writer.
    expect(callsOf("thread/resume")).toHaveLength(0);
  });

  it("reads reasoning history content sent as string[] (codex 0.154 format)", async () => {
    // Regression: 0.154's ReasoningThreadItem.content is string[]; reading it
    // as {text}[] dropped the whole thinking trail on history reload.
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        turnPageFixture([
          {
            ...TURN_FIXTURE,
            id: "turn-154",
            items: [
              ...TURN_FIXTURE.items.filter((i) => i.type !== "reasoning"),
              {
                type: "reasoning",
                id: "r154",
                content: ["第一段思考", "第二段思考"],
                summary: ["摘要"],
              },
            ],
          },
        ]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    const assistant = rows.find((r) => r.role === "assistant");
    expect(assistant?.thinking).toBe("第一段思考\n\n第二段思考\n\n摘要");
  });

  it("lists turns ascending and full-view, following pagination cursors", async () => {
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": (params) =>
        params.cursor === null
          ? { data: [TURN_FIXTURE], nextCursor: "page-2" }
          : turnPageFixture([
              {
                id: "turn-2",
                status: "completed",
                startedAt: 1726000100,
                completedAt: 1726000110,
                items: [{ type: "userMessage", id: "u2", content: [{ text: "继续" }] }],
              },
            ]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    expect(rows.map((r) => r.id)).toEqual(["u1", "turn-1", "u2"]);
    const listCalls = callsOf("thread/turns/list").map((c) => c.params);
    expect(listCalls[0]).toMatchObject({ threadId: "s1", sortDirection: "asc", itemsView: "full" });
    expect(listCalls[1]).toMatchObject({ cursor: "page-2" });
  });

  it("drops the assistant row when a turn produced nothing visible", async () => {
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        turnPageFixture([
          {
            id: "turn-3",
            status: "completed",
            startedAt: 1726000200,
            completedAt: 1726000201,
            items: [{ type: "userMessage", id: "u3", content: [{ text: "还在吗" }] }],
          },
        ]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    expect(await adapter.messages("s1")).toHaveLength(1);
  });

  it("never calls thread/resume: browsing must not take the thread writer", async () => {
    // Regression: codex 0.154 gives each thread one exclusive writer, and
    // thread/resume takes it. Opening a session that a live codex session
    // already owns (aweswitch's per-account terminals) failed with
    // "thread ... already has an active writer", so those sessions looked
    // undiscoverable. Read-only browsing goes through thread/read.
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    await adapter.messages("s1");
    expect(callsOf("thread/read")).toHaveLength(1);
    expect(callsOf("thread/resume")).toHaveLength(0);
  });

  it("re-lists a cold paginated thread's turns after one resume", async () => {
    // codex 0.154 keeps paginated turns in a per-home sqlite store and only
    // projects a rollout into it on write operations, so a thread imported
    // from another account home (awefork's multihome continue flow) lists
    // zero turns until something loads it once — fork's item lookup included.
    let listCalls = 0;
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        ++listCalls === 1 ? { data: [], nextCursor: null } : turnPageFixture([TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    const rows = await adapter.messages("s1");
    expect(rows.map((r) => r.id)).toEqual(["u1", "turn-1"]);
    expect(callsOf("thread/resume")).toHaveLength(1);
    expect(callsOf("thread/turns/list")).toHaveLength(2);
  });

  it("keeps a cold thread's empty browse when the resume is refused", async () => {
    // A live writer elsewhere refuses the resume; browse stays read-only and
    // empty instead of erroring or spinning on retries.
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "thread/turns/list": () => ({ data: [], nextCursor: null }),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    expect(await adapter.messages("s1")).toEqual([]);
    expect(callsOf("thread/resume")).toHaveLength(1);
    // A refused resume skips the re-walk — nothing could have changed.
    expect(callsOf("thread/turns/list")).toHaveLength(1);
  });

  it("falls back to thread/resume on CLIs without thread/read", async () => {
    // Pre-0.154 has no thread/read — and no writer lock to collide with, so
    // resume is the right (and only) way to load the thread there.
    const { client, callsOf } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.153.1",
    });

    const rows = await adapter.messages("s1");
    expect(callsOf("thread/resume")).toHaveLength(1);
    expect(callsOf("thread/read")).toHaveLength(0);
    expect(rows[0]).toMatchObject({ modelId: "gpt-5-codex" });
  });

  it("reports the turn's context tokens when the turn carries usage", async () => {
    // codex 0.163's turns/list omits usage today (it only arrives live via
    // thread/tokenUsage/updated), so this fixture is the shape a build that
    // projects usage onto the turn would serve — the mapping must already be
    // able to read it. `last` is the turn's own step; `total` accumulates the
    // whole thread and must not win.
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        turnPageFixture([
          {
            ...TURN_FIXTURE,
            usage: {
              total: { totalTokens: 54559, inputTokens: 54549, outputTokens: 10 },
              last: {
                totalTokens: 30351,
                inputTokens: 30346,
                cachedInputTokens: 24064,
                outputTokens: 5,
              },
            },
          },
        ]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    expect(rows[1]).toMatchObject({ role: "assistant", contextTokens: 30351 });
    // The user row never carries a footprint.
    expect(rows[0].contextTokens).toBeUndefined();
  });

  it("sums the usage parts when the backend reports no total", async () => {
    // Same rule as opencode/zcode: no total → input + output + reasoning +
    // cacheRead + cacheWrite, where codex spells the cache pair
    // cachedInputTokens / cacheWriteInputTokens.
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        turnPageFixture([
          {
            ...TURN_FIXTURE,
            usage: {
              last: {
                inputTokens: 30346,
                cachedInputTokens: 24064,
                cacheWriteInputTokens: 0,
                outputTokens: 5,
                reasoningOutputTokens: 0,
              },
            },
          },
        ]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    expect(rows[1]).toMatchObject({ contextTokens: 30346 + 24064 + 0 + 5 + 0 });
  });

  it("omits contextTokens when the turn reports no usage (codex 0.163)", async () => {
    // Regression guard for the real shape: 0.163's turns/list carries no usage
    // at all, and the context meter must read that as "unknown", not zero.
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const rows = await adapter.messages("s1");
    expect(rows[1].contextTokens).toBeUndefined();
  });

  it("attributes each turn the model its own rollout turn_context recorded", async () => {
    // Regression: a model switched mid-session left every earlier turn of the
    // session displaying the thread's new model — the canvas card, the message
    // list and the composer's branch mirror all read it from there. The
    // thread/read answer below is the post-switch state; the first turn must
    // keep the settings it actually ran with.
    const { client } = fakeClient({
      "thread/read": () => ({
        thread: {
          ...THREAD_FIXTURE,
          model: "stepfun-cn-2/step-5-preview",
          reasoningEffort: "high",
        },
      }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE, SWITCHED_TURN_FIXTURE]),
    });
    const asked: string[] = [];
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      turnContexts: async (sessionId) => {
        asked.push(sessionId);
        return {
          "turn-1": { model: "gpt-6.1-sol", effort: "ultra" },
          "turn-2": { model: "stepfun-cn-2/step-5-preview", effort: "high" },
        };
      },
    });

    const rows = await adapter.messages("s1");
    expect(asked).toEqual(["s1"]);
    expect(rows.map((row) => [row.id, row.modelId, row.variant])).toEqual([
      ["u1", "gpt-6.1-sol", "ultra"],
      ["turn-1", "gpt-6.1-sol", "ultra"],
      ["u2", "stepfun-cn-2/step-5-preview", "high"],
      ["turn-2", "stepfun-cn-2/step-5-preview", "high"],
    ]);
  });

  it("falls back to the thread's settings for turns the rollout has no context for", async () => {
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE, SWITCHED_TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      turnContexts: async () => ({
        "turn-1": { model: "gpt-6.1-sol", effort: "ultra" },
      }),
    });

    const rows = await adapter.messages("s1");
    expect(rows.map((row) => [row.id, row.modelId, row.variant])).toEqual([
      ["u1", "gpt-6.1-sol", "ultra"],
      ["turn-1", "gpt-6.1-sol", "ultra"],
      ["u2", "gpt-5-codex", "high"],
      ["turn-2", "gpt-5-codex", "high"],
    ]);
  });
});

describe("createCodexAdapter prompt()", () => {
  it("resumes the thread before turn/start, which only sees loaded threads", async () => {
    // Reads deliberately no longer load a thread (no writer), so turn/start
    // would answer "thread not found" unless prompt resumes first.
    const { client, callsOf } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => ({ turn: { id: "turn-9" } }),
      "account/read": () => ({ account: { type: "chatgpt" } }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    await adapter.prompt("s1", "继续", null);

    const methods = callsOf("thread/resume").length;
    expect(methods).toBe(1);
    expect(callsOf("turn/start")).toHaveLength(1);
  });

  it("skips resume for a fresh thread with no rollout yet (codex 0.163 wording)", async () => {
    // Regression: a brand-new thread/start session has no rollout until its
    // first turn; 0.163's thread/resume refuses it with "no rollout found
    // for thread id", which surfaced as an error toast on every new codex
    // session's first prompt.
    const { client, callsOf } = fakeClient({
      "thread/resume": () => {
        throw new Error("no rollout found for thread id s1");
      },
      "turn/start": () => ({ turn: { id: "turn-9" } }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    await adapter.prompt("s1", "你好", null);

    expect(callsOf("turn/start")).toHaveLength(1);
  });

  it("explains a refused writer instead of echoing codex's lock wording", async () => {
    const { client } = fakeClient({
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "turn/start": () => ({ turn: { id: "turn-9" } }),
      "account/read": () => ({ account: { type: "chatgpt" } }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));
    // The fork recovery above takes this path's place: see the next test.
    await expect(adapter.prompt("s1", "继续", null)).rejects.toThrow(/active writer/);

    const error = events.find((e) => e.type === "server.error");
    expect(error).toMatchObject({ sessionId: "s1", message: OWNED_ELSEWHERE_MESSAGE });
  });

  it("continues in a fork when the thread's writer is refused", async () => {
    // codex 0.163's managed daemon holds the writer lock long after the turn
    // ended (rollout minutes stale, fd still open), so "close the other
    // window" is advice nobody can follow. thread/fork is not gated on that
    // lock, so prompt recovers there: the message runs, history comes along.
    const { client, callsOf } = fakeClient({
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "thread/fork": () => ({
        thread: { id: "fork-9", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
      "turn/start": (params) => ({ turn: { id: `turn-${params.threadId}` } }),
    });
    const lineagePath = await tempLineagePath();
    const created: string[] = [];
    const adapter = createCodexAdapter({
      client,
      lineagePath,
      cliVersion: "0.163.0",
      forkCreated: (forked) => created.push(forked.id),
    });

    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));
    await adapter.prompt("s1", "继续", null);

    // The message runs on the fork, never on the locked thread.
    const turnStarts = callsOf("turn/start");
    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.params).toMatchObject({ threadId: "fork-9" });
    expect(callsOf("thread/fork")[0]?.params).toMatchObject({ threadId: "s1" });

    // The fork is a real branch in the canvas, and the user is told — as a
    // continuation, not a failure: the renderer keeps the optimistic prompt
    // row and follows the fork instead of settling the run as dead.
    const saved = JSON.parse(await readFile(lineagePath, "utf8"));
    expect(saved["fork-9"]).toMatchObject({ parentId: "s1", atMessageId: null });
    const continued = events.find((e) => e.type === "session.branchContinued");
    expect(continued).toMatchObject({ sessionId: "s1", forkedSessionId: "fork-9" });
    expect(continued?.message).toContain(OWNED_ELSEWHERE_MESSAGE);
    expect(continued?.message).toContain("fork-9");
    expect(events.find((e) => e.type === "server.error")).toBeUndefined();
    // The host learns the fork here: it is the only notice a branch cut
    // inside prompt() gives, and thread/list will not carry it until its
    // first own turn.
    expect(created).toEqual(["fork-9"]);
  });

  it("reports the writer conflict when the recovery fork is refused too", async () => {
    const { client, callsOf } = fakeClient({
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "thread/fork": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "turn/start": () => ({ turn: { id: "turn-9" } }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));
    await expect(adapter.prompt("s1", "继续", null)).rejects.toThrow(/active writer/);

    expect(callsOf("turn/start")).toHaveLength(0);
    const error = events.find((e) => e.type === "server.error");
    expect(error).toMatchObject({ sessionId: "s1", message: OWNED_ELSEWHERE_MESSAGE });
  });
});

describe("createCodexAdapter prompt() attachments", () => {
  const image = (filename: string): PromptAttachment => ({
    mime: "image/png",
    filename,
    dataUrl: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
  });
  const textFile = (filename: string, body: string): PromptAttachment => ({
    mime: "text/plain",
    filename,
    dataUrl: `data:text/plain;base64,${Buffer.from(body).toString("base64")}`,
  });

  /** Records what main's real stager would do, without touching the disk. */
  function fakeStager() {
    const state = { calls: [] as PromptAttachment[][], cleanups: 0 };
    const stageImages = (images: readonly PromptAttachment[]) => {
      state.calls.push([...images]);
      return {
        paths: images.map((_, index) => `/staged/image-${index}.png`),
        cleanup: () => {
          state.cleanups += 1;
        },
      };
    };
    return { state, stageImages };
  }

  const promptClient = () =>
    fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => ({ turn: { id: "turn-9" } }),
      "account/read": () => ({ account: { type: "chatgpt" } }),
    });

  it("sends images as localImage items and inlines text attachments", async () => {
    // Verified against codex 0.164's app-server: turn/start's input takes
    // {type:"localImage", path} for images; non-image files have no input
    // item, so they ride the prompt text as named sections (pi's trade).
    const { client, callsOf } = promptClient();
    const { state, stageImages } = fakeStager();
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      stageImages,
    });

    await adapter.prompt("s1", "看看这两张图", null, [
      image("one.png"),
      textFile("notes.txt", "第一行\n第二行"),
      image("two.png"),
    ]);

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.map((a) => a.filename)).toEqual(["one.png", "two.png"]);
    expect(callsOf("turn/start")[0]?.params).toEqual({
      threadId: "s1",
      input: [
        { type: "localImage", path: "/staged/image-0.png" },
        { type: "localImage", path: "/staged/image-1.png" },
        { type: "text", text: "看看这两张图\n\n--- notes.txt ---\n第一行\n第二行" },
      ],
    });
  });

  it("skips images when no stager is injected (tests, degraded mains)", async () => {
    const { client, callsOf } = promptClient();
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    await adapter.prompt("s1", "只有文字", null, [image("one.png")]);

    expect(callsOf("turn/start")[0]?.params).toEqual({
      threadId: "s1",
      input: [{ type: "text", text: "只有文字" }],
    });
  });

  it("releases the staged files when the turn ends", async () => {
    const { client, notify } = promptClient();
    const { state, stageImages } = fakeStager();
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      stageImages,
    });
    await adapter.subscribe(() => {});

    await adapter.prompt("s1", "看图", null, [image("one.png")]);
    expect(state.cleanups).toBe(0);

    notify("turn/completed", { threadId: "s1", turn: { id: "turn-9" } });
    expect(state.cleanups).toBe(1);
  });

  it("releases the staged files on the idle status twin too", async () => {
    // A dropped turn/completed must not leak the temp dir until the next
    // prompt; the idle twin is the second end-of-turn signal.
    const { client, notify } = promptClient();
    const { state, stageImages } = fakeStager();
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      stageImages,
    });
    await adapter.subscribe(() => {});

    await adapter.prompt("s1", "看图", null, [image("one.png")]);
    notify("thread/status/changed", { threadId: "s1", status: { type: "idle" } });
    expect(state.cleanups).toBe(1);
  });

  it("releases the staged files when turn/start fails", async () => {
    // No turn means nothing will ever read the files.
    const { client } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => {
        throw new Error("codex prompt failed: nope");
      },
      "account/read": () => ({ account: { type: "chatgpt" } }),
    });
    const { state, stageImages } = fakeStager();
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      stageImages,
    });

    await expect(adapter.prompt("s1", "看图", null, [image("one.png")])).rejects.toThrow(/nope/);
    expect(state.cleanups).toBe(1);
  });

  it("re-keys the staged files to the fork when the writer is refused", async () => {
    // The recovery fork is where the turn actually runs, so the files must
    // outlive THAT thread's turn end — not the locked one's.
    const { client, notify } = fakeClient({
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "thread/fork": () => ({
        thread: { id: "fork-9", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
      "turn/start": () => ({ turn: { id: "turn-fork" } }),
    });
    const { state, stageImages } = fakeStager();
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.163.0",
      stageImages,
    });
    await adapter.subscribe(() => {});

    await adapter.prompt("s1", "看图", null, [image("one.png")]);

    // The locked thread's end frame is not the fork's: files stay.
    notify("turn/completed", { threadId: "s1", turn: { id: "turn-9" } });
    expect(state.cleanups).toBe(0);

    notify("turn/completed", { threadId: "fork-9", turn: { id: "turn-fork" } });
    expect(state.cleanups).toBe(1);
  });
});

describe("createCodexAdapter listSessions()", () => {
  it("paginates thread/list and sorts newest-first with title fallbacks", async () => {
    const { client } = fakeClient({
      "thread/list": (params) =>
        params.cursor === null
          ? {
              data: [
                {
                  id: "t1",
                  name: null,
                  preview: "预览文本",
                  cwd: "/a",
                  createdAt: 100,
                  updatedAt: 300,
                },
                { id: "t2", name: null, preview: null, cwd: "/b", createdAt: 100, updatedAt: 500 },
              ],
              nextCursor: "p2",
            }
          : {
              data: [
                {
                  id: "t3",
                  name: "命名会话",
                  forkedFromId: "t1",
                  cwd: "/c",
                  createdAt: 100,
                  updatedAt: 400,
                },
              ],
              nextCursor: null,
            },
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const sessions = await adapter.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["t2", "t3", "t1"]);
    expect(sessions.map((s) => s.title)).toEqual(["(untitled session)", "命名会话", "预览文本"]);
    expect(sessions.find((s) => s.id === "t3")).toMatchObject({
      parentSessionId: "t1",
      origin: "fork",
    });
    expect(sessions.find((s) => s.id === "t2")?.origin).toBe("root");
  });
});

describe("createCodexAdapter listModels()", () => {
  it("flattens pages, hides hidden models, and derives variants and attachment", async () => {
    const { client } = fakeClient({
      "model/list": () => ({
        data: [
          {
            id: "gpt-5",
            displayName: "GPT-5",
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
            inputModalities: ["text", "image"],
          },
          { id: "secret", displayName: "Secret", hidden: true },
          { id: "bare", displayName: null, hidden: false },
        ],
        nextCursor: null,
      }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const models = await adapter.listModels();
    expect(models.map((m) => m.modelId)).toEqual(["gpt-5", "bare"]);
    const gpt5 = models[0];
    expect(gpt5).toMatchObject({
      providerId: "codex",
      providerName: "Codex",
      modelName: "GPT-5",
      variants: ["low", "high"],
      attachment: true,
    });
    expect(models[1]).toMatchObject({
      modelName: "bare",
      variants: ["low", "medium", "high"],
      attachment: false,
    });
  });
});

describe("createCodexAdapter fork()", () => {
  it("translates atMessageId to the containing turn and sends lastTurnId on 0.154+", async () => {
    const { client, callsOf } = fakeClient({
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE]),
      "thread/fork": () => ({
        thread: {
          id: "fork-1",
          forkedFromId: "s1",
          cwd: "/demo",
          createdAt: 1726000099,
          updatedAt: 1726000099,
        },
      }),
    });
    const lineagePath = await tempLineagePath();
    const adapter = createCodexAdapter({ client, lineagePath, cliVersion: "0.154.0" });

    const forked = await adapter.fork("s1", "u1");
    expect(forked).toMatchObject({ id: "fork-1", origin: "fork", parentSessionId: "s1" });
    expect(callsOf("thread/fork")[0]?.params).toMatchObject({
      threadId: "s1",
      lastTurnId: "turn-1",
    });
    const saved = JSON.parse(await readFile(lineagePath, "utf8"));
    expect(saved["fork-1"]).toMatchObject({ parentId: "s1", atMessageId: "u1" });
  });

  it("loads the thread's own turns when turns/list first serves only the forked-from prefix", async () => {
    // Regression: a thread forked in the TUI lists its parent prefix without
    // ever being loaded, so the walk is non-empty and listTurns' empty-walk
    // resume never fires — fork at the thread's own turn used to throw
    // "Message not found" even though the rollout held it.
    let listCalls = 0;
    const { client, callsOf } = fakeClient({
      "thread/turns/list": () =>
        turnPageFixture(++listCalls === 1 ? [PREFIX_TURN] : [PREFIX_TURN, OWN_TURN]),
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "thread/fork": () => ({
        thread: { id: "fork-1", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    const forked = await adapter.fork("s1", "u1");
    expect(forked).toMatchObject({ id: "fork-1", parentSessionId: "s1" });
    expect(callsOf("thread/resume")).toHaveLength(1);
    expect(callsOf("thread/fork")[0]?.params).toMatchObject({
      threadId: "s1",
      lastTurnId: "turn-own",
    });
  });

  it("explains a refused writer when the load-on-miss cannot run", async () => {
    const { client } = fakeClient({
      "thread/turns/list": () => turnPageFixture([PREFIX_TURN]),
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "thread/fork": () => ({
        thread: { id: "fork-1", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    await expect(adapter.fork("s1", "u1")).rejects.toThrow(OWNED_ELSEWHERE_MESSAGE);
  });

  it("keeps reporting not-found when the item is missing after the load", async () => {
    const { client, callsOf } = fakeClient({
      "thread/turns/list": () => turnPageFixture([PREFIX_TURN, OWN_TURN]),
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "thread/fork": () => ({
        thread: { id: "fork-1", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    await expect(adapter.fork("s1", "missing")).rejects.toThrow(/not found in session/);
    expect(callsOf("thread/resume")).toHaveLength(1);
    expect(callsOf("thread/turns/list")).toHaveLength(2);
    expect(callsOf("thread/fork")).toHaveLength(0);
  });

  it("forks without a cut point when atMessageId is null", async () => {
    const { client, callsOf } = fakeClient({
      "thread/fork": () => ({
        thread: { id: "fork-2", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    const forked = await adapter.fork("s1", null);
    expect(forked.id).toBe("fork-2");
    expect(callsOf("thread/turns/list")).toHaveLength(0);
    expect(callsOf("thread/fork")[0]?.params).toEqual({ threadId: "s1" });
  });

  it("empty-context fork thread/starts in the parent's cwd — no fork, no writer taken", async () => {
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/start": () => ({
        thread: {
          id: "empty-1",
          cwd: "/demo/shop-api",
          createdAt: 1726000099,
          updatedAt: 1726000099,
        },
      }),
    });
    const lineagePath = await tempLineagePath();
    const adapter = createCodexAdapter({ client, lineagePath, cliVersion: "0.154.0" });

    const forked = await adapter.fork("s1", "u1", { context: "none" });
    // A fresh thread in the parent's cwd; the copy primitive never ran and
    // no writer was taken (read, not resume).
    expect(callsOf("thread/start")[0]?.params).toEqual({ cwd: "/demo/shop-api" });
    expect(callsOf("thread/fork")).toHaveLength(0);
    expect(callsOf("thread/resume")).toHaveLength(0);
    expect(forked).toMatchObject({ id: "empty-1", origin: "fork", parentSessionId: "s1" });
    const saved = JSON.parse(await readFile(lineagePath, "utf8"));
    expect(saved["empty-1"]).toMatchObject({ parentId: "s1", atMessageId: "u1" });
  });

  it("falls back to fork + rollback when the CLI predates lastTurnId", async () => {
    const { client, callsOf } = fakeClient({
      "thread/turns/list": (params) =>
        (params as { threadId?: string }).threadId === "fork-1"
          ? turnPageFixture([TURN_FIXTURE, { id: "turn-2", items: [] }])
          : turnPageFixture([TURN_FIXTURE]),
      "thread/fork": () => ({
        thread: { id: "fork-1", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
      "thread/rollback": () => ({}),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.150.0",
    });

    await adapter.fork("s1", "u1");
    expect(callsOf("thread/fork")[0]?.params).toEqual({ threadId: "s1" });
    expect(callsOf("thread/rollback")[0]?.params).toEqual({
      threadId: "fork-1",
      numTurns: 1,
    });
  });

  it("rejects when the message id belongs to no turn", async () => {
    const { client } = fakeClient({
      "thread/turns/list": () => turnPageFixture([]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    await expect(adapter.fork("s1", "ghost")).rejects.toThrow(/not found in session s1/);
  });

  it("resolves the fork point after loading a cold paginated thread", async () => {
    // Regression: forking at a message of an imported copy failed with
    // "Message … not found in session …" because the copy's paginated store
    // had never materialized; the item lookup must load the thread first.
    let listCalls = 0;
    const { client, callsOf } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () =>
        ++listCalls === 1 ? { data: [], nextCursor: null } : turnPageFixture([TURN_FIXTURE]),
      "thread/fork": () => ({
        thread: { id: "fork-3", forkedFromId: "s1", cwd: "/demo", createdAt: 1, updatedAt: 1 },
      }),
    });
    const adapter = createCodexAdapter({
      client,
      lineagePath: await tempLineagePath(),
      cliVersion: "0.154.0",
    });

    const forked = await adapter.fork("s1", "u1");
    expect(forked.id).toBe("fork-3");
    expect(callsOf("thread/fork")[0]?.params).toMatchObject({
      threadId: "s1",
      lastTurnId: "turn-1",
    });
  });
});

describe("createCodexAdapter prompt/abort", () => {
  it("starts a turn with model + effort and aborts via the active turn pair", async () => {
    const { client, callsOf } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => ({ turn: { id: "turn-9" } }),
      "turn/interrupt": () => ({}),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });

    await adapter.prompt("s1", "你好", { providerId: "codex", modelId: "gpt-5", variant: "low" });
    expect(callsOf("turn/start")[0]?.params).toMatchObject({
      threadId: "s1",
      input: [{ type: "text", text: "你好" }],
      model: "gpt-5",
      effort: "low",
    });

    await adapter.abort("s1");
    expect(callsOf("turn/interrupt")[0]?.params).toEqual({
      threadId: "s1",
      turnId: "turn-9",
    });
  });

  it("throws when aborting a session with no active turn", async () => {
    const { client } = fakeClient({});
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    await expect(adapter.abort("s1")).rejects.toThrow("No running turn in this session");
  });

  it("emits server.error, rejects, and leaves no active turn when turn/start fails", async () => {
    const { client } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => {
        throw new Error("Usage limit reached");
      },
      // A healthy account probe keeps the failure message raw (not auth).
      "account/read": () => ({ account: { accountId: "acc-1" } }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    // The renderer arms its completion watchdog only after prompt() resolves;
    // a swallowed error would leave a phantom run polling for a turn that
    // never started — so the failure must reject, not just emit.
    await expect(adapter.prompt("s1", "hi")).rejects.toThrow("Usage limit reached");
    expect(events).toEqual([
      {
        type: "server.error",
        sessionId: "s1",
        message: "codex prompt failed: Usage limit reached",
      },
    ]);
    // No turn id was recorded, so abort cannot interrupt a ghost turn.
    await expect(adapter.abort("s1")).rejects.toThrow("No running turn in this session");
  });
});

describe("createCodexAdapter notification mapping", () => {
  async function subscribedAdapter(
    handlers: Record<string, RequestHandler>,
  ): Promise<{ notify: (method: string, params: unknown) => void; events: AgentEvent[] }> {
    const fake = fakeClient(handlers);
    const adapter = createCodexAdapter({
      client: fake.client,
      lineagePath: await tempLineagePath(),
    });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    return { notify: fake.notify, events };
  }

  it("maps turn lifecycle: started → message.started, completed → idle", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("turn/started", { threadId: "s1", turn: { id: "turn-5" } });
    notify("turn/completed", { threadId: "s1", turn: { id: "turn-5" } });
    expect(events).toEqual([
      { type: "message.started", sessionId: "s1", messageId: "turn-5" },
      { type: "session.idle", sessionId: "s1" },
    ]);
  });

  it("clears the active turn on an idle status change, not just turn/completed", async () => {
    // Regression: a dropped turn/completed frame left a stale turnId, so a
    // later abort interrupted an already-finished turn and surfaced codex's
    // raw RPC error instead of the friendly no-active-turn message.
    const fake = fakeClient({ "turn/interrupt": () => ({}) });
    const adapter = createCodexAdapter({
      client: fake.client,
      lineagePath: await tempLineagePath(),
    });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    fake.notify("turn/started", { threadId: "s1", turn: { id: "turn-5" } });
    // turn/completed is lost; the idle status twin arrives instead.
    fake.notify("thread/status/changed", { threadId: "s1", status: { type: "idle" } });
    expect(events.map((e) => e.type)).toEqual(["message.started", "session.idle"]);
    await expect(adapter.abort("s1")).rejects.toThrow("No running turn in this session");
  });

  it("reports a failed turn as server.error before idle", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("turn/completed", {
      threadId: "s1",
      turn: { id: "turn-5", error: { message: "context overflow" } },
    });
    expect(events.map((e) => e.type)).toEqual(["server.error", "session.idle"]);
    expect(events[0]).toMatchObject({ sessionId: "s1", message: "codex: context overflow" });
  });

  it("maps stream deltas: agent text, reasoning, and summary parts", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("item/agentMessage/delta", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "a1",
      delta: "he",
    });
    notify("item/reasoning/textDelta", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "r1",
      delta: "想",
    });
    notify("item/reasoning/summaryTextDelta", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "r1",
      delta: "摘",
    });
    expect(events).toEqual([
      {
        type: "message.delta",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "a1",
        kind: "text",
        delta: "he",
      },
      {
        type: "message.delta",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "r1",
        kind: "thinking",
        delta: "想",
      },
      {
        type: "message.delta",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "r1:summary",
        kind: "thinking",
        delta: "摘",
      },
    ]);
  });

  it("maps item lifecycle snapshots with millisecond timestamps intact", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-5",
      startedAtMs: 1726000000123,
      item: { type: "agentMessage", id: "a1", text: "" },
    });
    notify("item/completed", {
      threadId: "s1",
      turnId: "turn-5",
      completedAtMs: 1726000009876,
      item: { type: "agentMessage", id: "a1", text: "完整回复" },
    });
    expect(events).toEqual([
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "a1",
        kind: "text",
        text: "",
        startedAt: 1726000000123,
        endedAt: null,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "a1",
        kind: "text",
        text: "完整回复",
        startedAt: null,
        endedAt: 1726000009876,
      },
    ]);
  });

  it("maps reasoning item snapshots with string[] content (codex 0.154 format)", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-5",
      startedAtMs: 1726000000123,
      item: { type: "reasoning", id: "r1", content: ["实时思考"] },
    });
    notify("item/completed", {
      threadId: "s1",
      turnId: "turn-5",
      completedAtMs: 1726000009876,
      item: { type: "reasoning", id: "r1", content: ["实时思考"], summary: ["完成"] },
    });
    // The summary snapshot lands in its own :summary part, mirroring the
    // summary deltas — folding it into the main part's snapshot too would
    // render it twice while the live stream is on screen.
    expect(events).toEqual([
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "r1",
        kind: "thinking",
        text: "实时思考",
        startedAt: 1726000000123,
        endedAt: null,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "r1",
        kind: "thinking",
        text: "实时思考",
        startedAt: null,
        endedAt: 1726000009876,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "r1:summary",
        kind: "thinking",
        text: "完成",
        startedAt: null,
        endedAt: 1726000009876,
      },
    ]);
  });

  it("maps thread status changes and structural updates", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("thread/status/changed", { threadId: "s1", status: { type: "active" } });
    notify("thread/status/changed", { threadId: "s1", status: { type: "idle" } });
    notify("thread/name/updated", { threadId: "s1" });
    expect(events).toEqual([
      { type: "message.started", sessionId: "s1", messageId: "" },
      { type: "session.idle", sessionId: "s1" },
      { type: "session.updated", sessionId: "s1" },
    ]);
  });

  it("streams tool items as live tool parts", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "it-1",
      startedAtMs: 1000,
      item: { type: "commandExecution", id: "it-1", command: "npm test" },
    });
    notify("item/completed", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "it-1",
      completedAtMs: 2000,
      item: { type: "commandExecution", id: "it-1", command: "npm test" },
    });
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "it-2",
      startedAtMs: 3000,
      item: { type: "fileChange", id: "it-2" },
    });
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-5",
      itemId: "it-3",
      startedAtMs: 4000,
      // An item kind with no chip mapping streams nothing.
      item: { type: "unknownKind", id: "it-3" },
    });
    expect(events.filter((e) => e.type === "message.part")).toEqual([
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "it-1",
        kind: "tool",
        text: "shell · npm test",
        startedAt: 1000,
        endedAt: null,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "it-1",
        kind: "tool",
        text: "shell · npm test",
        startedAt: null,
        endedAt: 2000,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-5",
        partId: "it-2",
        kind: "tool",
        text: "patch",
        startedAt: 3000,
        endedAt: null,
      },
    ]);
  });

  it("previews the command in shell chips: argv array, missing command, truncation", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-6",
      itemId: "c1",
      startedAtMs: 1000,
      // Some codex builds send argv words, not a joined line.
      item: { type: "commandExecution", id: "c1", command: ["rg", "rate", "limit"] },
    });
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-6",
      itemId: "c2",
      startedAtMs: 2000,
      // No readable command falls back to the bare tool name.
      item: { type: "commandExecution", id: "c2" },
    });
    notify("item/started", {
      threadId: "s1",
      turnId: "turn-6",
      itemId: "c3",
      startedAtMs: 3000,
      item: {
        type: "commandExecution",
        id: "c3",
        command: "rg --json --hidden -g '!node_modules' pattern src/shared",
      },
    });
    expect(events.filter((e) => e.type === "message.part")).toEqual([
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-6",
        partId: "c1",
        kind: "tool",
        text: "shell · rg rate limit",
        startedAt: 1000,
        endedAt: null,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-6",
        partId: "c2",
        kind: "tool",
        text: "shell",
        startedAt: 2000,
        endedAt: null,
      },
      {
        type: "message.part",
        sessionId: "s1",
        messageId: "turn-6",
        partId: "c3",
        kind: "tool",
        text: "shell · rg --json --hidden -g '!…",
        startedAt: 3000,
        endedAt: null,
      },
    ]);
  });

  it("announces auto compaction like a finished summarize", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("thread/compacted", { threadId: "s1" });
    expect(events).toEqual([
      { type: "session.updated", sessionId: "s1" },
      { type: "session.compressed", sessionId: "s1" },
    ]);
  });

  it("surfaces fatal error notifications but skips ones codex will retry", async () => {
    const { notify, events } = await subscribedAdapter({});
    notify("error", { threadId: "s1", willRetry: true, error: { message: "transient" } });
    expect(events).toHaveLength(0);
    notify("error", { threadId: "s1", willRetry: false, error: { message: "stream dead" } });
    expect(events).toEqual([
      { type: "server.error", sessionId: "s1", message: "codex: stream dead" },
    ]);
  });

  it("emits the auth banner once at subscribe time", async () => {
    const fake = fakeClient({});
    const adapter = createCodexAdapter({
      client: fake.client,
      lineagePath: await tempLineagePath(),
      authMessage: "codex 未登录或无可用账号",
    });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    expect(events).toEqual([{ type: "server.error", message: "codex 未登录或无可用账号" }]);
  });
});

describe("createCodexAdapter unsupported surfaces", () => {
  it("returns no attachments and refuses single-message delete", async () => {
    const { client } = fakeClient({});
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    expect(await adapter.messageAttachments("s1", "u1")).toEqual([]);
    await expect(adapter.deleteMessage("s1", "u1")).rejects.toThrow(
      "codex does not support deleting a single message",
    );
  });

  it("refuses detached export — codex fork linkage lives in the backend", async () => {
    const { client } = fakeClient({});
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    await expect(adapter.exportSession("s1", null)).rejects.toThrow(
      "codex does not support exporting a detached session",
    );
  });

  it("deletes a thread and its lineage record", async () => {
    const { client, callsOf } = fakeClient({
      "thread/delete": () => ({}),
    });
    const lineagePath = await tempLineagePath();
    const adapter = createCodexAdapter({ client, lineagePath });
    // Seed a lineage entry to verify the delete prunes it.
    const { recordFork } = await import("../src/shared/lineage-store");
    await recordFork(lineagePath, "s1", { parentId: "root", atMessageId: null, createdAt: 1 });

    await adapter.deleteSession("s1");
    expect(callsOf("thread/delete")[0]?.params).toEqual({ threadId: "s1" });
    expect(JSON.parse(await readFile(lineagePath, "utf8"))).toEqual({});
  });

  it("compacts by starting a codex compaction turn and announcing it", async () => {
    const { client, callsOf } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "thread/compact/start": () => ({}),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await adapter.compress("s1", { providerId: "codex", modelId: "gpt-5-codex" });

    expect(callsOf("thread/compact/start")[0]?.params).toEqual({ threadId: "s1" });
    // codex compacts as a turn of its own, so the run streams through the
    // normal frames; the announce is what the renderer's toast keys on.
    expect(events).toEqual([{ type: "session.compressed", sessionId: "s1" }]);
  });

  it("names a writer conflict on compact instead of the raw RPC error", async () => {
    const { client } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/resume": () => {
        throw new Error("thread s1 already has an active writer");
      },
      "thread/compact/start": () => ({}),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    await expect(
      adapter.compress("s1", { providerId: "codex", modelId: "gpt-5-codex" }),
    ).rejects.toThrow(OWNED_ELSEWHERE_MESSAGE);
  });
});

// ── live usage → context meter ───────────────────────────────────────────────

describe("createCodexAdapter live token usage", () => {
  /** A live `thread/tokenUsage/updated` frame, as codex 0.163 sends it. */
  const USAGE_FRAME = {
    threadId: "s1",
    turnId: "turn-1",
    tokenUsage: {
      total: { totalTokens: 99_999, inputTokens: 90_000, outputTokens: 9_999 },
      last: {
        totalTokens: 24_316,
        inputTokens: 24_311,
        cachedInputTokens: 13_184,
        outputTokens: 5,
      },
      modelContextWindow: 828_400,
    },
  };

  async function subscribedAdapter() {
    const { client, notify } = fakeClient({
      "thread/read": () => ({ thread: THREAD_FIXTURE }),
      "thread/turns/list": () => turnPageFixture([TURN_FIXTURE]),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));
    return { adapter, notify, events };
  }

  it("stamps the recorded usage onto the turn that produced it", async () => {
    const { adapter, notify } = await subscribedAdapter();

    notify("thread/tokenUsage/updated", USAGE_FRAME);

    const rows = await adapter.messages("s1");
    const assistant = rows.find((r) => r.role === "assistant");
    // `last`, not `total`: total accumulates the whole thread and would
    // inflate the meter on every later turn.
    expect(assistant).toMatchObject({
      id: "turn-1",
      contextTokens: 24_316,
      contextWindow: 828_400,
    });
  });

  it("keeps the footprint across a reload that carries no usage", async () => {
    // codex's turn list reports no usage, so without the recorded frame the
    // meter would blank on every reload.
    const { adapter, notify } = await subscribedAdapter();

    notify("thread/tokenUsage/updated", USAGE_FRAME);
    await adapter.messages("s1");

    const rows = await adapter.messages("s1");
    expect(rows.find((r) => r.role === "assistant")).toMatchObject({
      contextTokens: 24_316,
      contextWindow: 828_400,
    });
  });

  it("leaves the row alone when the frame carried no window", async () => {
    const { adapter, notify } = await subscribedAdapter();

    notify("thread/tokenUsage/updated", {
      ...USAGE_FRAME,
      tokenUsage: { last: { totalTokens: 4_000 } },
    });

    const assistant = (await adapter.messages("s1")).find((r) => r.role === "assistant");
    expect(assistant).toMatchObject({ contextTokens: 4_000 });
    expect(assistant?.contextWindow).toBeUndefined();
  });

  it("nudges a session refresh so the meter paints before the idle reload", async () => {
    const { adapter, notify, events } = await subscribedAdapter();

    notify("thread/tokenUsage/updated", USAGE_FRAME);

    expect(events).toEqual([{ type: "session.updated", sessionId: "s1" }]);
  });

  it("ignores a frame with no usage object", async () => {
    const { adapter, notify, events } = await subscribedAdapter();

    notify("thread/tokenUsage/updated", { threadId: "s1" });

    expect(events).toEqual([]);
    const rows = await adapter.messages("s1");
    expect(rows.find((r) => r.role === "assistant")?.contextTokens).toBeUndefined();
  });
});

describe("createCodexAdapter auth recovery", () => {
  it("says to run codex login when a failed turn/start coincides with no account", async () => {
    const { client, callsOf } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => {
        throw new Error("stream disconnected before headers");
      },
      "account/read": () => ({ account: null, requiresOpenaiAuth: true }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    // The original failure still rejects (no watchdog is armed), but the
    // toast names the actual problem and the remedy.
    await expect(adapter.prompt("s1", "hi")).rejects.toThrow("stream disconnected before headers");
    expect(events).toEqual([
      {
        type: "server.error",
        sessionId: "s1",
        message: CODEX_NOT_LOGGED_IN_MESSAGE,
      },
    ]);
    expect(callsOf("account/read")).toHaveLength(1);
  });

  it("keeps the raw failure message when an account is present", async () => {
    const { client } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => {
        throw new Error("thread not found");
      },
      "account/read": () => ({ account: { accountId: "acc-1" } }),
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    await expect(adapter.prompt("s1", "hi")).rejects.toThrow("thread not found");
    expect(events).toEqual([
      { type: "server.error", sessionId: "s1", message: "codex prompt failed: thread not found" },
    ]);
  });

  it("wraps the login hint with the probe error when account/read itself fails", async () => {
    const { client } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => {
        throw new Error("boom");
      },
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    await expect(adapter.prompt("s1", "hi")).rejects.toThrow("boom");
    expect(events).toEqual([
      {
        type: "server.error",
        sessionId: "s1",
        message: `${CODEX_NOT_LOGGED_IN_MESSAGE} (no fixture for account/read)`,
      },
    ]);
  });

  it("keeps the raw failure when the probe died with the connection", async () => {
    // Regression: a dead app-server failed both turn/start and account/read,
    // and the dead probe used to win the toast as "not logged in" — login
    // advice for a crash. A connection-loss probe says nothing about auth.
    const { client } = fakeClient({
      "thread/resume": () => ({ thread: THREAD_FIXTURE }),
      "turn/start": () => {
        throw new Error("codex app-server connection lost");
      },
      "account/read": () => {
        throw new Error("codex app-server not connected");
      },
    });
    const adapter = createCodexAdapter({ client, lineagePath: await tempLineagePath() });
    const events: AgentEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    await expect(adapter.prompt("s1", "hi")).rejects.toThrow("connection lost");
    expect(events).toEqual([
      {
        type: "server.error",
        sessionId: "s1",
        message: "codex prompt failed: codex app-server connection lost",
      },
    ]);
  });
});

describe("createCodexAdapter server interactions", () => {
  async function interactionFixture() {
    const fake = fakeClient({});
    const adapter = createCodexAdapter({
      client: fake.client,
      lineagePath: await tempLineagePath(),
    });
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribe((event) => events.push(event));
    const requested = () =>
      events
        .filter(
          (event): event is Extract<AgentEvent, { type: "interaction.requested" }> =>
            event.type === "interaction.requested",
        )
        .map((event) => event.request);
    const errors = () =>
      events.filter(
        (event): event is Extract<AgentEvent, { type: "server.error" }> =>
          event.type === "server.error",
      );
    return { adapter, fake, unsubscribe, requested, errors };
  }

  it("normalizes a command approval and writes the user's decision back", async () => {
    const { adapter, fake, requested } = await interactionFixture();
    const pending = fake.serverRequest("item/commandExecution/requestApproval", {
      threadId: "s1",
      command: "npm test",
      cwd: "/demo/shop-api",
      reason: "verify the fix",
    });

    const [request] = requested();
    expect(request).toMatchObject({
      kind: "command-approval",
      sessionId: "s1",
      title: "Run this command?",
      command: "npm test",
      cwd: "/demo/shop-api",
      reason: "verify the fix",
    });
    // The wire reply is the protocol's accept shape; the renderer never sees
    // the synthetic requestId and the JSON-RPC id stays inside main.
    adapter.respondInteraction(request.requestId, { decision: "allow" });
    await expect(pending).resolves.toEqual({ decision: "accept" });
  });

  it("declines a file approval and surfaces the requested grant root", async () => {
    const { adapter, fake, requested } = await interactionFixture();
    const pending = fake.serverRequest("item/fileChange/requestApproval", {
      threadId: "s1",
      grantRoot: "/demo/shop-api",
      reason: "patch login.ts",
    });

    const [request] = requested();
    expect(request).toMatchObject({
      kind: "file-approval",
      sessionId: "s1",
      grantRoot: "/demo/shop-api",
      reason: "patch login.ts",
    });
    adapter.respondInteraction(request.requestId, { decision: "deny" });
    await expect(pending).resolves.toEqual({ decision: "decline" });
  });

  it("maps permission approvals: deny nulls every scope, allow grants this turn only", async () => {
    const { adapter, fake, requested, unsubscribe } = await interactionFixture();
    const denyPending = fake.serverRequest("item/permissions/requestApproval", {
      threadId: "s1",
      permissions: { fileSystem: { read: ["."] }, network: true },
      reason: "fetch deps",
    });
    const [request] = requested();
    expect(request).toMatchObject({
      kind: "permission-approval",
      requested: ["file system access", "network access"],
    });
    adapter.respondInteraction(request.requestId, { decision: "deny" });
    await expect(denyPending).resolves.toEqual({
      permissions: { fileSystem: null, network: null },
    });

    const allowPending = fake.serverRequest("item/permissions/requestApproval", {
      threadId: "s1",
      permissions: { network: true },
    });
    const requests = requested();
    const second = requests[requests.length - 1];
    adapter.respondInteraction(second.requestId, { decision: "allow" });
    await expect(allowPending).resolves.toEqual({ permissions: {} });
    unsubscribe();
  });

  it("normalizes tool questions and submits the collected answers", async () => {
    const { adapter, fake, requested } = await interactionFixture();
    const pending = fake.serverRequest("item/tool/requestUserInput", {
      threadId: "s1",
      questions: [
        {
          id: "q1",
          header: "数据库",
          question: "用哪个迁移策略？",
          options: [{ label: "expand-contract" }, { label: "直接重写" }],
        },
        { id: "q2", question: "API token？", isSecret: true },
      ],
    });

    const [request] = requested();
    expect(request?.kind).toBe("user-input");
    if (request?.kind !== "user-input") throw new Error("unreachable");
    expect(request.questions).toEqual([
      {
        id: "q1",
        header: "数据库",
        question: "用哪个迁移策略？",
        options: [
          { label: "expand-contract", description: "" },
          { label: "直接重写", description: "" },
        ],
        isSecret: false,
      },
      {
        id: "q2",
        header: "Your input is needed",
        question: "API token？",
        options: undefined,
        isSecret: true,
      },
    ]);
    adapter.respondInteraction(request.requestId, {
      decision: "answers",
      answers: { q1: "expand-contract", q2: "sk-123" },
    });
    await expect(pending).resolves.toEqual({
      answers: { q1: "expand-contract", q2: "sk-123" },
    });
  });

  it("accepts and declines MCP elicitation requests", async () => {
    const { adapter, fake, requested } = await interactionFixture();
    const pending = fake.serverRequest("mcpServer/elicitation/request", {
      serverName: "aweshelf",
      message: "允许读取书架数据？",
    });

    const [request] = requested();
    expect(request).toMatchObject({
      kind: "mcp-elicitation",
      serverName: "aweshelf",
      detail: "允许读取书架数据？",
    });
    adapter.respondInteraction(request.requestId, { decision: "allow" });
    await expect(pending).resolves.toEqual({ action: "accept" });

    const secondPending = fake.serverRequest("mcpServer/elicitation/request", {
      serverName: "aweshelf",
      message: "再来一次",
    });
    const requests = requested();
    const second = requests[requests.length - 1];
    adapter.respondInteraction(second.requestId, { decision: "deny" });
    await expect(secondPending).resolves.toEqual({ action: "decline" });
  });

  it("refuses an unmappable request with a visible error and never hangs the turn", async () => {
    const { fake, requested, errors } = await interactionFixture();
    const pending = fake.serverRequest("item/commandExecution/requestApproval", {
      threadId: "s1",
      // A command approval without a command cannot be displayed safely.
    });
    await expect(pending).rejects.toThrow("awefork cannot handle the codex request");
    expect(requested()).toHaveLength(0);
    expect(errors()).toHaveLength(1);
    expect(errors()[0]?.message).toContain("item/commandExecution/requestApproval");
  });

  it("ignores replies for unknown request ids and stops after unsubscribe", async () => {
    const { adapter, fake, unsubscribe } = await interactionFixture();
    // Unknown id: a no-op, not a crash (the request may have timed out or the
    // dialog may have been cleaned up by an idle event).
    await adapter.respondInteraction("codex-interaction-999", { decision: "deny" });

    const pending = fake.serverRequest("item/fileChange/requestApproval", {
      threadId: "s1",
      reason: "edit",
    });
    unsubscribe();
    // Teardown drops every pending interaction; a late reply is a no-op.
    await adapter.respondInteraction("codex-interaction-1", { decision: "allow" });
    await expect(
      Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 20))]),
    ).resolves.toBeUndefined();
  });
});
