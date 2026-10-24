import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type {
  AgentEvent,
  ChatMessage,
  ModelChoice,
  PromptAttachment,
  SessionSummary,
  TagStore,
} from "../src/shared/types";

const ANCHOR: SessionSummary = {
  id: "anchor",
  title: "问题",
  directory: "/demo/project",
  parentSessionId: null,
  origin: "root",
  createdAt: 1,
  updatedAt: 1,
};
const MODELS: ModelChoice[] = [
  { providerId: "demo", modelId: "first", variant: "high" },
  { providerId: "demo", modelId: "second", variant: "low" },
  { providerId: "demo", modelId: "third" },
  { providerId: "demo", modelId: "fourth" },
];
const SETTINGS = { model: { providerId: "demo", modelId: "summarizer" }, length: "brief" as const };
const QUESTION = "怎样设计多模型阅读体验？";

function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined) throw new Error("Missing test fixture value");
  return value;
}

function row(
  id: string,
  role: "user" | "assistant",
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role,
    text,
    thinking: "",
    toolNames: [],
    modelId: null,
    providerId: null,
    variant: null,
    attachmentNames: [],
    createdAt: Date.now(),
    completedAt: role === "assistant" ? Date.now() : null,
    finish: role === "assistant" ? "stop" : null,
    outputTokens: null,
    error: null,
    ...extra,
  };
}

