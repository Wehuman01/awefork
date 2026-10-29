import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

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

const STORY_C: SessionSummary = {
  ...STORY_A,
  id: "story-c",
  title: "新故事",
  createdAt: 1_726_000_000_002,
  updatedAt: 1_726_000_000_002,
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
      currentVersion: "0.3.9",
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
    ...createDiagnosticsMock(),
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
    const first = state.store.canvasTabs[0]?.id;
    expect(first).toBeDefined();
    await state.openCanvasTab("story-a");
    expect(state.store.selectedId).toBe("story-a");

    await state.activateCanvasTab(first as string);
    expect(state.store.selectedId).toBe("story-b");
  });

  it("closing the last tab leaves one blank tab, not a limbo", async () => {
    const state = await bootState();
    const active = state.store.canvasTabs.find((t) => t.id === state.store.activeCanvasTabId);
    expect(active).toBeDefined();
    await state.closeCanvasTab((active as { id: string }).id);
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
    // One missed refresh is not proof the story died — codex's thread/list
    // can omit a fresh thread for a moment — so the tab keeps its selection
    // (and the pane its composer) until the session stays missing.
    expect(state.store.selectedId).toBe("story-a");
    // The pane gates its composer and message list on selectedSession, which
    // resolves through visibleSessions: a bare selectedId would still unmount
    // them and take the typed draft with it.
    expect(state.selectedSession.value?.id).toBe("story-a");

    vi.advanceTimersByTime(9_000);
    await state.refreshSessions();

    const parked = state.store.canvasTabs.find((t) => t.id === storyATab);
    expect(parked?.rootId).toBeNull();
    expect(parked?.selectedId).toBeNull();
    // A tab blanked for real has no story to name: the strip shows the blank
    // "New canvas" title, and no stand-in resurrects the dead story's name.
    if (parked) expect(state.tabRootSession(parked)).toBeNull();
    // The dying story was the ACTIVE tab, so the live selection blanks with
    // it — and the story-b tab survives untouched in the background.
    expect(state.store.selectedId).toBeNull();
    const survivor = state.store.canvasTabs.find((t) => t.rootId === "story-b");
    expect(survivor).toBeDefined();
  });

  it("keeps a tab's title while the listing drops its whole story", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a"); // story-a active, story-b parked
    const parkedId = state.store.canvasTabs.find((t) => t.selectedId === "story-b")?.id;
    expect(parkedId).toBeDefined();

    // A partial listing drops the parked tab's whole story: opencode's
    // worktree query failed, codex rescanned, a cold server answered before
    // its scan. The tab keeps its record by design — the prune's grace
    // window owns it — so a loaded tab must not rename itself to
    // "New canvas" over the gap.
    apiSessions = [STORY_A];
    await state.refreshSessions();

    const parked = state.store.canvasTabs.find((t) => t.id === parkedId);
    expect(parked?.selectedId).toBe("story-b");
    expect(parked?.rootId).toBe("story-b");
    if (parked) expect(state.tabRootSession(parked)?.title).toBe(STORY_B.title);

    // The active tab's story drops in the same refresh: the strip names it
    // from the same stand-in, the live selection and its pane survive with
    // it, and nothing refills over the parked record.
    apiSessions = [];
    await state.refreshSessions();
    expect(state.store.selectedId).toBe("story-a");
    expect(state.selectedSession.value?.id).toBe("story-a");
    const active = state.activeCanvasTab.value;
    expect(active).toBeDefined();
    if (active) expect(state.tabRootSession(active)?.title).toBe(STORY_A.title);
  });

  it("gives a parked tab the same grace window as the active one", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a"); // story-a active, story-b parked
    const parkedId = state.store.canvasTabs.find((t) => t.selectedId === "story-b")?.id;
    expect(parkedId).toBeDefined();

    // A partial listing — opencode merges one query per worktree and swallows
    // a failed one a[] — still shows the active story but not the parked one.
    apiSessions = [STORY_A];
    await state.refreshSessions();

    // One miss is not proof: the parked tab keeps its story (and its title)
    // instead of turning into a blank "New canvas" tab.
    const parked = state.store.canvasTabs.find((t) => t.id === parkedId);
    expect(parked?.selectedId).toBe("story-b");
    expect(parked?.rootId).toBe("story-b");
    if (parked) expect(state.tabRootSession(parked)?.title).toBe(STORY_B.title);

    // It parks blank only after the session stayed missing past the grace.
    vi.advanceTimersByTime(9_000);
    await state.refreshSessions();
    const gone = state.store.canvasTabs.find((t) => t.id === parkedId);
    expect(gone?.selectedId).toBeNull();
    expect(gone?.rootId).toBeNull();
  });

  it("keeps a parked tab's title when the listing drops its story root", async () => {
    const state = await bootState();
    apiSessions = [STORY_A, STORY_B, FORK_OF_A];
    await state.refreshSessions();
    // Park a tab on the fork, then land on the story-b tab so the fork tab is
    // the inactive one when the listing loses the story-a root row.
    await state.openCanvasTab("a-fork");
    const forkTab = state.store.canvasTabs.find((t) => t.selectedId === "a-fork");
    expect(forkTab).toBeDefined();
    if (!forkTab) return;
    expect(state.tabRootSession(forkTab)?.id).toBe("story-a");
    const storyBTab = state.store.canvasTabs.find((t) => t.selectedId === "story-b");
    expect(storyBTab).toBeDefined();
    if (!storyBTab) return;
    await state.activateCanvasTab(storyBTab.id);

    apiSessions = [STORY_B, FORK_OF_A]; // the worktree holding story-a dropped out
    await state.refreshSessions();

    const tab = state.store.canvasTabs.find((t) => t.id === forkTab.id);
    // Inside the grace window the record keeps its real root, and the title
    // falls back to the live fork — not "New canvas".
    expect(tab?.rootId).toBe("story-a");
    expect(tab).toBeDefined();
    if (tab) expect(state.tabRootSession(tab)?.id).toBe("a-fork");

    // Past the grace the story is re-rooted at the top its chain still has, so
    // dedupe and the title follow the live tree instead of a dead row.
    vi.advanceTimersByTime(9_000);
    await state.refreshSessions();
    const rerooted = state.store.canvasTabs.find((t) => t.id === forkTab.id);
    expect(rerooted?.rootId).toBe("a-fork");
    expect(rerooted).toBeDefined();
    if (rerooted) expect(state.tabRootSession(rerooted)?.id).toBe("a-fork");
  });

  it("heals a tab activation that raced a stale listing", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a");
    const parkedId = state.store.canvasTabs.find((t) => t.selectedId === "story-b")?.id;

    // The listing is stale (story-b created in another window a moment ago,
    // or a worktree query dropped out). Activating the parked tab must ask
    // the backend again before it decides the story died.
    apiSessions = [STORY_A];
    await state.refreshSessions(); // grace keeps story-b parked
    apiSessions = [STORY_A, STORY_B];
    await state.activateCanvasTab(parkedId as string);
    expect(state.store.selectedId).toBe("story-b");
    const tab = state.store.canvasTabs.find((t) => t.id === parkedId);
    expect(tab?.selectedId).toBe("story-b");
  });

  it("a blank tab can adopt a NEW story on refresh", async () => {
    const state = await bootState();
    // What closing the last tab leaves (formerly the ＋ button's blank tab):
    // a blank active tab with the story-died flag cleared…
    await state.closeCanvasTab(state.store.activeCanvasTabId);
    expect(state.store.selectedId).toBeNull();

    // …and a new story appears: the refresh may adopt it into that tab.
    apiSessions = [STORY_A, STORY_B, STORY_C];
    await state.refreshSessions();
    expect(state.store.selectedId).toBe("story-c");
    expect(state.activeCanvasTab.value?.rootId).toBe("story-c");
  });

  it("never adopts a story another open tab already shows", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a"); // tab 2 owns story-a
    // Back to the story-b tab, so the dying story is the ACTIVE one.
    await state.activateCanvasTab(state.store.canvasTabs[0].id);
    apiSessions = [STORY_A]; // story-b deleted server-side
    await state.refreshSessions();
    // Still inside the grace window: the dying tab keeps its selection and
    // adopts nothing.
    expect(state.store.selectedId).toBe("story-b");

    vi.advanceTimersByTime(9_000);
    await state.refreshSessions();

    // The active (story-b) tab died blank; story-a is the only survivor and
    // another tab owns it, so the refill must leave the tab blank rather
    // than put two tabs on one story.
    expect(state.store.selectedId).toBeNull();
    expect(state.store.canvasTabs.filter((t) => t.rootId === "story-a").length).toBe(1);
  });

  it("keeps the live camera parked on the active tab", async () => {
    const state = await bootState();
    const id = state.store.activeCanvasTabId;
    state.setActiveCanvasTabView({ scale: 0.8, tx: 120, ty: -40 });
    expect(state.store.canvasTabViews[id]).toEqual({ scale: 0.8, tx: 120, ty: -40 });
  });

  it("reorders the strip by drag, keeping the active tab's selection", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a");
    const [first, second] = state.store.canvasTabs;
    // Drag the second tab in front of the first: the strip order changes, the
    // canvas does not — the active tab keeps showing story-a.
    state.reorderCanvasTab(second.id, first.id);
    expect(state.store.canvasTabs.map((t) => t.id)).toEqual([second.id, first.id]);
    expect(state.store.activeCanvasTabId).toBe(second.id);
    expect(state.store.selectedId).toBe("story-a");
  });

  it("appends a dragged tab at the end and ignores unknown ids", async () => {
    const state = await bootState();
    await state.openCanvasTab("story-a");
    const [first, second] = state.store.canvasTabs;
    state.reorderCanvasTab(first.id, null);
    expect(state.store.canvasTabs.map((t) => t.id)).toEqual([second.id, first.id]);
    // An unknown id, or a tab dropped onto itself, leaves the strip alone.
    state.reorderCanvasTab("tab-404", first.id);
    state.reorderCanvasTab(second.id, second.id);
    expect(state.store.canvasTabs.map((t) => t.id)).toEqual([second.id, first.id]);
  });
});
