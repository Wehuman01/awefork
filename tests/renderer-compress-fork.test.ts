import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../src/renderer/src/i18n";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendCapabilities, BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type {
  AgentEvent,
  ChatMessage,
  ModelChoice,
  SessionSummary,
  TagStore,
} from "../src/shared/types";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

const ANCHOR: SessionSummary = {
  id: "anchor",
  title: "问题",
  directory: "/demo/project",
  parentSessionId: null,
  origin: "root",
  createdAt: 1,
  updatedAt: 1,
};
const CHILD: SessionSummary = {
  ...ANCHOR,
  id: "child",
  title: "分支",
  parentSessionId: ANCHOR.id,
  origin: "fork",
  createdAt: 2,
  updatedAt: 2,
};
const MODEL: ModelChoice = { providerId: "demo", modelId: "first" };
const CAPABILITIES: BackendCapabilities = {
  deleteMessage: true,
  deleteSession: true,
  attachments: true,
  fileChanges: false,
  compress: true,
  exportBranch: true,
};

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

/** Two turns: u1/a1 then u2/a2 — the tip is the "u2" turn. */
function storyRows(): ChatMessage[] {
  return [
    row("u1", "user", "第一问"),
    row("a1", "assistant", "第一答"),
    row("u2", "user", "第二问"),
    row("a2", "assistant", "第二答"),
  ];
}

/** Real state singleton with scripted IPC; the compress target is observable. */
async function bootState(options: { extraSessions?: SessionSummary[]; tags?: string[] } = {}) {
  vi.resetModules();
  let handler: ((event: BackendEventEnvelope) => void) | undefined;
  const histories = new Map<string, ChatMessage[]>([["codex:anchor", storyRows()]]);
  const sessions: SessionSummary[] = [ANCHOR, ...(options.extraSessions ?? [])];
  const tagStore: TagStore = {
    sessions: options.tags ? { [ANCHOR.id]: [...options.tags] } : {},
    colors: {},
    forkPref: {},
  };
  const fork = vi.fn(async (_backend: BackendId, id: string, _atMessageId: string | null) => {
    expect(id).toBe(ANCHOR.id);
    const forked: SessionSummary = {
      ...ANCHOR,
      id: "fork-1",
      parentSessionId: ANCHOR.id,
      origin: "fork",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    sessions.push(forked);
    histories.set(`codex:${forked.id}`, structuredClone(histories.get("codex:anchor") ?? []));
    return forked;
  });
  const compress = vi.fn(async () => {});
  const renameSession = vi.fn(async () => {});
  const setSessionTags = vi.fn(async (backend: BackendId, id: string, tags: string[]) => {
    structuredClone({ backend, id, tags });
    tagStore.sessions[id] = [...tags];
    return structuredClone(tagStore);
  });
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [...sessions], lineage: {} }),
    messages: async (_backend: BackendId, id: string) =>
      structuredClone(histories.get(`codex:${id}`) ?? []),
    models: async () => [MODEL],
    messageAttachments: async () => [],
    createSession: async () => ANCHOR,
    fork,
    exportSession: async () => ANCHOR,
    compressSession: compress,
    prompt: async () => {},
    deleteSession: async () => [],
    deleteMessage: async () => {},
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession,
    openSessionTerminal: async () => ({ ok: true }),
    tags: async () => structuredClone(tagStore),
    setSessionTags,
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
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    // One-window harness: the multi-window jump never engages (multiWindow
    // defaults off) but init() subscribes unconditionally.
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => structuredClone(CAPABILITIES),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.4.1", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (listener: (event: BackendEventEnvelope) => void) => {
      handler = listener;
      return () => {};
    },
    ...createOverviewLedgerMock(),
    ...createOverviewCacheMock(),
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  await state.selectSession(ANCHOR.id);
  return {
    state,
    fork,
    compress,
    renameSession,
    setSessionTags,
    emit: (event: AgentEvent) => handler?.({ backend: "codex", event }),
  };
}

