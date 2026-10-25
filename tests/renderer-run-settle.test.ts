import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { AgentEvent, ChatMessage, SessionSummary } from "../src/shared/types";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Run-settle tint harness: the state module is a singleton, so every test
 * boots a fresh instance via vi.resetModules + dynamic import, backed by a
 * scripted window.awefork. The scripted s1 messages decide how the run
 * ended — a set error on the last assistant row or a clean null. Fake
 * timers drive the tint's five-minute fade.
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

const USER_ROW: ChatMessage = {
  id: "m1",
  role: "user",
  text: "帮我修一下登录接口",
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

function assistantRow(error: string | null): ChatMessage {
  return { ...USER_ROW, id: "m2", role: "assistant", text: "修好了", error };
}

async function bootState(
  options: {
    runError?: string | null;
    rows?: ChatMessage[];
    sessions?: SessionSummary[] | ((backend: BackendId) => SessionSummary[]);
    messages?: AweforkApi["messages"];
    deferInit?: boolean;
  } = {},
) {
  vi.resetModules();
  let rows = options.rows ?? [USER_ROW, assistantRow(options.runError ?? null)];
  let onEnvelope: ((envelope: BackendEventEnvelope) => void) | null = null;
  // Flip to make the messages IPC reject — the "backend died mid-run" signal
  // the unreachable guard is built around.
  let failMessages = false;
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async (backend) => ({
      sessions:
        typeof options.sessions === "function"
          ? options.sessions(backend)
          : (options.sessions ?? [SESSION]),
      lineage: {},
    }),
    messages: vi.fn(
      options.messages ??
        (async () => {
          if (failMessages) throw new Error("backend gone");
          return structuredClone(rows);
        }),
    ),
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
    ...createOverviewLedgerMock(),
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  const ready = state.init();
  if (!options.deferInit) await ready;
  return {
    ready,
    state,
    api,
    store: state.store,
    alphaFor: state.recentAlphaFor,
    send: (event: AgentEvent, backend: BackendId = "codex") => onEnvelope?.({ backend, event }),
    setRows: (value: ChatMessage[]) => {
      rows = value;
    },
    failMessages: (value: boolean) => {
      failMessages = value;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("renderer message updates", () => {
  it("preserves the message array and graph when a reload has no changes", async () => {
    const h = await bootState();
    const messages = h.store.messagesBySession.s1;
    const graph = h.state.turnGraph.value;
    await h.state.selectSession("s1");
    expect(h.store.messagesBySession.s1).toBe(messages);
    expect(h.state.turnGraph.value).toBe(graph);
  });

  it.each([
    { text: "new reply" },
    { thinking: "new reasoning" },
    { toolNames: ["edit"] },
    { modelId: "model" },
    { providerId: "provider" },
    { variant: "high" },
    { attachmentNames: ["notes.md"] },
    { createdAt: 2 },
    { completedAt: 3 },
    { finish: "tool-calls" },
    { outputTokens: 42 },
    { contextTokens: 42 },
    { error: "failed" },
    { compaction: true },
    { id: "replacement" },
    { role: "user" as const },
  ])("publishes changes to same-id message fields: %j", async (change) => {
    const h = await bootState();
    const before = h.store.messagesBySession.s1;
    h.setRows([USER_ROW, { ...assistantRow(null), ...change }]);
    await h.state.selectSession("s1");
    expect(h.store.messagesBySession.s1).not.toBe(before);
    expect(h.store.messagesBySession.s1?.[1]).toMatchObject(change);
  });

  it("loads a background backend's messages without rebuilding the visible graph", async () => {
    const h = await bootState();
    const graph = h.state.turnGraph.value;
    h.send({ type: "session.idle", sessionId: "outside" }, "opencode");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.messagesBySession.outside).toHaveLength(2);
    expect(h.state.turnGraph.value).toBe(graph);
  });

  it("keeps stubs as tips and identifies the final user row across reloads and compaction", async () => {
    const h = await bootState();
    const node = h.state.turnGraph.value.nodes[0];
    if (!node) throw new Error("missing fixture node");
    expect(h.state.isSessionTip({ ...node, kind: "stub", messageId: null })).toBe(true);
    for (const rows of [[], [assistantRow(null)], [USER_ROW], [USER_ROW, assistantRow(null)]]) {
      h.setRows(rows);
      await h.state.selectSession("s1");
      expect(h.state.isSessionTip(node)).toBe(rows.some((m) => m.role === "user"));
    }
    h.setRows([USER_ROW, assistantRow(null), { ...USER_ROW, id: "compact", compaction: true }]);
    await h.state.selectSession("s1");
    expect(h.state.isSessionTip(node)).toBe(false);
    expect(h.state.isSessionTip({ ...node, messageId: "compact" })).toBe(true);
    h.setRows([USER_ROW]);
    await h.state.selectSession("s1");
    expect(h.state.isSessionTip(node)).toBe(true);
  });

  it("does not let a slow pre-send response remove the optimistic prompt", async () => {
    const h = await bootState();
    let resolve!: (rows: ChatMessage[]) => void;
    vi.mocked(h.api.messages).mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const oldLoad = h.state.selectSession("s1");
    await h.state.sendPromptTo("s1", "new prompt");
    resolve([USER_ROW, assistantRow(null)]);
    await oldLoad;
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("new prompt");
    expect(h.store.running.s1).toBe(true);
  });

  it("keeps the optimistic prompt row while the run's snapshot lags behind", async () => {
    const h = await bootState();
    await h.state.selectSession("s1");
    await h.state.sendPromptTo("s1", "new prompt");
    expect(h.store.messagesBySession.s1?.at(-1)?.id).toMatch(/^local_/);

    // A mid-run snapshot from a backend whose store projects rollouts late:
    // the prompt has not landed server-side yet.
    h.setRows([USER_ROW, assistantRow(null)]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("new prompt");

    // The server row arrives: the local stand-in is spent and dropped.
    h.setRows([USER_ROW, { ...assistantRow(null), id: "m3", role: "user", text: "new prompt" }]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.messagesBySession.s1?.some((m) => m.id.startsWith("local_"))).toBe(false);
    expect(h.store.messagesBySession.s1?.at(-1)?.id).toBe("m3");
  });

  it("transfers a writer-locked run to its fork instead of settling it failed", async () => {
    // codex refuses the locked thread's writer and continues the turn in a
    // fork. The run moves house: the prompt row survives, the run and
    // watchdog follow the fork, and the pane selects the fork so the reply
    // streams where the user is looking.
    const FORK: SessionSummary = {
      ...SESSION,
      id: "fork-1",
      title: "s1 的分支",
      parentSessionId: "s1",
      origin: "fork",
    };
    const h = await bootState({ sessions: [SESSION, FORK] });
    await h.state.selectSession("s1");
    await h.state.sendPromptTo("s1", "继续");
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("继续");

    h.send({
      type: "session.branchContinued",
      sessionId: "s1",
      forkedSessionId: "fork-1",
      message: "codex: continued in the new branch fork-1",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.running["fork-1"]).toBe(true);
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("继续");
    expect(h.store.selectedId).toBe("fork-1");
  });

  it("follows a fork that thread/list has not listed yet", async () => {
    // codex omits a fork carrying only copied prefix turns from thread/list
    // until its first own turn. The run still moved there, so the pane must
    // follow it — otherwise the reply streams into a branch nobody can see.
    const h = await bootState();
    await h.state.selectSession("s1");
    await h.state.sendPromptTo("s1", "继续");

    h.send({
      type: "session.branchContinued",
      sessionId: "s1",
      forkedSessionId: "fork-unlisted",
      message: "codex: continued in the new branch fork-unlisted",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.store.selectedId).toBe("fork-unlisted");
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.running["fork-unlisted"]).toBe(true);
  });

  it("keeps a repeated prompt's row until its own server copy lands", async () => {
    // Sending the same text twice is ordinary use. Matching local rows to
    // server rows by text alone dropped the second send's row the moment the
    // first send's copy was already on the server.
    const h = await bootState();
    await h.state.selectSession("s1");
    await h.state.sendPromptTo("s1", "继续");
    h.setRows([USER_ROW, assistantRow(null), { ...USER_ROW, id: "m3", text: "继续" }]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.messagesBySession.s1?.some((m) => m.id.startsWith("local_"))).toBe(false);

    // Same text again; the store has not projected this one yet.
    await h.state.sendPromptTo("s1", "继续");
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.messagesBySession.s1?.at(-1)?.id).toMatch(/^local_/);

    // Its own copy arrives: now the local stand-in is spent.
    h.setRows([
      USER_ROW,
      assistantRow(null),
      { ...USER_ROW, id: "m3", text: "继续" },
      { ...USER_ROW, id: "m4", text: "继续" },
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.messagesBySession.s1?.some((m) => m.id.startsWith("local_"))).toBe(false);
    expect(h.store.messagesBySession.s1?.at(-1)?.id).toBe("m4");
  });

  it("survives the send's success path with the continuation notice intact", async () => {
    // The event arrives inside prompt(), and the send clears actionError when
    // it resolves — so the notice needs a home the success path does not own.
    const h = await bootState();
    await h.state.selectSession("s1");
    h.api.prompt = vi.fn(async () => {
      h.send({
        type: "session.branchContinued",
        sessionId: "s1",
        forkedSessionId: "fork-2",
        message: "codex: continued in the new branch fork-2",
      });
      await Promise.resolve();
    });
    await h.state.sendPrompt("继续");
    expect(h.store.infoToast).toContain("fork-2");
    expect(h.store.actionError).toBeNull();
  });

  it("does not settle a resend from the old poll while prompt acknowledgement is pending", async () => {
    const h = await bootState();
    let finishPoll!: (rows: ChatMessage[]) => void;
    let acknowledge!: () => void;
    vi.mocked(h.api.messages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPoll = resolve;
        }),
    );
    h.api.prompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    await vi.advanceTimersByTimeAsync(1500);
    const sending = h.state.sendPromptTo("s1", "next prompt");
    finishPoll([USER_ROW, { ...assistantRow(null), completedAt: Date.now(), finish: "stop" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.running.s1).toBe(true);
    expect(h.store.recent.s1).toBeUndefined();
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("next prompt");
    acknowledge();
    await sending;
  });

  it("keeps one slow poll in flight and reads again after the completion event", async () => {
    const h = await bootState();
    let resolve!: (rows: ChatMessage[]) => void;
    const fetch = vi.mocked(h.api.messages);
    fetch.mockClear();
    fetch.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    h.setRows([USER_ROW, { ...assistantRow(null), text: "final reply", completedAt: Date.now() }]);
    h.send({ type: "session.idle", sessionId: "s1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve([USER_ROW, { ...assistantRow(null), text: "partial", completedAt: null }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("final reply");
  });

  it("does not let an older finish settle a new run while its refresh is pending", async () => {
    const h = await bootState();
    let resolve!: (rows: ChatMessage[]) => void;
    vi.mocked(h.api.messages).mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send({ type: "session.idle", sessionId: "s1" });
    await h.state.sendPromptTo("s1", "next run");
    resolve([USER_ROW, assistantRow(null)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.running.s1).toBe(true);
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("next run");
  });

  it("does not let a late delta invalidate the final snapshot already being loaded", async () => {
    const h = await bootState({ rows: [USER_ROW, { ...assistantRow(null), completedAt: null }] });
    let resolve!: (rows: ChatMessage[]) => void;
    vi.mocked(h.api.messages).mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send({ type: "session.idle", sessionId: "s1" });
    h.send({
      type: "message.delta",
      sessionId: "s1",
      messageId: "m2",
      partId: "late",
      kind: "text",
      delta: "late frame",
    });
    resolve([USER_ROW, { ...assistantRow(null), completedAt: Date.now(), finish: "stop" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.messagesBySession.s1?.at(-1)?.completedAt).not.toBeNull();
  });

  it("ignores late deltas for persisted completed messages", async () => {
    const h = await bootState();
    h.send({
      type: "message.delta",
      sessionId: "s1",
      messageId: "m2",
      partId: "late",
      kind: "text",
      delta: "late frame",
    });
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.streamParts).toHaveLength(0);
  });

  it("keeps a new external run alive when the previous run's finish arrives late", async () => {
    const h = await bootState({ rows: [USER_ROW, { ...assistantRow(null), completedAt: null }] });
    let resolve!: (rows: ChatMessage[]) => void;
    vi.mocked(h.api.messages).mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send({ type: "session.idle", sessionId: "s1" });
    h.send({ type: "message.started", sessionId: "s1", messageId: "m4" });
    resolve([USER_ROW, { ...assistantRow(null), completedAt: Date.now(), finish: "stop" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.running.s1).toBe(true);
    expect(h.store.messagesBySession.s1?.at(-1)?.completedAt).toBeNull();
  });

  it("waits through tool steps and settles from polling when the idle event is lost", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.setRows([USER_ROW, { ...assistantRow(null), completedAt: Date.now(), finish: "tool-calls" }]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.running.s1).toBe(true);
    h.setRows([
      USER_ROW,
      { ...assistantRow(null), text: "done", completedAt: Date.now(), finish: "stop" },
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.messagesBySession.s1?.at(-1)?.text).toBe("done");
  });

  it("treats same-id text growth as watchdog liveness", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    for (let step = 0; step < 3; step++) {
      h.setRows([USER_ROW, { ...assistantRow(null), text: `step ${step}`, completedAt: null }]);
      await vi.advanceTimersByTimeAsync(150_000);
      expect(h.store.running.s1).toBe(true);
    }
  });

  it("deletes only a final turn whose earlier messages survive", async () => {
    const h = await bootState();
    const node = h.state.turnGraph.value.nodes[0];
    if (!node) throw new Error("missing fixture node");
    expect(h.state.isTurnDelete(node)).toBe(false);
    h.setRows([USER_ROW, assistantRow(null), { ...USER_ROW, id: "last" }]);
    await h.state.selectSession("s1");
    expect(h.state.isTurnDelete(node)).toBe(false);
    expect(h.state.isTurnDelete({ ...node, messageId: "last" })).toBe(true);
    h.setRows([USER_ROW]);
    await h.state.selectSession("s1");
    expect(h.state.isTurnDelete(node)).toBe(false);
  });
});

function branchSessions(count: number): SessionSummary[] {
  return [
    SESSION,
    ...Array.from({ length: count }, (_, i) => ({
      ...SESSION,
      id: `branch-${i + 1}`,
      parentSessionId: SESSION.id,
      createdAt: SESSION.createdAt + i + 1,
      updatedAt: SESSION.updatedAt + i + 1,
    })),
  ];
}

describe("canvas message loading", () => {
  it("loads the selected branch and ancestors first and releases readiness before a slow sibling", async () => {
    let finishSlow!: (rows: ChatMessage[]) => void;
    const started: string[] = [];
    let active = 0,
      maxActive = 0;
    const h = await bootState({
      deferInit: true,
      sessions: branchSessions(10),
      messages: async (_backend, id) => {
        started.push(id);
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (id === "branch-1")
            return await new Promise<ChatMessage[]>((resolve) => {
              finishSlow = resolve;
            });
          await Promise.resolve();
          return [USER_ROW];
        } finally {
          active--;
        }
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(started.slice(0, 2)).toEqual(["branch-10", "s1"]);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(h.store.messagesBySession["branch-10"]).toHaveLength(1);
    expect(h.store.loadingMessages).toBe(false);
    expect(h.store.loadingCanvas).toBe(true);
    finishSlow([USER_ROW]);
    await h.ready;
    expect(h.store.loadingCanvas).toBe(false);
    expect(started).toHaveLength(11);
  });

  it("loads a session that appears while the batch is still in flight", async () => {
    const pending = new Map<string, (rows: ChatMessage[]) => void>();
    const started: string[] = [];
    const slow = new Set<string>();
    const fork = (id: string): SessionSummary => ({
      ...SESSION,
      id,
      parentSessionId: SESSION.id,
      origin: "fork",
      createdAt: SESSION.createdAt + 20,
      updatedAt: SESSION.updatedAt - 20,
    });
    let sessions = branchSessions(10);
    const h = await bootState({
      deferInit: true,
      sessions: () => sessions,
      messages: async (_backend, id) => {
        started.push(id);
        if (!slow.has(id)) return [USER_ROW];
        return new Promise<ChatMessage[]>((resolve) => {
          pending.set(id, resolve);
        });
      },
    });
    await h.ready;
    expect(h.store.loadingCanvas).toBe(false);
    // A scheduled refresh finds several new forks; their reads are slow, so
    // the batch they start is still in flight when the next refresh lands.
    sessions = [
      ...sessions,
      fork("branch-20"),
      fork("branch-21"),
      fork("branch-22"),
      fork("branch-23"),
      fork("branch-24"),
    ];
    for (const id of ["branch-20", "branch-21", "branch-22", "branch-23", "branch-24"])
      slow.add(id);
    void h.state.refreshSessions();
    for (let round = 0; round < 50 && pending.size < 4; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(h.store.loadingCanvas).toBe(true);
    expect(pending.size).toBe(4);
    // A second refresh — same selection, same directory — discovers one more
    // fork. selectedId is unchanged, so this call reuses the running batch:
    // the only way the new branch is ever read is by joining it.
    sessions = [...sessions, fork("branch-25")];
    slow.add("branch-25");
    void h.state.refreshSessions();
    // The refresh applies its session list and reaches ensureCanvasMessages
    // in the same synchronous stretch, still while the batch is in flight.
    for (let round = 0; round < 50 && h.store.sessions.length !== 16; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(h.store.sessions).toHaveLength(16);
    expect(h.store.loadingCanvas).toBe(true);
    // Drain: the late branch has to be read without an extra click or refresh.
    for (let round = 0; round < 50 && !started.includes("branch-25"); round += 1) {
      for (const [id, resolve] of [...pending]) {
        pending.delete(id);
        resolve([USER_ROW]);
      }
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(started).toContain("branch-25");
    // Joining the running batch, not starting a second one: the already-read
    // story is not read again.
    expect(started.filter((id) => id === "s1" || id === "branch-10")).toHaveLength(2);
    for (const [id, resolve] of [...pending]) {
      pending.delete(id);
      resolve([USER_ROW]);
    }
    for (let round = 0; round < 50 && h.store.loadingCanvas; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(h.store.messagesBySession["branch-25"]).toHaveLength(1);
    expect(h.store.loadingCanvas).toBe(false);
  });

  it("starts the new workspace's read while a slow previous workspace still holds slots", async () => {
    const pending = new Map<string, (rows: ChatMessage[]) => void>();
    const calls: Array<{ backend: BackendId; id: string }> = [];
    const other = {
      ...SESSION,
      id: "other",
      directory: "/other",
      updatedAt: SESSION.updatedAt - 1,
    };
    const h = await bootState({
      deferInit: true,
      sessions: [SESSION, other, ...branchSessions(10).slice(1)],
      messages: async (backend, id) => {
        calls.push({ backend, id });
        if (id === "s1" || id === "branch-10" || id === "other") return [USER_ROW];
        return new Promise<ChatMessage[]>((resolve) => {
          pending.set(id, resolve);
        });
      },
    });
    void h.ready;
    await vi.advanceTimersByTimeAsync(0);
    // Four slow requests of the old workspace hold every shared slot.
    expect(pending.size).toBe(4);
    const switching = h.state.switchDirectory("/other");
    void switching;
    await vi.advanceTimersByTimeAsync(0);
    // Still unresolved — the new workspace must read anyway, not wait for them.
    expect(pending.size).toBe(4);
    expect(h.store.selectedId).toBe("other");
    expect(calls).toContainEqual({ backend: "codex", id: "other" });
    expect(h.store.messagesBySession.other).toHaveLength(1);
    for (const [id, resolve] of [...pending]) {
      pending.delete(id);
      resolve([USER_ROW]);
    }
    await vi.advanceTimersByTimeAsync(0);
    await switching;
    await h.ready;
    expect(h.store.loadingMessages).toBe(false);
    expect(h.store.loadingCanvas).toBe(false);
  });

  it.each(["backend", "directory"] as const)(
    "cancels old jobs across a %s switch without clearing the new loading state",
    async (mode) => {
      const pending = new Map<string, (rows: ChatMessage[]) => void>();
      const calls: Array<{ backend: BackendId; id: string }> = [];
      const other = {
        ...SESSION,
        id: "other",
        directory: "/other",
        updatedAt: SESSION.updatedAt - 1,
      };
      const h = await bootState({
        deferInit: true,
        sessions: (backend) =>
          mode === "directory"
            ? [...branchSessions(10), other]
            : backend === "codex"
              ? branchSessions(10)
              : [other],
        messages: async (backend, id) => {
          calls.push({ backend, id });
          if (id === "s1" || id === "branch-10") return [USER_ROW];
          return new Promise<ChatMessage[]>((resolve) => {
            pending.set(id, resolve);
          });
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(pending.size).toBe(4);
      const switching =
        mode === "backend" ? h.state.switchBackend("opencode") : h.state.switchDirectory("/other");
      await vi.advanceTimersByTimeAsync(0);
      const backend = mode === "backend" ? "opencode" : "codex";
      expect(h.store.activeBackend).toBe(backend);
      // The new workspace's read is already in flight — the stale requests
      // that still hold every shared slot have not blocked it.
      expect(calls).toContainEqual({ backend, id: "other" });
      // Free only the old workspace's slots; the new read keeps going.
      for (const [id, resolve] of [...pending]) {
        if (id === "other") continue;
        pending.delete(id);
        resolve([USER_ROW]);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.filter((c) => c.id !== "other")).toHaveLength(6);
      expect(calls.filter((c) => c.id === "other")).toEqual([{ backend, id: "other" }]);
      expect(h.store.loadingMessages).toBe(true);
      expect(h.store.loadingCanvas).toBe(true);
      expect(h.store.selectedId).toBe("other");
      pending.get("other")?.([USER_ROW]);
      await switching;
      await h.ready;
      expect(h.store.loadingMessages).toBe(false);
      expect(h.store.loadingCanvas).toBe(false);
    },
  );

  it("keeps siblings usable after a failed selection and retries it on the next click", async () => {
    let fail = true;
    const h = await bootState({
      sessions: branchSessions(3),
      messages: async (_backend, id) => {
        if (id === "branch-3" && fail) throw new Error("temporarily unavailable");
        return [USER_ROW];
      },
    });
    expect(h.store.messagesError).toBe("temporarily unavailable");
    expect(h.store.messagesBySession["branch-2"]).toHaveLength(1);
    expect(h.store.loadingCanvas).toBe(false);
    fail = false;
    await h.state.selectSession("branch-3");
    expect(h.store.messagesBySession["branch-3"]).toHaveLength(1);
    expect(h.store.messagesError).toBeNull();
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** Drive a started → idle run, flushing the async finishRun chain. */
async function runAndSettle(h: Awaited<ReturnType<typeof bootState>>): Promise<void> {
  h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
  h.send({ type: "session.idle", sessionId: "s1" });
  await vi.advanceTimersByTimeAsync(1_000);
}

describe("renderer run settle", () => {
  it("stamps the recent tint on a completed run and clears it after five minutes", async () => {
    const h = await bootState();
    await runAndSettle(h);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.alphaFor("s1")).toBe(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.store.recent.s1).toBeUndefined();
    expect(h.alphaFor("s1")).toBe(0);
  });

  it("leaves no tint when the run's last assistant row errored", async () => {
    const h = await bootState({ runError: "codex: provider 500" });
    await runAndSettle(h);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.recent.s1).toBeUndefined();
    expect(h.alphaFor("s1")).toBe(0);
  });

  it("drops a previous run's tint when a rerun fails in flight", async () => {
    const h = await bootState();
    await runAndSettle(h);
    expect(h.alphaFor("s1")).toBe(1);

    h.send({ type: "message.started", sessionId: "s1", messageId: "m4" });
    h.send({ type: "server.error", message: "codex server died", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.recent.s1).toBeUndefined();
    expect(h.alphaFor("s1")).toBe(0);
  });

  it("settles a transport failure without the tint", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.send({ type: "server.error", message: "connection reset", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.recent.s1).toBeUndefined();
    expect(h.alphaFor("s1")).toBe(0);
  });

  it("settles a mid-run session as failed once the backend stays unreachable", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    // The backend died mid-run: every watchdog poll now fails outright.
    h.failMessages(true);
    await vi.advanceTimersByTimeAsync(20 * 1500);
    expect(h.store.running.s1).toBeFalsy();
    expect(h.store.recent.s1).toBeUndefined();
    expect(h.alphaFor("s1")).toBe(0);
  });

  it("rides out a brief outage without settling the run", async () => {
    const h = await bootState();
    h.send({ type: "message.started", sessionId: "s1", messageId: "m2" });
    h.failMessages(true);
    await vi.advanceTimersByTimeAsync(3 * 1500);
    // Backend came back; the run never completed, so it must still be live.
    h.failMessages(false);
    await vi.advanceTimersByTimeAsync(40 * 1500);
    expect(h.store.running.s1).toBeTruthy();
  });
});
