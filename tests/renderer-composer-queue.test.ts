import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { AgentEvent, SessionSummary } from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * The composer's queue: a send while a run is in flight waits for it instead
 * of being refused, and an explicit interrupt replaces the run instead of
 * waiting behind it. Both live in the renderer — no adapter grows a queue —
 * so the assertions are about ordering at the `prompt` boundary: which text
 * reaches the backend, and when.
 */

const S1: SessionSummary = {
  id: "s1",
  title: "登录接口排查",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

async function boot() {
  vi.resetModules();
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
  const prompts: string[] = [];
  const aborts: string[] = [];
  let promptGate: Promise<void> | null = null;
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [S1], lineage: {} }),
    messages: async () => [],
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => S1,
    fork: async () => S1,
    deleteSession: async () => [],
    deleteMessage: async () => {},
    prompt: async (_backend, _sessionId, text) => {
      prompts.push(text);
      if (promptGate) await promptGate;
    },
    abort: async (_backend, sessionId) => {
      aborts.push(sessionId);
    },
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
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({ deleteMessage: true, attachments: true, fileChanges: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.2.1", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (handler) => {
      onEnvelope = handler;
      return () => {};
    },
    overviewListings: async () => ({}),
    overviewPublishListing: async () => true,
    onOverviewListing: () => () => {},
    overviewRunning: async () => [],
    ...createOverviewLedgerMock(),
    ...createDiagnosticsMock(),
  } as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  await state.refreshSessions();
  await state.selectSession("s1");
  return {
    state,
    store: state.store,
    prompts,
    aborts,
    send: (event: AgentEvent) => onEnvelope?.({ backend: "opencode" as BackendId, event }),
    holdPrompt: (gate: Promise<void> | null) => {
      promptGate = gate;
    },
  };
}

function startRun(h: Awaited<ReturnType<typeof boot>>): void {
  h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
}

function idle(h: Awaited<ReturnType<typeof boot>>): void {
  h.send({ type: "session.idle", sessionId: "s1" });
}

beforeEach(() => {
  vi.useFakeTimers();
  const map = new Map<string, string>();
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

describe("composer queue", () => {
  it("queues a send behind the running turn instead of refusing it", async () => {
    const h = await boot();
    startRun(h);
    expect(h.store.running.s1).toBe(true);

    await h.state.sendPanePrompt("第二句");

    // Nothing went out yet: the running turn still owns the session.
    expect(h.prompts).toEqual([]);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(1);
    // The run is untouched — a queued send is not an interrupt.
    expect(h.store.running.s1).toBe(true);
  });

  it("sends the queued prompt once the run settles", async () => {
    const h = await boot();
    startRun(h);
    await h.state.sendPanePrompt("第二句");
    expect(h.prompts).toEqual([]);

    idle(h);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.prompts).toEqual(["第二句"]);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(0);
    // The drained prompt is itself a run now.
    expect(h.store.running.s1).toBe(true);
  });

  it("drains one prompt at a time, in send order", async () => {
    const h = await boot();
    startRun(h);
    await h.state.sendPanePrompt("第二句");
    await h.state.sendPanePrompt("第三句");
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(2);

    idle(h);
    await vi.advanceTimersByTimeAsync(1_000);
    // Only the first queued prompt started; the second still waits.
    expect(h.prompts).toEqual(["第二句"]);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(1);

    idle(h);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.prompts).toEqual(["第二句", "第三句"]);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(0);
  });

  it("sends immediately when nothing is running", async () => {
    const h = await boot();
    await h.state.sendPanePrompt("直接发");
    expect(h.prompts).toEqual(["直接发"]);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(0);
  });

  it("refuses past the queue cap instead of growing without end", async () => {
    const h = await boot();
    startRun(h);
    for (let index = 0; index < 5; index += 1) {
      await h.state.sendPanePrompt(`排队 ${index}`);
    }
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(5);

    await h.state.sendPanePrompt("第六条");

    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(5);
    expect(h.store.actionError).toBeTruthy();
  });

  it("keeps the queue when a run's ending is never confirmed", async () => {
    const h = await boot();
    startRun(h);
    await h.state.sendPanePrompt("等下一轮");

    // A run that goes silent is not an ending: firing the queued prompt into a
    // session whose state we cannot vouch for would be a guess. The watchdog
    // settles it as unknown (never as a result), and the queue waits.
    h.holdPrompt(null);
    await vi.advanceTimersByTimeAsync(160 * 1_500);

    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(1);
    expect(h.prompts).toEqual([]);
  });
});

describe("interrupt and send", () => {
  it("aborts the running turn and sends the new prompt at once", async () => {
    const h = await boot();
    startRun(h);
    expect(h.store.running.s1).toBe(true);

    await h.state.interruptPanePrompt("换成这个");

    expect(h.aborts).toEqual(["s1"]);
    expect(h.prompts).toEqual(["换成这个"]);
    // Nothing was queued: an interrupt bypasses the queue entirely.
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(0);
  });

  it("drops the queue's place but keeps the rest waiting", async () => {
    const h = await boot();
    startRun(h);
    await h.state.sendPanePrompt("排队的");

    await h.state.interruptPanePrompt("插队的");

    // The interrupt went out now; the queued prompt still waits its turn.
    expect(h.prompts).toEqual(["插队的"]);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(1);
  });

  it("leaves the run alone when the abort is refused", async () => {
    const h = await boot();
    startRun(h);
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.abort = async () => {
      throw new Error("abort refused");
    };

    await h.state.interruptPanePrompt("不该发出去");

    expect(h.prompts).toEqual([]);
    expect(h.store.actionError).toContain("abort refused");
    // The run is still the user's; nothing was silently dropped.
    expect(h.store.running.s1).toBe(true);
  });

  it("sends immediately when nothing is running", async () => {
    const h = await boot();
    await h.state.interruptPanePrompt("本来就没在跑");
    expect(h.aborts).toEqual([]);
    expect(h.prompts).toEqual(["本来就没在跑"]);
  });
});

describe("queue lifecycle", () => {
  it("keeps a queued prompt's captured text and model", async () => {
    const h = await boot();
    startRun(h);
    // Queue with one model, then change the composer's model: the queued send
    // must go out with what the user chose at send time, not the later pick.
    await h.state.sendPanePrompt("用旧模型");
    h.state.setPaneModel("s1", { providerId: "p", modelId: "later-model" });

    idle(h);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.prompts).toEqual(["用旧模型"]);
  });

  it("keeps a parked backend's queue across a switch", async () => {
    const h = await boot();
    const api = (globalThis as unknown as { window: { awefork: AweforkApi } }).window.awefork;
    api.backends = async () => ({
      selected: "opencode",
      backends: [
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
        { id: "codex", label: "codex", installed: true, version: null, versionWarning: null },
      ],
    });
    startRun(h);
    await h.state.sendPanePrompt("给 opencode 排的");

    // The queue belongs to the session, not the window: switching to another
    // agent parks it and a switch back must find it still waiting.
    await h.state.switchBackend("codex");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(1);

    await h.state.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.state.queuedPromptCount("opencode", "s1")).toBe(1);
  });
});