/** Run a compress to the confirm dialog, report its shape, then confirm. */
async function confirmCompress(
  h: Awaited<ReturnType<typeof bootState>>,
  atMessageId?: string | null,
) {
  const pending = h.state.compressSession(ANCHOR.id, atMessageId);
  for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
  const viaFork = required(h.state.store.compressAsk).viaFork;
  h.state.answerCompressAsk(MODEL);
  await pending;
  return viaFork;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("compress at a position", () => {
  it("compresses in place on the bare tip of an unbranched story", async () => {
    const h = await bootState();
    expect(await confirmCompress(h, "u2")).toBe(false);
    expect(h.fork).not.toHaveBeenCalled();
    expect(h.compress).toHaveBeenCalledWith("codex", ANCHOR.id, { ...MODEL, variant: null });
    expect(h.setSessionTags).not.toHaveBeenCalled();
  });

  it("forks at a mid-story position and compresses the fork there", async () => {
    const h = await bootState({ tags: ["讨论"] });
    expect(await confirmCompress(h, "u1")).toBe(true);
    expect(h.fork).toHaveBeenCalledWith("codex", ANCHOR.id, "u1");
    expect(h.compress).toHaveBeenCalledWith("codex", "fork-1", { ...MODEL, variant: null });
    expect(h.renameSession).toHaveBeenCalledWith(
      "codex",
      "fork-1",
      t("state.compressForkTitle", { title: ANCHOR.title }),
    );
    expect(h.setSessionTags).toHaveBeenCalledWith("codex", "fork-1", ["讨论"]);
    expect(h.state.store.selectedId).toBe("fork-1");
  });

  it("forks a branched session even from the tip (sidebar path)", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    expect(await confirmCompress(h, null)).toBe(true);
    expect(h.fork).toHaveBeenCalledWith("codex", ANCHOR.id, "u2");
    expect(h.compress).toHaveBeenCalledWith("codex", "fork-1", { ...MODEL, variant: null });
  });

  it("frees the parent once the fork takes over the compress", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    await confirmCompress(h, null);
    // The parent must not stay marked running: a second compress on it opens
    // the ask again instead of bouncing off the running guard.
    const pending = h.state.compressSession(ANCHOR.id);
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    expect(h.state.store.compressAsk).not.toBeNull();
    h.state.answerCompressAsk(null);
    await pending;
  });
});

