import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * A fork's story must survive a directory boundary. opencode cuts the copy
 * into whatever directory the client had selected at fork time, so a parent
 * and its fork routinely live in different sidebar groups. The canvas draws
 * the selected session's whole story — the pool behind it is every visible
 * session, not just the current directory's, exactly like the sidebar tree,
 * the tab strip's story-root dedupe and the overview's subtree counts.
 */

const MAIN_DIR = "/repo/main";
const WORKTREE_DIR = "/repo/worktree";

const ROOT: SessionSummary = {
  id: "root",
  title: "原始会话",
  directory: MAIN_DIR,
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const FORK_IN_WORKTREE: SessionSummary = {
  id: "fork-in-worktree",
  title: "worktree 里的分支",
  directory: WORKTREE_DIR,
  parentSessionId: "root",
  origin: "fork",
  createdAt: 1_726_000_000_001,
  updatedAt: 1_726_000_000_001,
};

function rowsFor(sessionId: string): ChatMessage[] {
  return [
    {
      id: "m1",
      role: "user",
      text: `${sessionId} 的问题`,
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
    },
  ];
}

/** Sessions the scripted API reports; tests reassign between refreshes. */
let apiSessions: SessionSummary[] = [ROOT, FORK_IN_WORKTREE];

async function bootState() {
  vi.resetModules();
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: apiSessions, lineage: {} }),
    messages: async (_backend: BackendId, sessionId: string) => rowsFor(sessionId),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => ROOT,
    fork: async () => ROOT,
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
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({
      currentVersion: "0.4.7",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: () => () => {},
    ...createOverviewLedgerMock(),
    ...createOverviewCacheMock(),
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  apiSessions = [ROOT, FORK_IN_WORKTREE];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("canvas story across directories", () => {
  it("brings the parent's card when the fork lives in another directory", async () => {
    const state = await bootState();
    // Boot lands on the latest session — the fork in the worktree.
    expect(state.store.selectedId).toBe("fork-in-worktree");
    expect(state.store.selectedDirectory).toBe(WORKTREE_DIR);

    const ids = state.canvasSessions.value.map((s) => s.id);
    expect(ids.sort()).toEqual(["fork-in-worktree", "root"]);
  });

  it("brings the children's cards when they live in another directory", async () => {
    const state = await bootState();
    await state.selectSession("root", { focus: true });
    expect(state.store.selectedDirectory).toBe(MAIN_DIR);

    const ids = state.canvasSessions.value.map((s) => s.id);
    expect(ids.sort()).toEqual(["fork-in-worktree", "root"]);
  });

  it("draws the story root the tab strip dedupes on", async () => {
    const state = await bootState();
    await state.openCanvasTab("fork-in-worktree");

    // The tab strip keys the story on its true root (computed from every
    // visible session) — the canvas must actually draw that root, not stop
    // at the directory boundary and leave the tab claiming a card it lacks.
    expect(state.activeCanvasTab.value?.rootId).toBe("root");
    const ids = state.canvasSessions.value.map((s) => s.id);
    expect(ids).toContain("root");
  });
});
