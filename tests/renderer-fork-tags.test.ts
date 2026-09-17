import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi, TagStore } from "../src/shared/awefork-api";
import type { TurnNode } from "../src/shared/canvas-graph";
import type { ChatMessage, SessionSummary } from "../src/shared/types";

/**
 * Fork tag inheritance (rule B) and subtree application (rule A), driven
 * through the real renderer state singleton with a scripted, STATEFUL tags
 * sidecar — the mock store mutates like tags-store.ts so assertions can read
 * the final shape through both the API reply and store.forkTagPrefs.
 */

const ROOT: SessionSummary = {
  id: "root",
  title: "根会话",
  directory: "/demo",
  parentSessionId: null,
  origin: "root",
  createdAt: 1,
  updatedAt: 3,
};
const CHILD: SessionSummary = {
  ...ROOT,
  id: "child",
  title: "子会话",
  parentSessionId: "root",
  origin: "fork",
  updatedAt: 2,
};
const GRAND: SessionSummary = {
  ...ROOT,
  id: "grand",
  title: "孙会话",
  parentSessionId: "child",
  origin: "fork",
  updatedAt: 1,
};
const FORKED: SessionSummary = {
  ...ROOT,
  id: "fork-1",
  title: "根会话 的分支",
  origin: "fork",
  parentSessionId: "root",
};