/** Real state singleton with scripted IPC; native history stays independently readable. */
async function bootState(options: { inheritedRows?: ChatMessage[]; tags?: string[] } = {}) {
  vi.resetModules();
  let handler: ((event: BackendEventEnvelope) => void) | undefined;
  const histories = new Map<string, ChatMessage[]>();
  const sessions: Record<string, SessionSummary[]> = { codex: [ANCHOR], opencode: [ANCHOR] };
  const counts: Record<string, number> = {};
  const key = (backend: BackendId, id: string) => `${backend}:${id}`;
  const promptFailures = new Set<string>();
  let forkDeferred: ((session: SessionSummary) => void) | null = null;
  const abort = vi.fn(async () => {});
  const tagStore: TagStore = {
    sessions: options.tags ? { [ANCHOR.id]: [...options.tags] } : {},
    colors: {},
    forkPref: { [ANCHOR.id]: true },
  };
  const setSessionTags = vi.fn(async (backend: BackendId, id: string, tags: string[]) => {
    // Electron IPC rejects Vue proxies even when their contents look like plain JSON.
    const args = structuredClone({ backend, id, tags });
    tagStore.sessions[args.id] = args.tags;
    return structuredClone(tagStore);
  });
  const fork = vi.fn(
    (_backend: BackendId, _id: string) =>
      new Promise<SessionSummary>((resolve) => {
        forkDeferred = resolve;
      }),
  );
  const saveComposer = vi.fn(async () => {});
  const resolveFork = (): void => {
    counts.codex = (counts.codex ?? 0) + 1;
    const id = `fork-${counts.codex}`;
    const session = { ...ANCHOR, id, parentSessionId: ANCHOR.id, origin: "fork" as const };
    required(sessions.codex).push(session);
    histories.set(key("codex", id), structuredClone(options.inheritedRows ?? []));
    const resolve = forkDeferred;
    forkDeferred = null;
    resolve?.(session);
  };
  const prompt = vi.fn(
    async (
      backend: BackendId,
      id: string,
      text: string,
      model: ModelChoice | null,
      attachments: PromptAttachment[] = [],
    ) => {
      structuredClone({ backend, id, text, model, attachments });
      if (promptFailures.has(key(backend, id))) throw new Error("provider unavailable");
      const history = histories.get(key(backend, id)) ?? [];
      histories.set(key(backend, id), [...history, row(`user-${history.length}`, "user", text)]);
    },
  );
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async (backend: BackendId) => ({
      sessions: [...required(sessions[backend])],
      lineage: {},
    }),
    messages: async (backend: BackendId, id: string) =>
      structuredClone(histories.get(key(backend, id)) ?? []),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => ANCHOR,
    fork,
    prompt,
    deleteSession: async () => [],
    deleteMessage: async () => {},
    abort,
    respondInteraction: async () => {},
    renameSession: async () => {},
    openSessionTerminal: async () => ({ ok: true }),
    tags: async () => structuredClone(tagStore),
    setSessionTags,
    pins: async () => [],
    togglePin: async () => [],
    dirs: async () => [],
    dirsAdd: async (_backend: BackendId, directory: string) => [directory],
    dirsRemove: async () => [],
    pickDirectory: async () => null,
    trash: async () => [],
    trashAdd: async () => [],
    trashRemove: async () => [],
    archive: async () => ({ sessions: [], directories: [] }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: async () => ({ sessions: [], directories: [] }),
    composer: async () => null,
    saveComposer,
    backends: async () => ({
      selected: "codex",
      backends: ["codex", "opencode"].map((id) => ({
        id,
        label: id,
        installed: true,
        version: null,
        versionWarning: null,
      })),
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.3.6", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (listener: (event: BackendEventEnvelope) => void) => {
      handler = listener;
      return () => {};
    },
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  await state.selectSession(ANCHOR.id);
  return {
    state,
    saveComposer,
    fork,
    resolveFork,
    prompt,
    setSessionTags,
    histories,
    key,
    promptFailures,
    abort,
    emit: (event: AgentEvent, backend: BackendId = "codex") => handler?.({ backend, event }),
    append(id: string, answer: ChatMessage, backend: BackendId = "codex") {
      const k = key(backend, id);
      histories.set(k, [...(histories.get(k) ?? []), answer]);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

async function settle(h: Awaited<ReturnType<typeof bootState>>, id: string, text: string) {
  h.append(id, row(`answer-${id}`, "assistant", text));
  h.emit({ type: "session.idle", sessionId: id });
  await vi.advanceTimersByTimeAsync(2_000);
}

describe("parallel reading groups", () => {
  it.each([2, 4])(
    "keeps %i exact source forks, variants, original question, and branch lookup",
    async (count) => {
      const h = await bootState();
      expect(await h.state.sendParallelPrompt(MODELS.slice(0, count), QUESTION, [], SETTINGS)).toBe(
        true,
      );
      const group = required(h.state.parallelGroups[0]);
      expect(group.prompt).toBe(QUESTION);
      expect(group.backend).toBe("codex");
      expect(group.anchorSessionId).toBe(ANCHOR.id);
      expect(group.targets.map((target) => target.sessionId)).toEqual(
        Array.from({ length: count }, (_, index) => `fork-${index + 1}`),
      );
      expect(group.targets.map((target) => target.model)).toEqual(MODELS.slice(0, count));
      for (const target of group.targets) {
        expect(h.state.parallelGroupForSession("codex", required(target.sessionId))).toBe(group);
        expect(h.state.parallelGroupForSession("opencode", required(target.sessionId))).toBeNull();
        expect(h.prompt).toHaveBeenCalledWith(
          "codex",
          target.sessionId,
          QUESTION,
          { ...target.model, variant: target.model?.variant ?? null },
          [],
        );
      }
    },
  );

  it("sends attachments, models, and inherited tags across IPC as structured-cloneable values", async () => {
    const tags = ["讨论", "多模型"];
    const attachments: PromptAttachment[] = [
      {
        filename: "context.txt",
        mime: "text/plain",
        dataUrl: "data:text/plain;base64,Y29udGV4dA==",
      },
    ];
    const h = await bootState({ tags });
    expect(
      await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, attachments, SETTINGS),
    ).toBe(true);
    const group = required(h.state.parallelGroups[0]);
    expect(group.targets.map((target) => target.status)).toEqual(["running", "running"]);
    expect(group.attachments).toEqual(attachments);
    expect(group.inheritedTags).toEqual(tags);
    expect(h.setSessionTags).toHaveBeenCalledTimes(2);
    for (const target of group.targets) {
      expect(h.setSessionTags).toHaveBeenCalledWith("codex", target.sessionId, tags);
      expect(h.prompt).toHaveBeenCalledWith(
        "codex",
        target.sessionId,
        QUESTION,
        target.model,
        attachments,
      );
    }
    await settle(h, "fork-1", "带上下文的第一份回答");
    await settle(h, "fork-2", "带上下文的第二份回答");
    expect(group.summaryStatus).toBe("running");
    await settle(h, required(group.summarySessionId), "附件场景汇总成功");
    expect(group.summaryStatus).toBe("done");
    expect(group.summaryText).toBe("附件场景汇总成功");
  });

  it("keeps groups separate when different backends mint identical native session ids", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const first = required(h.state.parallelGroups[0]);
    await h.state.switchBackend("opencode");
    await h.state.selectSession(ANCHOR.id);
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), "另一个后端的问题", [], SETTINGS);
    const second = required(h.state.parallelGroups.find((group) => group.backend === "opencode"));
    expect(second.id).not.toBe(first.id);
    expect(required(second.targets[0]).sessionId).toBe(required(first.targets[0]).sessionId);
    expect(h.state.parallelGroupForSession("codex", "fork-1")).toBe(first);
    expect(h.state.parallelGroupForSession("opencode", "fork-1")).toBe(second);
    h.append("fork-1", row("opencode-answer", "assistant", "只能属于 opencode"), "opencode");
    h.emit({ type: "session.idle", sessionId: "fork-1" }, "opencode");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(required(second.targets[0]).text).toBe("只能属于 opencode");
    expect(required(first.targets[0]).text).toBe("");
    expect(first.summaryText).toBe("");
  });

  it("retries only the failed target with its original model and question", async () => {
    const h = await bootState();
    h.promptFailures.add(h.key("codex", "fork-2"));
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const failed = required(group.targets[1]);
    expect(failed.status).toBe("failed");
    await settle(h, "fork-1", "成功回答保持不变");
    await settle(h, required(group.summarySessionId), "本轮只有一份可用回答");
    h.promptFailures.clear();
    h.prompt.mockClear();
    const retry = h.state.retryParallelTarget(group.id, failed.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.prompt).toHaveBeenCalledTimes(1);
    expect(h.prompt).toHaveBeenCalledWith("codex", failed.sessionId, QUESTION, MODELS[1], []);
    expect(failed.status).toBe("running");
    expect(failed.error).toBeNull();
    expect(required(group.targets[0]).text).toBe("成功回答保持不变");
    await settle(h, required(failed.sessionId), "重试模型的回答");
    await settle(h, required(group.summarySessionId), "包含重试回答的新汇总");
    await retry;
  });

  it("requires a completed final answer from this prompt, excluding tool calls and prior history", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const target = required(group.targets[0]);
    const k = h.key("codex", required(target.sessionId));
    const user = required(required(h.histories.get(k))[0]);
    h.histories.set(k, [
      row("old-answer", "assistant", "前一轮的结论"),
      user,
      row("intermediate", "assistant", "这只是中间思考，不能作为最终答案"),
      row("tool-step", "assistant", "调用工具中", { finish: "tool-calls" }),
      row("streaming", "assistant", "正文还没完成", { completedAt: null, finish: null }),
    ]);
    h.emit({ type: "session.idle", sessionId: required(target.sessionId) });
    await vi.advanceTimersByTimeAsync(400);
    expect(target.status).not.toBe("done");
    expect(target.text).toBe("");
    expect(group.summarySessionId).toBeNull();
    await settle(h, required(target.sessionId), "这才是本轮完整回答");
    expect(target.status).toBe("done");
    expect(target.text).toBe("这才是本轮完整回答");
  });

  it("does not reuse a fork's inherited answer when this exact question was already asked", async () => {
    const inheritedRows = [
      row("old-user", "user", QUESTION),
      row("old-answer", "assistant", "上一次相同问题的回答"),
    ];
    const h = await bootState({ inheritedRows });
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const target = required(group.targets[0]);
    expect(target.baselineMessageIds).toEqual(["old-user", "old-answer"]);
    // A successful send can precede visibility of its new user/assistant rows.
    h.histories.set(h.key("codex", required(target.sessionId)), inheritedRows);
    h.emit({ type: "session.idle", sessionId: required(target.sessionId) });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(target.status).toBe("unknown");
    expect(target.text).toBe("");
    expect(group.summarySessionId).toBeNull();
  });

  it("retains a successful answer when another send fails, and summarizes only usable sources", async () => {
    const h = await bootState();
    h.promptFailures.add(h.key("codex", "fork-2"));
    expect(await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS)).toBe(true);
    const group = required(h.state.parallelGroups[0]);
    expect(required(group.targets[1]).status).toBe("failed");
    await settle(h, "fork-1", "保留这份成功回答");
    expect(required(group.targets[0]).status).toBe("done");
    expect(required(group.targets[0]).text).toBe("保留这份成功回答");
    await settle(h, required(group.summarySessionId), "只有一份可用回答，不能声称共识。");
    expect(group.summarySourceIds).toEqual([required(group.targets[0]).id]);
    const summarySend = h.prompt.mock.calls.find((call) => call[1] === group.summarySessionId);
    expect(summarySend?.[2]).toContain("保留这份成功回答");
    expect(summarySend?.[2]).not.toContain("provider unavailable");
  });

  it("reads only the summary answer and resolves its native session back to the same group", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    await settle(h, "fork-1", "回答甲");
    await settle(h, "fork-2", "回答乙");
    expect(group.summarySessionId).toBeTruthy();
    expect(h.state.parallelGroupForSession("codex", required(group.summarySessionId))).toBe(group);
    expect(
      h.state.parallelGroupForSession("opencode", required(group.summarySessionId)),
    ).toBeNull();
    expect(group.summaryText).toBe("");
    await settle(h, required(group.summarySessionId), "结论：先读汇总，再看分歧。");
    expect(group.summaryStatus).toBe("done");
    expect(group.summaryText).toBe("结论：先读汇总，再看分歧。");
    expect(group.summaryText).not.toContain("独立回答");
  });

  it("can summarize available answers early, then refresh when the remaining model finishes", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    await settle(h, "fork-1", "先到的回答");
    expect(group.summarySessionId).toBeNull();
    const early = h.state.summarizeParallelGroup(group.id);
    await vi.advanceTimersByTimeAsync(0);
    const earlySessionId = required(group.summarySessionId);
    await settle(h, earlySessionId, "目前只有一份回答");
    await early;
    expect(group.summarySourceIds).toEqual([required(group.targets[0]).id]);
    expect(required(group.targets[1]).status).toBe("running");
    await settle(h, "fork-2", "后到的回答");
    expect(group.summarySessionId).not.toBe(earlySessionId);
    await settle(h, required(group.summarySessionId), "两份回答的完整汇总");
    expect(group.summarySourceIds).toEqual(group.targets.map((target) => target.id));
    expect(group.summaryText).toBe("两份回答的完整汇总");
    expect(h.state.parallelGroupForSession("codex", "fork-1")).toBe(group);
  });

  it("keeps summary failure visible and allows retry without discarding source answers", async () => {
    const h = await bootState();
    h.promptFailures.add(h.key("codex", "fork-3"));
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    await settle(h, "fork-1", "回答甲");
    await settle(h, "fork-2", "回答乙");
    expect(group.summaryStatus).toBe("failed");
    expect(group.summaryError).toContain("provider unavailable");
    h.promptFailures.clear();
    const retry = h.state.summarizeParallelGroup(group.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(group.summaryStatus).toBe("running");
    expect(group.summaryError).toBeNull();
    expect(group.targets.map((target) => target.text)).toEqual(["回答甲", "回答乙"]);
    await settle(h, required(group.summarySessionId), "重试后汇总成功");
    await retry;
    expect(group.summaryStatus).toBe("done");
    expect(group.summaryText).toBe("重试后汇总成功");
  });

  it("leaves the round unsummarized when the summary length is none", async () => {
    const h = await bootState();
    const noSummary = { model: SETTINGS.model, length: "none" as const };
    expect(await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], noSummary)).toBe(
      true,
    );
    const group = required(h.state.parallelGroups[0]);
    await settle(h, "fork-1", "回答甲");
    await settle(h, "fork-2", "回答乙");
    expect(group.targets.map((target) => target.text)).toEqual(["回答甲", "回答乙"]);
    expect(group.summaryStatus).toBe("skipped");
    expect(group.summarySessionId).toBeNull();
    expect(group.summaryText).toBe("");
    // Only the two source forks exist — no summary session was created.
    expect(h.fork).toHaveBeenCalledTimes(2);
  });

  it("summarizes a skipped round on demand", async () => {
    const h = await bootState();
    const noSummary = { model: SETTINGS.model, length: "none" as const };
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], noSummary);
    const group = required(h.state.parallelGroups[0]);
    await settle(h, "fork-1", "回答甲");
    await settle(h, "fork-2", "回答乙");
    const onDemand = h.state.summarizeParallelGroup(group.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(group.summaryStatus).toBe("running");
    await settle(h, required(group.summarySessionId), "事后汇总");
    await onDemand;
    expect(group.summaryStatus).toBe("done");
    expect(group.summaryText).toBe("事后汇总");
  });

  it("anchors a canvas draft's round at the draft's own fork point", async () => {
    const h = await bootState();
    h.state.openDraft({
      id: `${ANCHOR.id}:m1`,
      kind: "turn",
      sessionId: ANCHOR.id,
      messageId: "m1",
      title: "一轮",
      preview: "",
      toolNames: [],
      modelIds: [],
      model: null,
      createdAt: 1,
      durationMs: null,
      outputTokens: 0,
      error: null,
      col: 0,
      row: 0,
      x: 0,
      y: 0,
      height: 100,
    });
    h.state.setDraftText("草稿里的问题");
    expect(await h.state.sendDraftParallel(MODELS.slice(0, 2), SETTINGS)).toBe(true);
    const group = required(h.state.parallelGroups[0]);
    expect(group.anchorSessionId).toBe(ANCHOR.id);
    expect(group.anchorMessageId).toBe("m1");
    // Both source forks inherit the draft's turn — not the pane's selection.
    expect(h.fork).toHaveBeenCalledWith("codex", ANCHOR.id, "m1", undefined);
    // The round is out, so the draft is spent.
    expect(h.state.store.draft).toBeNull();
  });

  it("keeps draft edits made while a parallel send is accepting", async () => {
    const h = await bootState();
    h.state.openDraft({
      id: `${ANCHOR.id}:m1`,
      kind: "turn",
      sessionId: ANCHOR.id,
      messageId: "m1",
      title: "一轮",
      preview: "",
      toolNames: [],
      modelIds: [],
      model: null,
      createdAt: 1,
      durationMs: null,
      outputTokens: 0,
      error: null,
      col: 0,
      row: 0,
      x: 0,
      y: 0,
      height: 100,
    });
    h.state.setDraftText("旧问题");
    const sending = h.state.sendDraftParallel(MODELS.slice(0, 2), SETTINGS);
    await vi.advanceTimersByTimeAsync(0);
    h.state.setDraftText("继续编辑的问题");
    h.resolveFork();
    h.resolveFork();
    await sending;

    expect(h.state.store.draft?.text).toBe("继续编辑的问题");
    expect(h.saveComposer).not.toHaveBeenCalledWith("codex", null);
  });

  it("forks a ✂ draft's round with no ancestor history", async () => {
    const h = await bootState();
    h.state.openDraft({
      id: `${ANCHOR.id}:m1`,
      kind: "turn",
      sessionId: ANCHOR.id,
      messageId: "m1",
      title: "一轮",
      preview: "",
      toolNames: [],
      modelIds: [],
      model: null,
      createdAt: 1,
      durationMs: null,
      outputTokens: 0,
      error: null,
      col: 0,
      row: 0,
      x: 0,
      y: 0,
      height: 100,
    });
    h.state.setDraftContextMode("none");
    h.state.setDraftText("切断上下文的问题");
    expect(await h.state.sendDraftParallel(MODELS.slice(0, 2), SETTINGS)).toBe(true);
    const group = required(h.state.parallelGroups[0]);
    expect(group.contextMode).toBe("none");
    expect(h.fork).toHaveBeenCalledWith("codex", ANCHOR.id, "m1", { context: "none" });
  });

  it("keeps a failed re-summary from discarding the previous summary", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    await settle(h, "fork-1", "回答甲");
    await settle(h, "fork-2", "回答乙");
    await settle(h, required(group.summarySessionId), "第一版汇总");
    expect(group.summaryText).toBe("第一版汇总");
    const firstSourceIds = [...group.summarySourceIds];

    // A retry that fails must leave the readable summary and its provenance
    // in place — otherwise the panel would blank out a summary that worked.
    h.promptFailures.add(h.key("codex", "fork-4"));
    const retry = h.state.summarizeParallelGroup(group.id);
    await vi.advanceTimersByTimeAsync(0);
    await retry;
    expect(group.summaryStatus).toBe("failed");
    expect(group.summaryText).toBe("第一版汇总");
    expect(group.summarySourceIds).toEqual(firstSourceIds);
  });

  it("settles a target whose run never reports idle instead of hanging the round", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const target = required(group.targets[0]);
    // The prompt went out and the branch is marked running, but the backend
    // never publishes idle (a dropped SSE frame) and no answer row ever lands.
    // Two backstops must keep the round moving: the renderer's own watchdog,
    // then the round's own deadline. Without either it waits forever.
    expect(target.status).toBe("running");
    await settle(h, "fork-2", "另一份回答");
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(target.status).toBe("unknown");
    expect(target.error).toBeTruthy();
    // The round still finished: the usable answer was summarized.
    expect(group.summaryStatus).not.toBe("waiting");
    expect(group.summaryStatus).not.toBe("running");
  });

  it("cancels a silent target when the watchdog gives up on it", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const target = required(group.targets[0]);
    await settle(h, "fork-2", "另一份回答");
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(target.status).toBe("unknown");
    expect(h.abort).toHaveBeenCalledWith("codex", "fork-1");
  });

  it("does not start two retries for the same target", async () => {
    const h = await bootState();
    h.promptFailures.add(h.key("codex", "fork-2"));
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const failed = required(group.targets[1]);
    // Settle the healthy branch and its summary first for a clean baseline.
    await settle(h, "fork-1", "回答甲");
    await settle(h, required(group.summarySessionId), "第一版汇总");
    h.promptFailures.clear();
    h.prompt.mockClear();
    // Two clicks before the first await resolves: the second must be refused.
    // Only the guard matters here, so neither retry is driven to completion.
    void h.state.retryParallelTarget(group.id, failed.id);
    void h.state.retryParallelTarget(group.id, failed.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.prompt).toHaveBeenCalledTimes(1);
    expect(h.prompt).toHaveBeenCalledWith("codex", failed.sessionId, QUESTION, MODELS[1], []);
    // Claimed synchronously, so a third click cannot slip in either.
    expect(failed.status).not.toBe("failed");
  });

  it("stops a running target from the panel and records it as a retryable stop", async () => {
    const h = await bootState();
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const stopped = required(group.targets[0]);
    expect(stopped.status).toBe("running");
    // Settle the healthy branch first: the long advance below must not let
    // the watchdog settle THIS target's run before the stop is recorded.
    await settle(h, "fork-2", "未受影响的回答");
    await h.state.stopParallelTarget(group.id, stopped.id);
    expect(stopped.stopping).toBe(true);
    // The abort itself settles nothing in this harness; the deadline is what
    // ends the wait, and the stop must read as a stop — not a timeout.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(stopped.status).toBe("failed");
    expect(stopped.stopping).toBeFalsy();
    expect(stopped.error).toContain("重试");
    expect(required(group.targets[1]).status).toBe("done");
    await settle(h, required(group.summarySessionId), "只有一份回答的汇总");
    expect(group.summaryText).toBe("只有一份回答的汇总");
  });

  it("retries a failed target while the round's other targets are still running", async () => {
    const h = await bootState();
    h.promptFailures.add(h.key("codex", "fork-2"));
    await h.state.sendParallelPrompt(MODELS.slice(0, 2), QUESTION, [], SETTINGS);
    const group = required(h.state.parallelGroups[0]);
    const failed = required(group.targets[1]);
    expect(failed.status).toBe("failed");
    expect(required(group.targets[0]).status).toBe("running");
    h.promptFailures.clear();
    h.prompt.mockClear();
    const retry = h.state.retryParallelTarget(group.id, failed.id);
    await vi.advanceTimersByTimeAsync(0);
    // A fresh fork took the retry while the round was still busy.
    expect(h.prompt).toHaveBeenCalledTimes(1);
    expect(h.prompt).toHaveBeenCalledWith("codex", "fork-3", QUESTION, MODELS[1], []);
    // Retry's answer first, then the healthy branch: both sources are done by
    // the time either finishParallelRound proceeds, so exactly one summary is
    // created instead of an early one-source summary that would be replaced.
    await settle(h, "fork-3", "重试后的回答");
    await settle(h, "fork-1", "第一份回答");
    await settle(h, required(group.summarySessionId), "两份回答的汇总");
    await retry;
    expect(group.summarySourceIds).toEqual(group.targets.map((target) => target.id));
  });
});
