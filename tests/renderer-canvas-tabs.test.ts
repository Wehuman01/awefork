import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";

/**
 * Canvas-tab model harness: same singleton-boot pattern as the compare-fold
 * tests (vi.resetModules + scripted window.awefork). Two unrelated stories
 * stand in for the two tabs' contents; fork trees stay out of the picture
 * because the tab model only keys on story roots.
 */

const STORY_A: SessionSummary = {
  id: "story-a",
  title: "排查登录",
  directory: "/demo/shop",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const STORY_B: SessionSummary = {
  id: "story-b",
  title: "排查支付",
  directory: "/demo/shop",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_001,
  updatedAt: 1_726_000_000_001,
};

const FORK_OF_A: SessionSummary = {
  ...STORY_A,
  id: "a-fork",
  title: "登录的分支",
  parentSessionId: "story-a",
  origin: "fork",
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
let apiSessions: SessionSummary[] = [STORY_A, STORY_B];

async function bootState() {
  vi.resetModules();
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: apiSessions, lineage: {} }),
    messages: async (_backend: BackendId, sessionId: string) => rowsFor(sessionId),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => STORY_A,
    fork: async () => STORY_A,
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
    saveComposer: async () => {},
    backends: async () => ({
      selected: "codex",
      backends: [
        { id: "codex", label: "codex", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    capabilities: async () => ({ deleteMessage: true, attachments: true }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({
      currentVersion: "0.3.9",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: () => () => {},
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  apiSessions = [STORY_A, STORY_B];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("canvas tabs", () => {
  it("opens a second story in a new tab and parks the first one", async () => {
    const state = await bootState();
    expect(state.store.selectedId).toBe("story-b"); // boot picks the latest

    await state.openCanvasTab("story-a");
    expect(state.store.canvasTabs.length).toBe(2);
    expect(state.store.selectedId).toBe("story-a");
    const parked = state.store.canvasTabs.find((t) => t.selectedId === "story-b");
    expect(parked?.rootId).toBe("story-b");

    // The canvas was asked to replay the incoming tab's camera state.
    expect(state.store.canvasTabRestoreRequest?.tabId).toBe(state.store.activeCanvasTabId);
  });

  it("dedupes on the story root — one story, one tab", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a");
    expect(state.store.canvasTabs.length).toBe(2);

    // Back to tab 1, then open a fork of story-a: same root, so it must
    // reuse the existing story-a tab instead of spawning a third.
    await state.activateCanvasTab(state.store.canvasTabs[0].id);
    apiSessions = [STORY_A, STORY_B, FORK_OF_A];
    await state.refreshSessions();
    await state.openCanvasTab("a-fork");
    expect(state.store.canvasTabs.length).toBe(2);
    expect(state.store.selectedId).toBe("a-fork");
    expect(state.activeCanvasTab.value?.rootId).toBe("story-a");
  });

  it("switching back restores the parked selection", async () => {
    const state = await bootState();
    const first = state.store.activeCanvasTabId;
    await state.openCanvasTab("story-a");
    expect(state.store.selectedId).toBe("story-a");

    await state.activateCanvasTab(first!);
    expect(state.store.selectedId).toBe("story-b");
  });

  it("closing the last tab leaves one blank tab, not a limbo", async () => {
    const state = await bootState();
    await state.closeCanvasTab(state.store.activeCanvasTabId!);
    expect(state.store.canvasTabs.length).toBe(1);
    expect(state.store.selectedId).toBeNull();
    expect(state.store.activeCanvasTabId).toBe(state.store.canvasTabs[0]?.id);
  });

  it("parks a tab whose story went away as blank", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a");
    const storyATab = state.store.activeCanvasTabId;

    apiSessions = [STORY_B]; // story-a deleted server-side
    await state.refreshSessions();

    const parked = state.store.canvasTabs.find((t) => t.id === storyATab);
    expect(parked?.rootId).toBeNull();
    expect(parked?.selectedId).toBeNull();
    // The dying story was the ACTIVE tab, so the live selection blanks with
    // it — and the story-b tab survives untouched in the background.
    expect(state.store.selectedId).toBeNull();
    const survivor = state.store.canvasTabs.find((t) => t.rootId === "story-b");
    expect(survivor).toBeDefined();
  });

  it("keeps the live camera parked on the active tab", async () => {
    const state = await bootState();
    const id = state.store.activeCanvasTabId;
    state.setActiveCanvasTabView({ scale: 0.8, tx: 120, ty: -40 });
    expect(state.store.canvasTabViews[id]).toEqual({ scale: 0.8, tx: 120, ty: -40 });
  });
});