async function bootState(options: { tags?: TagStore } = {}) {
  vi.resetModules();
  const store: TagStore = options.tags
    ? {
        sessions: { ...options.tags.sessions },
        colors: { ...options.tags.colors },
        ...(options.tags.forkPref ? { forkPref: { ...options.tags.forkPref } } : {}),
      }
    : { sessions: {}, colors: {} };
  const clone = (): TagStore => ({
    sessions: Object.fromEntries(
      Object.entries(store.sessions).map(([id, tags]) => [id, [...tags]]),
    ),
    colors: { ...store.colors },
    ...(store.forkPref ? { forkPref: { ...store.forkPref } } : {}),
  });
  const userMessage = (id: string, text: string): ChatMessage => ({
    id,
    role: "user",
    text,
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
  });
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [ROOT, CHILD, GRAND], lineage: {} }),
    messages: async (_backend, sessionId) =>
      sessionId === "root" ? [userMessage("m1", "第一问"), userMessage("m2", "第二问")] : [],
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => ROOT,
    fork: vi.fn(async () => FORKED),
    deleteSession: async () => [],
    deleteMessage: async () => {},
    prompt: async () => {},
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: async () => {},
    openSessionTerminal: async () => ({ ok: true }),
    pins: async () => [],
    togglePin: async () => [],
    marks: async () => [],
    toggleMark: async () => [],
    tags: async () => clone(),
    setSessionTags: vi.fn(async (_backend, sessionId, tags) => {
      const normalized = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
      if (normalized.length > 0) store.sessions[sessionId] = normalized;
      else delete store.sessions[sessionId];
      return clone();
    }),
    setTagColor: async () => clone(),
    deleteTag: async () => clone(),
    addTagsToSessions: vi.fn(async (_backend, sessionIds, tags) => {
      const add = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
      for (const id of sessionIds) {
        const merged = [...(store.sessions[id] ?? [])];
        for (const tag of add) {
          if (!merged.includes(tag)) merged.push(tag);
        }
        store.sessions[id] = merged;
      }
      return clone();
    }),
    setForkTagPref: vi.fn(async (_backend, sessionId, pref) => {
      store.forkPref = store.forkPref ?? {};
      if (pref === null) delete store.forkPref[sessionId];
      else store.forkPref[sessionId] = pref;
      return clone();
    }),
    searchMessages: async () => ({ hits: [], excludedSessionIds: [], scanned: 0 }),
    trash: async () => [],
    trashAdd: async () => [],
    trashRemove: async () => [],
    archive: async () => ({ sessions: [], directories: [] }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: async () => ({ sessions: [], directories: [] }),
    dirs: async () => [],
    dirsAdd: async () => [],
    dirsRemove: async () => [],
    composer: async () => null,
    saveComposer: async () => {},
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    backends: async () => ({
      selected: "opencode",
      backends: [
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    capabilities: async () => ({
      deleteMessage: true,
      attachments: true,
      fileChanges: true,
    }),
    openPath: async () => ({ ok: true }),
    pickDirectory: async () => null,
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.0.0", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    downloadAndInstallUpdate: async () => ({ ok: true }),
    onUpdateProgress: () => () => {},
    onEvent: () => () => {},
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  const history = await import("../src/renderer/src/history");
  await state.init();
  // Rule B rides the mid-turn fork path: load root's turns, open a draft on
  // the non-tip m1 turn, arm its text. sendMidTurnFork runs synchronously up
  // to the ask, so tests can observe the pending dialog before answering.
  await state.selectSession("root");
  state.openDraft({ kind: "turn", sessionId: "root", messageId: "m1" } as TurnNode);
  state.setDraftText("换个方向试试");
  return {
    store: state.store,
    api,
    tagStore: clone,
    answerForkTagAsk: state.answerForkTagAsk,
    sendMidTurnFork: () => state.sendDraft(),
    setDraftContextMode: state.setDraftContextMode,
    applyTagsToSubtree: state.applyTagsToSubtree,
    setForkTagPref: state.setForkTagPref,
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

describe("fork tag inheritance (rule B)", () => {
  it("asks before forking a tagged session with no stored preference", async () => {
    const h = await bootState({ tags: { sessions: { root: ["执行"] }, colors: {} } });
    const pending = h.sendMidTurnFork();

    // The ask opened synchronously — the fork has NOT fired yet.
    expect(h.store.forkTagAsk).toMatchObject({ parentSessionId: "root" });
    expect(h.api.fork).not.toHaveBeenCalled();

    h.answerForkTagAsk("inherit", false);
    await pending;

    expect(h.api.fork).toHaveBeenCalledWith("opencode", "root", "m1", { context: "inherit" });
    expect(h.api.setSessionTags).toHaveBeenCalledWith("opencode", "fork-1", ["执行"]);
    // No remember-me: the preference stays ask-every-time.
    expect(h.api.setForkTagPref).not.toHaveBeenCalled();
    expect(h.store.forkTagPrefs).toEqual({});
  });

  it("persists the preference when the ask is answered with remember-me", async () => {
    const h = await bootState({ tags: { sessions: { root: ["执行"] }, colors: {} } });
    const pending = h.sendMidTurnFork();

    h.answerForkTagAsk("skip", true);
    await pending;

    // Fork happened, no tags copied, preference pinned to "never inherit".
    expect(h.api.fork).toHaveBeenCalled();
    expect(h.api.setSessionTags).not.toHaveBeenCalledWith("opencode", "fork-1", expect.anything());
    expect(h.tagStore().forkPref).toEqual({ root: false });
    expect(h.store.forkTagPrefs).toEqual({ root: false });
  });

  it("honors a stored preference silently — no ask, no fork-abort ambiguity", async () => {
    const h = await bootState({
      tags: { sessions: { root: ["执行", "咨询"] }, colors: {}, forkPref: { root: true } },
    });
    await h.sendMidTurnFork();

    expect(h.store.forkTagAsk).toBeNull();
    expect(h.api.fork).toHaveBeenCalled();
    expect(h.api.setSessionTags).toHaveBeenCalledWith("opencode", "fork-1", ["执行", "咨询"]);
  });

  it("never asks nor inherits for an untagged parent", async () => {
    const h = await bootState();
    await h.sendMidTurnFork();

    expect(h.store.forkTagAsk).toBeNull();
    expect(h.api.fork).toHaveBeenCalled();
    expect(h.api.setSessionTags).not.toHaveBeenCalled();
  });

  it("canceling the ask aborts the fork before anything fires", async () => {
    const h = await bootState({ tags: { sessions: { root: ["执行"] }, colors: {} } });
    const pending = h.sendMidTurnFork();

    h.answerForkTagAsk("cancel", false);
    await pending;

    expect(h.api.fork).not.toHaveBeenCalled();
    expect(h.api.setSessionTags).not.toHaveBeenCalled();
    expect(h.store.forkTagAsk).toBeNull();
  });

  it("setForkTagPref round-trips and undoes through history", async () => {
    const h = await bootState({ tags: { sessions: { root: ["执行"] }, colors: {} } });

    expect(await h.setForkTagPref("root", true)).toBe(true);
    expect(h.store.forkTagPrefs).toEqual({ root: true });
    // Same value again is a no-op (no duplicate history entry).
    expect(await h.setForkTagPref("root", true)).toBe(true);

    expect(await h.undoSteps(1)).toBe(true);
    expect(h.store.forkTagPrefs).toEqual({});

    // null clears back to ask-every-time (key deleted on disk).
    await h.setForkTagPref("root", false);
    await h.setForkTagPref("root", null);
    expect(h.store.forkTagPrefs).toEqual({});
    expect(h.tagStore().forkPref).toEqual({});
  });
});

describe("subtree tag application (rule A)", () => {
  it("union-adds to every descendant in one write and undoes exactly it", async () => {
    const h = await bootState({
      tags: { sessions: { root: ["执行"], child: ["实验"] }, colors: {} },
    });

    await h.applyTagsToSubtree("root", ["执行"]);

    // grand carries nothing yet; child already has 实验 — union appends 执行.
    expect(h.api.addTagsToSessions).toHaveBeenCalledWith("opencode", ["child", "grand"], ["执行"]);
    expect(h.tagStore().sessions).toEqual({
      root: ["执行"],
      child: ["实验", "执行"],
      grand: ["执行"],
    });

    await h.undoSteps(1);
    expect(h.tagStore().sessions).toEqual({ root: ["执行"], child: ["实验"] });
  });

  it("skips descendants that already carry every tag (no-op write, no entry)", async () => {
    const h = await bootState({
      tags: { sessions: { root: ["执行"], child: ["执行"], grand: ["执行"] }, colors: {} },
    });

    await h.applyTagsToSubtree("root", ["执行"]);

    expect(h.api.addTagsToSessions).not.toHaveBeenCalled();
    expect(h.store.actionError).toBeNull();
  });

  it("does nothing for a session without descendants", async () => {
    const h = await bootState({ tags: { sessions: { grand: ["执行"] }, colors: {} } });

    await h.applyTagsToSubtree("grand", ["咨询"]);

    expect(h.api.addTagsToSessions).not.toHaveBeenCalled();
  });
});

describe("empty-context fork (草稿开关)", () => {
  it("sends the draft's context mode with the fork call", async () => {
    const h = await bootState();
    h.setDraftContextMode("none");
    await h.sendMidTurnFork();

    // The branch starts a brand-new session instead of copying parent turns.
    expect(h.api.fork).toHaveBeenCalledWith("opencode", "root", "m1", { context: "none" });
  });

  it("defaults to inherit when the toggle was never touched", async () => {
    const h = await bootState();
    await h.sendMidTurnFork();

    expect(h.api.fork).toHaveBeenCalledWith("opencode", "root", "m1", { context: "inherit" });
  });
});
