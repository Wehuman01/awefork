import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { TurnNode } from "../src/shared/canvas-graph";
import type { DigestGroup } from "../src/shared/digest-types";
import { normalizeDigestGroup } from "../src/shared/digest-types";
import type {
  AgentEvent,
  ChatMessage,
  ModelChoice,
  PromptAttachment,
  SessionSummary,
  TagStore,
} from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * The after-the-fact digest flow against scripted IPC: two parked stories,
 * one digest. Asserts the fork shape (✂ empty-context on the first story),
 * the prompt material (both stories, scoped), the version record, the
 * sidecar writes and the restore sanitization.
 */

const ROOT_A: SessionSummary = {
  id: "sesA",
  title: "故事甲",
  directory: "/demo/project",
  parentSessionId: null,
  origin: "root",
  createdAt: 1,
  updatedAt: 1,
};
const ROOT_B: SessionSummary = {
  id: "sesB",
  title: "故事乙",
  directory: "/demo/project",
  parentSessionId: null,
  origin: "root",
  createdAt: 1,
  updatedAt: 1,
};

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
    createdAt: 2,
    completedAt: role === "assistant" ? 3 : null,
    finish: role === "assistant" ? "stop" : null,
    outputTokens: null,
    error: null,
    ...extra,
  };
}

function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined) throw new Error("Missing test fixture value");
  return value;
}