describe("compress while the session runs", () => {
  it("refuses an in-place compress of a session with a run in flight", async () => {
    const h = await bootState();
    h.emit({ type: "message.started", sessionId: ANCHOR.id, messageId: "u2" });
    expect(h.state.store.running[ANCHOR.id]).toBe(true);
    await h.state.compressSession(ANCHOR.id, "u2");
    // The tip of an unbranched story compresses in place, and that is the one
    // case a run really does block: the summarize would be a second turn on a
    // session already running one.
    expect(h.state.store.compressAsk).toBeNull();
    expect(h.state.store.actionError).toBe(t("state.sessionRunningCompress"));
    expect(h.compress).not.toHaveBeenCalled();
  });

  it("compresses a branched session in a fork while its own run is in flight", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    h.emit({ type: "message.started", sessionId: ANCHOR.id, messageId: "u2" });
    expect(await confirmCompress(h, null)).toBe(true);
    expect(h.fork).toHaveBeenCalledWith("codex", ANCHOR.id, "u2");
    expect(h.compress).toHaveBeenCalledWith("codex", "fork-1", { ...MODEL, variant: null });
    // The parent's run is not this call's to end: its flag — and with it the
    // composer's waiting state — survives the compress untouched.
    expect(h.state.store.running[ANCHOR.id]).toBe(true);
    expect(h.state.store.actionError).toBeNull();
  });

  it("refuses a second compress while the first one is still in flight", async () => {
    // Regression: the fork path does not claim the parent's running flag (a
    // streaming parent owns it), and that flag used to be the only guard. A
    // second click during the fork's copy then cut a second branch from the
    // same position. The gesture needs its own guard on every path.
    const h = await bootState({ extraSessions: [CHILD] });
    h.fork.mockImplementationOnce(async () => {
      // Park the fork so the second click lands while it is still copying.
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      return { ...ANCHOR, id: "fork-slow", parentSessionId: ANCHOR.id, origin: "fork" as const };
    });

    const first = h.state.compressSession(ANCHOR.id, null);
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    required(h.state.store.compressAsk);
    h.state.answerCompressAsk(MODEL);
    // Let the first call reach its fork await.
    for (let i = 0; i < 50 && h.fork.mock.calls.length === 0; i += 1) await Promise.resolve();

    await h.state.compressSession(ANCHOR.id, null);
    expect(h.state.store.compressAsk).toBeNull();
    expect(h.state.store.actionError).toBe(t("state.compressInFlight"));

    await vi.advanceTimersByTimeAsync(20);
    await first;
    expect(h.fork).toHaveBeenCalledTimes(1);
  });

  it("releases the in-flight guard once the compress settles", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    await confirmCompress(h, null);
    // A later, deliberate compress is allowed again.
    const pending = h.state.compressSession(ANCHOR.id, null);
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    expect(h.state.store.compressAsk).not.toBeNull();
    h.state.answerCompressAsk(null);
    await pending;
  });

  it("releases the in-flight guard when the dialog is canceled", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    const pending = h.state.compressSession(ANCHOR.id, null);
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    h.state.answerCompressAsk(null);
    await pending;
    // Cancel must not wedge the session: the next click still opens the ask.
    const again = h.state.compressSession(ANCHOR.id, null);
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    expect(h.state.store.compressAsk).not.toBeNull();
    h.state.answerCompressAsk(null);
    await again;
  });

  it("still refuses an in-place compress when a run starts inside the dialog", async () => {
    const h = await bootState();
    const pending = h.state.compressSession(ANCHOR.id, "u2");
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    required(h.state.store.compressAsk);
    h.emit({ type: "message.started", sessionId: ANCHOR.id, messageId: "u2" });
    h.state.answerCompressAsk(MODEL);
    await pending;
    expect(h.compress).not.toHaveBeenCalled();
    expect(h.state.store.actionError).toBe(t("state.sessionRunningCompress"));
    // The refused compress never claimed the run that started mid-dialog.
    expect(h.state.store.running[ANCHOR.id]).toBe(true);
  });

  it("forks a branched session even when its run starts inside the dialog", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    const pending = h.state.compressSession(ANCHOR.id, null);
    for (let i = 0; i < 50 && !h.state.store.compressAsk; i += 1) await Promise.resolve();
    required(h.state.store.compressAsk);
    h.emit({ type: "message.started", sessionId: ANCHOR.id, messageId: "u2" });
    h.state.answerCompressAsk(MODEL);
    await pending;
    expect(h.compress).toHaveBeenCalledWith("codex", "fork-1", { ...MODEL, variant: null });
    expect(h.state.store.running[ANCHOR.id]).toBe(true);
    expect(h.state.store.actionError).toBeNull();
  });

  it("keeps the parent's own run when the fork itself fails", async () => {
    const h = await bootState({ extraSessions: [CHILD] });
    h.fork.mockRejectedValueOnce(new Error("fork refused"));
    h.emit({ type: "message.started", sessionId: ANCHOR.id, messageId: "u2" });
    await confirmCompress(h, null);
    // The compress never owned the parent's run, so a failed fork must not
    // clear the flag — the streaming turn is still going.
    expect(h.state.store.running[ANCHOR.id]).toBe(true);
    expect(h.state.store.actionError).toBe(t("state.compressFailed", { error: "fork refused" }));
  });
});
