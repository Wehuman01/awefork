import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type {
  ChatMessage,
  ModelChoice,
  PersistedComposer,
  SessionSummary,
} from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Composer-persistence × backend-switch regression harness: the state module
 * is a singleton, so every test boots a fresh instance via vi.resetModules +
 * dynamic import, backed by a scripted window.awefork. The app starts on
 * opencode with session s1; codex boots with session c1.
 */

const OPENCODE: SessionSummary = {
  id: "s1",
  title: "登录接口排查",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const SECOND: SessionSummary = {
  id: "s2",
  title: "另一条会话",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const CODEX: SessionSummary = {
  id: "c1",
  title: "codex 会话",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

/** A newest-by-updatedAt session living in a scratch directory, the way a TUI
 *  run in a temp dir registers itself — the auto-select must not chase it when
 *  a project is remembered. */
const SCRATCH: SessionSummary = {
  id: "s9",
  title: "临时目录里的一次性会话",
  directory: "/var/folders/scratch/T",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_100_000,
  updatedAt: 1_726_000_100_000,
};

const MODEL: ModelChoice = { providerId: "oc", modelId: "glm-5.3" };

/** A mid-story turn node: openDraft turns it into a fork-branch draft. */
function turnNode() {
  return {
    id: "s1:m1",
    kind: "turn" as const,
    sessionId: "s1",
    messageId: "m1",
    title: "第一轮",
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
  };
}

async function bootState(
  options: {
    composer?: PersistedComposer | null;
    /** Per-backend sidecars; wins over `composer` when both name a backend. */
    composerByBackend?: Record<BackendId, PersistedComposer | null>;
    /** Runs inside every sidecar read, before it resolves — the moment the
     *  workspace has already moved on but the state has not been read back. */
    onComposerRead?: (backend: BackendId) => void | Promise<void>;
    messages?: Record<string, ChatMessage[]>;
    includeSecond?: boolean;
    includeScratch?: boolean;
  } = {},
) {
  vi.resetModules();
  const saves: Array<{ backend: BackendId; value: PersistedComposer | null }> = [];
  let forkDeferred: ((session: SessionSummary) => void) | null = null;
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: vi.fn(async (backend: BackendId) =>
      backend === "codex"
        ? { sessions: [CODEX], lineage: {} }
        : {
            sessions: options.includeScratch
              ? [...(options.includeSecond ? [OPENCODE, SECOND] : [OPENCODE]), SCRATCH]
              : options.includeSecond
                ? [OPENCODE, SECOND]
                : [OPENCODE],
            lineage: {},
          },
    ),
    messages: vi.fn(
      async (_backend: BackendId, sessionId: string) => options.messages?.[sessionId] ?? [],
    ),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => OPENCODE,
    fork: vi.fn(
      () =>
        new Promise<SessionSummary>((resolve) => {
          forkDeferred = resolve;
        }),
    ),
    deleteSession: async () => [],
    deleteMessage: async () => {},
    prompt: vi.fn(async () => {}),
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: async () => {},
    openSessionTerminal: async () => ({ ok: true }),
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
    composer: vi.fn(async (backend: BackendId) => {
      const byBackend = options.composerByBackend?.[backend];
      const value = byBackend !== undefined ? byBackend : (options.composer ?? null);
      if (options.onComposerRead) await options.onComposerRead(backend);
      return value;
    }),
    saveComposer: vi.fn(async (backend: BackendId, value: PersistedComposer | null) => {
      saves.push({ backend, value });
    }),
    backends: async () => ({
      selected: "opencode",
      backends: [
        { id: "opencode", label: "opencode", installed: true },
        { id: "codex", label: "codex", installed: true },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    // One-window harness: the multi-window jump never engages (multiWindow
    // defaults off) but init() subscribes unconditionally.
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
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
    ...createOverviewLedgerMock(),
    ...createOverviewCacheMock(),
    ...createDiagnosticsMock(),
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return {
    store: state.store,
    mod: state,
    api,
    saves,
    resolveFork: (session: SessionSummary = OPENCODE) => forkDeferred?.(session),
    openDraft: state.openDraft,
    setDraftText: state.setDraftText,
    sendDraft: state.sendDraft,
    switchBackend: state.switchBackend,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("composer persistence × backend switch", () => {
  it("aborts the send when the backend switches mid-fork and keeps both drafts", async () => {
    const codexDraft = {
      draft: {
        sessionId: "c1",
        atMessageId: null,
        text: "codex 未发送草稿",
        model: null,
        attachments: [],
      },
      paneModels: {},
      lastModel: null,
    };
    const h = await bootState({ composer: codexDraft });
    // Mid-story draft on opencode → sendDraft goes through the fork branch.
    h.openDraft(turnNode());
    h.setDraftText("hello");

    const sending = h.sendDraft();
    // Switch while the fork request is still in flight.
    await h.switchBackend("codex");
    h.resolveFork();
    await sending;

    // The send never fired: no prompt, no running card, no optimistic row.
    expect(h.api.prompt).not.toHaveBeenCalled();
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.draftSending).toBe(false);
    // The outgoing backend kept its unsent draft (flushed at switch time)…
    expect(h.saves).toContainEqual({
      backend: "opencode",
      value: expect.objectContaining({
        draft: expect.objectContaining({ text: "hello" }),
      }),
    });
    // …and the restored codex draft is still on screen — the stale send
    // must not null it out or write it away.
    expect(h.store.draft?.text).toBe("codex 未发送草稿");
    expect(h.saves).not.toContainEqual({ backend: "codex", value: null });
  });

  it("clears the sidecar as soon as the draft is sent, not on the debounce", async () => {
    const h = await bootState();
    h.openDraft(turnNode());
    h.setDraftText("hello");

    const sending = h.sendDraft();
    // Let the send pass its flush and reach the fork call before resolving.
    await vi.advanceTimersByTimeAsync(0);
    h.resolveFork();
    await sending;

    expect(h.api.prompt).toHaveBeenCalledWith("opencode", "s1", "hello", null, []);
    expect(h.store.draft).toBeNull();
    // Without advancing the 600ms debounce — a crash right after sending
    // must not resurrect the sent draft. The remembered project stays in
    // the sidecar, so the save is a value with a null draft, not null.
    expect(h.saves).toContainEqual({
      backend: "opencode",
      value: expect.objectContaining({ draft: null }),
    });
  });

  it("filters restored pane model picks down to sessions that still exist", async () => {
    const h = await bootState({
      composer: { draft: null, paneModels: { s1: MODEL, gone: MODEL }, lastModel: null },
    });
    // Let the void-restore settle without arming the debounce flush.
    await vi.advanceTimersByTimeAsync(0);

    expect(h.store.paneModels).toEqual({ s1: MODEL });
  });

  it("reopens the remembered project at boot instead of the newest session's directory", async () => {
    const h = await bootState({
      includeScratch: true,
      composer: {
        draft: null,
        paneModels: {},
        lastModel: null,
        selectedDirectory: "/demo/shop-api",
      },
    });

    // The scratch session is newest overall, but the boot keeps the project
    // the last session ended in and selects within it.
    expect(h.store.selectedDirectory).toBe("/demo/shop-api");
    expect(h.store.selectedId).toBe("s1");
  });

  it("without a remembered project the boot still follows the newest session", async () => {
    const h = await bootState({ includeScratch: true });
    expect(h.store.selectedDirectory).toBe("/var/folders/scratch/T");
  });

  it("persists the open project on the debounced sidecar flush", async () => {
    const h = await bootState();
    await h.mod.selectSession("s1");
    await vi.advanceTimersByTimeAsync(600);

    const last = [...h.saves].reverse().find((s) => s.backend === "opencode");
    expect(last?.value).toMatchObject({ selectedDirectory: "/demo/shop-api" });
  });
});

/**
 * Pane composer model following: with no explicit pick the composer mirrors
 * the selected branch's own last-used model+variant, and only a hand-picked
 * model (or a deliberate 默认模型) overrides it.
 */
describe("explicit prompt targets", () => {
  it("sends to an explicit session without changing the current selection", async () => {
    const h = await bootState({ includeSecond: true });
    await h.mod.selectSession("s1");

    await h.mod.sendPromptTo("s2", "给另一条会话");

    expect(h.store.selectedId).toBe("s1");
    expect(h.api.prompt).toHaveBeenCalledWith("opencode", "s2", "给另一条会话", null, []);
    expect(h.store.messagesBySession.s2?.at(-1)?.text).toBe("给另一条会话");
    expect(h.store.running.s2).toBe(true);
  });

  it("sends one compare draft to both sessions with independent models", async () => {
    const h = await bootState({ includeSecond: true });
    await h.mod.selectSession("s1");
    await h.mod.enterCompare("s1", "s2");

    const results = await h.mod.sendComparePrompt(["s1", "s2"], "同一个问题", {
      s1: { providerId: "oc", modelId: "glm-5.3", variant: "high" },
      s2: { providerId: "oc", modelId: "glm-5.3-flash", variant: null },
    });

    expect(results).toEqual([
      { sessionId: "s1", error: null },
      { sessionId: "s2", error: null },
    ]);
    expect(h.store.selectedId).toBe("s1");
    expect(h.api.prompt).toHaveBeenCalledWith(
      "opencode",
      "s1",
      "同一个问题",
      {
        providerId: "oc",
        modelId: "glm-5.3",
        variant: "high",
      },
      [],
    );
    expect(h.api.prompt).toHaveBeenCalledWith(
      "opencode",
      "s2",
      "同一个问题",
      {
        providerId: "oc",
        modelId: "glm-5.3-flash",
        variant: null,
      },
      [],
    );
    expect(h.store.running.s1).toBe(true);
    expect(h.store.running.s2).toBe(true);
  });

  it("keeps a successful compare target running when the other target fails", async () => {
    const h = await bootState({ includeSecond: true });
    await h.mod.enterCompare("s1", "s2");
    h.api.prompt.mockImplementation(async (_backend, sessionId) => {
      if (sessionId === "s2") throw new Error("右侧失败");
    });

    const results = await h.mod.sendComparePrompt(["s1", "s2"], "同一个问题", {});

    expect(results).toEqual([
      { sessionId: "s1", error: null },
      { sessionId: "s2", error: "右侧失败" },
    ]);
    expect(h.store.running.s1).toBe(true);
    expect(h.store.running.s2).toBeFalsy();
  });

  it("aborts only the requested explicit session", async () => {
    const h = await bootState();
    h.api.abort = vi.fn(async () => {});

    expect(await h.mod.abortRunFor("s2")).toBeNull();
    expect(h.api.abort).toHaveBeenCalledWith("opencode", "s2");
  });
});

describe("pane composer follows the selected session", () => {
  /** One ChatMessage with only the fields the tests care about. */
  function row(
    id: string,
    role: "user" | "assistant",
    model: { modelId: string; variant: string | null },
  ): ChatMessage {
    return {
      id,
      role,
      text: role === "user" ? "第一轮" : "回复",
      thinking: "",
      toolNames: [],
      modelId: model.modelId,
      providerId: "oc",
      variant: model.variant,
      attachmentNames: [],
      createdAt: 1,
      completedAt: role === "assistant" ? 10 : null,
      finish: null,
      outputTokens: null,
      error: null,
    };
  }

  it("derives model and thinking variant from the session's last turn", async () => {
    const h = await bootState({
      messages: {
        s1: [
          row("m1", "user", { modelId: "glm-5.3", variant: null }),
          row("m2", "assistant", { modelId: "glm-5.3", variant: "high" }),
        ],
      },
    });

    // The pane is on the session's latest turn, so the composer shows what
    // wrote it — variant included — without the user picking anything.
    expect(h.mod.paneComposerModel.value).toEqual({
      providerId: "oc",
      modelId: "glm-5.3",
      variant: "high",
    });
  });

  it("an explicit pick — model or 默认模型 — wins over the derived one", async () => {
    const h = await bootState({
      messages: {
        s1: [
          row("m1", "user", { modelId: "glm-5.3", variant: null }),
          row("m2", "assistant", { modelId: "glm-5.3", variant: "high" }),
        ],
      },
    });

    h.mod.setPaneModel("s1", { providerId: "oc", modelId: "glm-5.3-flash", variant: null });
    expect(h.mod.paneComposerModel.value).toEqual({
      providerId: "oc",
      modelId: "glm-5.3-flash",
      variant: null,
    });

    h.mod.setPaneModel("s1", null);
    expect(h.mod.paneComposerModel.value).toBeNull();
  });

  it("sends with the derived model when the user never picked one", async () => {
    const h = await bootState({
      messages: {
        s1: [
          row("m1", "user", { modelId: "glm-5.3", variant: null }),
          row("m2", "assistant", { modelId: "glm-5.3", variant: "high" }),
        ],
      },
    });

    await h.mod.sendPanePrompt("继续");
    expect(h.api.prompt).toHaveBeenCalledWith(
      "opencode",
      "s1",
      "继续",
      { providerId: "oc", modelId: "glm-5.3", variant: "high" },
      [],
    );
  });

  it("falls back to 默认模型 for a session with no model-bearing turns", async () => {
    const h = await bootState({ messages: { s1: [] } });

    expect(h.mod.paneComposerModel.value).toBeNull();
  });

  it("falls back to the last hand-picked model for a fresh, model-less session", async () => {
    const h = await bootState({
      composer: { draft: null, paneModels: {}, lastModel: MODEL },
      messages: { s1: [] },
    });

    expect(h.mod.paneComposerModel.value).toEqual(MODEL);
  });

  it("a hand-picked pane model becomes the fresh-session default; 默认模型 doesn't", async () => {
    const h = await bootState({ messages: { s1: [] } });

    h.mod.setPaneModel("s1", MODEL);
    expect(h.store.lastModel).toEqual(MODEL);

    // A deliberate 默认模型 is a per-session choice, not a new default.
    h.mod.setPaneModel("s1", null);
    expect(h.store.lastModel).toEqual(MODEL);

    // The memory rides along on the next debounced sidecar flush (the IPC
    // payload always carries an explicit variant field).
    await vi.advanceTimersByTimeAsync(600);
    expect(h.saves).toContainEqual({
      backend: "opencode",
      value: expect.objectContaining({ lastModel: { ...MODEL, variant: null } }),
    });
  });
});

/**
 * Model quick access: hand-picked models feed a small LRU shown as the
 * picker's 最近 group, starring pins one into 常用, and both ride along on
 * the composer sidecar like lastModel does.
 */
describe("model quick access (常用 / 最近)", () => {
  it("keeps a variant-free, most-recent-first LRU of hand-picked models", async () => {
    const h = await bootState({ messages: { s1: [] } });

    h.mod.setPaneModel("s1", { providerId: "oc", modelId: "m1", variant: "high" });
    h.mod.setPaneModel("s1", { providerId: "oc", modelId: "m2" });
    // Re-picking m1 moves it back to the front instead of duplicating it.
    h.mod.setPaneModel("s1", { providerId: "oc", modelId: "m1" });
    for (let i = 3; i <= 8; i += 1) {
      h.mod.setPaneModel("s1", { providerId: "oc", modelId: `m${i}` });
    }
    expect(h.store.recentModels).toEqual([
      { providerId: "oc", modelId: "m8" },
      { providerId: "oc", modelId: "m7" },
      { providerId: "oc", modelId: "m6" },
      { providerId: "oc", modelId: "m5" },
      { providerId: "oc", modelId: "m4" },
    ]);
  });

  it("a 默认模型 pick seeds neither lastModel nor the LRU", async () => {
    const h = await bootState({ messages: { s1: [] } });

    h.mod.setPaneModel("s1", null);

    expect(h.store.lastModel).toBeNull();
    expect(h.store.recentModels).toEqual([]);
  });

  it("toggles 常用 by provider+model, ignoring the variant", async () => {
    const h = await bootState({ messages: { s1: [] } });

    h.mod.toggleFavoriteModel({ ...MODEL, variant: "high" });
    h.mod.toggleFavoriteModel({ providerId: "oc", modelId: "glm-5.3-flash" });
    expect(h.store.favoriteModels).toEqual([MODEL, { providerId: "oc", modelId: "glm-5.3-flash" }]);

    h.mod.toggleFavoriteModel(MODEL);
    expect(h.store.favoriteModels).toEqual([{ providerId: "oc", modelId: "glm-5.3-flash" }]);
  });

  it("persists favorites and recents on the debounced sidecar flush", async () => {
    const h = await bootState({ messages: { s1: [] } });
    h.mod.setPaneModel("s1", { ...MODEL, variant: "low" });
    h.mod.toggleFavoriteModel(MODEL);

    await vi.advanceTimersByTimeAsync(600);
    expect(h.saves).toContainEqual({
      backend: "opencode",
      value: expect.objectContaining({
        favoriteModels: [MODEL],
        recentModels: [{ providerId: "oc", modelId: "glm-5.3" }],
      }),
    });
  });

  it("restores favorites and recents from the sidecar on boot", async () => {
    const h = await bootState({
      composer: {
        draft: null,
        paneModels: {},
        lastModel: null,
        favoriteModels: [MODEL],
        recentModels: [MODEL, { providerId: "oc", modelId: "glm-5.3-flash" }],
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.store.favoriteModels).toEqual([MODEL]);
    expect(h.store.recentModels).toEqual([MODEL, { providerId: "oc", modelId: "glm-5.3-flash" }]);
  });
});

/**
 * The favorites wipe: a backend switch cleared the workspace and then flushed
 * the cleared state over the incoming backend's sidecar, so every restart
 * came back with an empty 常用 group. Persists are only allowed once the
 * backend they name has actually been read back into memory.
 */
describe("favorites survive a backend switch", () => {
  const FAVORITES = [
    { providerId: "oc", modelId: "glm-5.3" },
    { providerId: "magpie", modelId: "workbuddy-ai/step-5-preview" },
  ];

  /** opencode owns the favorites; codex has an empty sidecar. */
  function sidecars() {
    return {
      composerByBackend: {
        opencode: {
          draft: null,
          paneModels: {},
          lastModel: null,
          favoriteModels: FAVORITES,
          recentModels: [],
          selectedDirectory: "/demo/shop-api",
        },
        codex: {
          draft: null,
          paneModels: {},
          lastModel: null,
          favoriteModels: [],
          recentModels: [],
          selectedDirectory: "/demo/shop-api",
        },
      } as Record<BackendId, PersistedComposer | null>,
    };
  }

  it("a first visit to another backend does not wipe the parked backend's favorites", async () => {
    const h = await bootState(sidecars());
    await vi.advanceTimersByTimeAsync(50);
    expect(h.store.favoriteModels).toEqual(FAVORITES);

    await h.switchBackend("codex");
    await vi.advanceTimersByTimeAsync(50);

    // Nothing ever wrote opencode's sidecar with the cleared state.
    const wiped = h.saves.filter(
      (s) =>
        s.backend === "opencode" &&
        s.value !== null &&
        s.value.favoriteModels.length === 0 &&
        s.value.selectedDirectory === null,
    );
    expect(wiped).toEqual([]);
  });

  it("a state change during the read-back cannot flush the cleared state", async () => {
    // opencode has a parked snapshot to restore from, so the switch takes the
    // fast path where the workspace is repainted before the sidecar is read.
    let touched = false;
    let nudge: (() => void) | null = null;
    const h = await bootState({
      ...sidecars(),
      onComposerRead: (backend) => {
        // Mid-read, the way a session refresh's directory auto-select lands:
        // a persisted field changes while the composer state is still absent.
        if (backend === "opencode" && !touched) {
          touched = true;
          nudge?.();
        }
      },
    });
    nudge = () => {
      h.store.selectedDirectory = "/demo/shop-api";
    };
    await vi.advanceTimersByTimeAsync(50);
    expect(h.store.favoriteModels).toEqual(FAVORITES);

    await h.switchBackend("codex");
    await vi.advanceTimersByTimeAsync(50);
    touched = false;

    await h.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(50);

    expect(touched).toBe(true);
    expect(h.store.favoriteModels).toEqual(FAVORITES);
    const wiped = h.saves.filter(
      (s) =>
        s.backend === "opencode" &&
        s.value !== null &&
        s.value.favoriteModels.length === 0 &&
        s.value.selectedDirectory === null,
    );
    expect(wiped).toEqual([]);
  });

  it("switching back restores the parked backend's favorites from its snapshot", async () => {
    const h = await bootState(sidecars());
    await vi.advanceTimersByTimeAsync(50);

    await h.switchBackend("codex");
    await vi.advanceTimersByTimeAsync(50);
    expect(h.store.favoriteModels).toEqual([]);

    await h.switchBackend("opencode");
    await vi.advanceTimersByTimeAsync(50);
    expect(h.store.favoriteModels).toEqual(FAVORITES);
  });

  it("a send that lands after the switch clears only the draft, not the sidecar", async () => {
    const h = await bootState(sidecars());
    await vi.advanceTimersByTimeAsync(50);

    h.openDraft(turnNode());
    h.setDraftText("hello");
    // Switch mid-send: the prompt still goes out, but the outgoing backend's
    // draft is stale and must not resurrect.
    const sending = h.sendDraft();
    await h.switchBackend("codex");
    h.resolveFork();
    await sending;
    await vi.advanceTimersByTimeAsync(50);

    // The whole sidecar is never deleted for opencode — favorites included.
    expect(h.saves.filter((s) => s.backend === "opencode" && s.value === null)).toEqual([]);
    const opencodeSaves = h.saves.filter((s) => s.backend === "opencode" && s.value !== null);
    const last = opencodeSaves.at(-1);
    expect(last?.value?.favoriteModels).toEqual(FAVORITES);
  });
});