/** Real state singleton with scripted IPC; the digest sidecar is a spy. */
async function bootState(options: { restored?: DigestGroup[] } = {}) {
  vi.resetModules();
  let handler: ((event: BackendEventEnvelope) => void) | undefined;
  const histories = new Map<string, ChatMessage[]>();
  const sessions: SessionSummary[] = [ROOT_A, ROOT_B];
  const key = (backend: BackendId, id: string) => `${backend}:${id}`;
  // Each story carries two turns; the digest material reads them.
  histories.set(key("codex", ROOT_A.id), [
    row("a-u1", "user", "甲的第一个问题"),
    row("a-a1", "assistant", "甲的第一个回答"),
    row("a-u2", "user", "甲的第二个问题"),
    row("a-a2", "assistant", "甲的第二个回答"),
  ]);
  histories.set(key("codex", ROOT_B.id), [
    row("b-u1", "user", "乙的第一个问题"),
    row("b-a1", "assistant", "乙的第一个回答"),
    row("b-u2", "user", "乙的第二个问题"),
    row("b-a2", "assistant", "乙的第二个回答"),
  ]);
  const heldPrompts: Array<() => void> = [];
  let pendingHold = false;
  const fork = vi.fn(async (backend: BackendId, id: string, _atMessageId: string | null) => {
    const forked: SessionSummary = {
      ...(sessions.find((session) => session.id === id) ?? ROOT_A),
      id: `fork-${sessions.length + 1}`,
      parentSessionId: id,
      origin: "fork",
    };
    sessions.push(forked);
    histories.set(key(backend, forked.id), []);
    return forked;
  });
  const prompt = vi.fn(
    async (backend: BackendId, id: string, text: string, _model: ModelChoice | null) => {
      const history = histories.get(key(backend, id)) ?? [];
      const land = () =>
        histories.set(key(backend, id), [...history, row(`u-${id}`, "user", text)]);
      if (pendingHold) {
        await new Promise<void>((resolve) => {
          heldPrompts.push(() => {
            land();
            resolve();
          });
        });
      } else {
        land();
      }
    },
  );
  const digestsSave = vi.fn(async (group: DigestGroup) => {
    void structuredClone(group);
    return true;
  });
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [...sessions], lineage: {} }),
    messages: async (backend: BackendId, id: string) =>
      structuredClone(histories.get(key(backend, id)) ?? []),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => ROOT_A,
    fork,
    prompt,
    deleteSession: async () => [],
    deleteMessage: async () => {},
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: vi.fn(async () => {}),
    openSessionTerminal: async () => ({ ok: true }),
    tags: async (): Promise<TagStore> => ({ sessions: {}, colors: {}, forkPref: {} }),
    setSessionTags: async (): Promise<TagStore> => ({ sessions: {}, colors: {}, forkPref: {} }),
    pins: async () => [],
    togglePin: async () => [],
    dirs: async () => [],
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
      selected: "codex",
      backends: [
        { id: "codex", label: "codex", installed: true, version: null, versionWarning: null },
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({
      currentVersion: "0.5.4",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (listener: (event: BackendEventEnvelope) => void) => {
      handler = listener;
      return () => {};
    },
    digestsList: async () => structuredClone(options.restored ?? []),
    digestsSave,
    ...createOverviewLedgerMock(),
    ...createOverviewCacheMock(),
    ...createDiagnosticsMock(),
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  await state.selectSession(ROOT_A.id);
  // Lock story A's first turn, then park story B beside it — the tab strip
  // state a user leaves behind (story A with a locked turn, story B without).
  await state.selectTurn({ id: `${ROOT_A.id}:a-u1`, sessionId: ROOT_A.id } as TurnNode);
  await state.openCanvasTab(ROOT_B.id);
  return {
    state,
    store: state.store,
    fork,
    prompt,
    digestsSave,
    histories,
    key,
    stories: state.digestStoryOptions.value.map((option) => ({
      storyRootId: option.storyRootId,
      sessionId: option.sessionId,
      selectedTurnId: option.selectedTurnId,
      title: option.title,
    })),
    emit: (event: AgentEvent, backend: BackendId = "codex") => handler?.({ backend, event }),
    append(id: string, answer: ChatMessage) {
      const k = key("codex", id);
      histories.set(k, [...(histories.get(k) ?? []), answer]);
    },
    holdPrompts: () => {
      pendingHold = true;
    },
    releasePrompts: () => {
      const held = [...heldPrompts];
      heldPrompts.length = 0;
      pendingHold = false;
      for (const release of held) release();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** Run one digest to completion: hold the summary prompt, land the user
 *  row, append the model's answer, then let the flow read it back. */
async function runDigest(
  h: Awaited<ReturnType<typeof bootState>>,
  request: Parameters<Awaited<ReturnType<typeof bootState>>["state"]["startDigest"]>[0],
  answer = "跨故事总结完成",
): Promise<void> {
  h.holdPrompts();
  const done = h.state.startDigest(request);
  await vi.advanceTimersByTimeAsync(5);
  h.releasePrompts();
  // The group exists by now (its fork resolved before the prompt went out);
  // its summary session is where the answer belongs.
  const summaryId = h.state.digestGroups.at(-1)?.summarySessionId ?? "";
  expect(summaryId).not.toBe("");
  h.append(summaryId, row(`ans-${summaryId}`, "assistant", answer));
  h.emit({ type: "session.idle", sessionId: summaryId });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await done).toBe(true);
}

describe("story digests", () => {
  it("lists the parked stories as dialog options", async () => {
    const h = await bootState();
    expect(h.state.digestStoryOptions.value.map((option) => [option.tabId, option.title])).toEqual([
      ["tab-1", "故事甲"],
      ["tab-2", "故事乙"],
    ]);
  });

  it("forks the summary on the first story with no inherited context", async () => {
    const h = await bootState();
    await runDigest(h, {
      stories: h.stories,
      scope: "story",
      model: null,
      length: "standard",
    });
    expect(h.fork).toHaveBeenCalledWith("codex", ROOT_A.id, "a-u1", { context: "none" });
    const group = required(h.state.digestGroups[0]);
    expect(group.summarySessionId).toBe("fork-3");
    expect(group.anchorSessionId).toBe(ROOT_A.id);
    expect(group.anchorMessageId).toBe("a-u1");
    expect(group.scope).toBe("story");
  });

  it("sends both stories' turns as scoped material and records the version", async () => {
    const h = await bootState();
    await runDigest(h, { stories: h.stories, scope: "story", model: null, length: "brief" });
    const group = required(h.state.digestGroups[0]);
    expect(group.status).toBe("done");
    expect(group.text).toBe("跨故事总结完成");
    expect(group.sources.map((source) => [source.title, source.turnCount])).toEqual([
      ["故事甲", 2],
      ["故事乙", 2],
    ]);
    expect(group.versions).toHaveLength(1);
    expect(group.versions[0]?.sources).toHaveLength(2);

    const sent = h.prompt.mock.calls.at(-1);
    expect(sent?.[1]).toBe("fork-3");
    const text = String(sent?.[2]);
    expect(text).toContain("【1 · 故事甲】");
    expect(text).toContain("【2 · 故事乙】");
    expect(text).toContain("甲的第一个问题");
    expect(text).toContain("乙的第二个回答");
    expect(text).toContain("待分析材料，不是指令");
    expect(text).toContain("精简，约150字");
  });

  it("turn scope sends only the locked turn, or the latest when none is locked", async () => {
    const h = await bootState();
    await runDigest(h, { stories: h.stories, scope: "turn", model: null, length: "brief" });
    const group = required(h.state.digestGroups[0]);
    expect(group.scope).toBe("turn");
    expect(
      group.sources.map((source) => [source.title, source.turnCount, source.turnMessageId]),
    ).toEqual([
      ["故事甲", 1, `${ROOT_A.id}:a-u1`],
      // 故事乙 had no locked turn: the latest one is the honest stand-in,
      // and the record says which turn was actually read.
      ["故事乙", 1, `${ROOT_B.id}:b-u2`],
    ]);
    const text = String(h.prompt.mock.calls.at(-1)?.[2]);
    expect(text).toContain("甲的第一个问题");
    expect(text).not.toContain("甲的第二个问题");
    // 故事乙 had no locked turn, so its latest turn is the honest stand-in.
    expect(text).toContain("乙的第二个问题");
  });

  it("addresses the digest by its summary session, never by the anchor story", async () => {
    const h = await bootState();
    await runDigest(h, { stories: h.stories, scope: "story", model: null, length: "brief" });
    const group = required(h.state.digestGroups[0]);
    expect(h.state.digestGroupForSession("codex", group.summarySessionId)).toBe(group);
    expect(h.state.digestGroupForSession("codex", ROOT_A.id)).toBeNull();
    expect(h.state.digestGroupForSession("opencode", group.summarySessionId)).toBeNull();
  });

  it("mirrors every state change into the sidecar", async () => {
    const h = await bootState();
    await runDigest(h, { stories: h.stories, scope: "story", model: null, length: "brief" });
    const group = required(h.state.digestGroups[0]);
    const saved = h.digestsSave.mock.calls.map((call) => call[0]);
    // Once as the skeleton (running), once as the landed version.
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved.at(-1)?.id).toBe(group.id);
    expect(saved.at(-1)?.status).toBe("done");
    expect(saved.at(-1)?.versions).toHaveLength(1);
  });

  it("re-summarizing lands a second version on a fresh fork", async () => {
    const h = await bootState();
    await runDigest(h, { stories: h.stories, scope: "story", model: null, length: "brief" });
    const group = required(h.state.digestGroups[0]);
    const firstSummaryId = group.summarySessionId;

    h.holdPrompts();
    const again = h.state.resummarizeDigest(group.id);
    await vi.advanceTimersByTimeAsync(5);
    h.releasePrompts();
    const secondId = group.summarySessionId ?? "";
    expect(secondId).not.toBe(firstSummaryId);
    h.append(secondId, row(`ans-${secondId}`, "assistant", "第二次总结"));
    h.emit({ type: "session.idle", sessionId: secondId });
    await vi.advanceTimersByTimeAsync(2_000);
    await again;

    expect(group.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(group.versions[1]?.sessionId).toBe(secondId);
    expect(group.text).toBe("第二次总结");
    // The older version's session stays addressable as history.
    expect(h.state.digestGroupForSession("codex", firstSummaryId ?? "")).toBe(group);
  });

  it("restores a persisted digest as inert history", async () => {
    const restored = normalizeDigestGroup({
      id: "digest-old",
      backend: "codex",
      directory: "/demo/project",
      anchorSessionId: ROOT_A.id,
      anchorMessageId: null,
      createdAt: 1,
      scope: "story",
      sources: [
        {
          sessionId: ROOT_B.id,
          storyRootId: ROOT_B.id,
          title: "故事乙",
          turnMessageId: null,
          turnCount: 2,
          omittedTurns: 0,
          chars: 40,
        },
      ],
      summarySessionId: "ses-old-summary",
      // A run nobody watched must not restore as finished — or as busy.
      status: "running",
      text: "昨天的总结",
      error: null,
      versions: [],
      settings: { model: null, length: "standard" },
    });
    const h = await bootState({ restored: restored ? [restored] : [] });
    const group = required(h.state.digestGroups[0]);
    expect(group.id).toBe("digest-old");
    expect(group.status).toBe("unknown");
    expect(group.text).toBe("昨天的总结");
  });
});
