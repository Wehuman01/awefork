import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Tab restore across restarts, per backend. The harness boots the real
 * state module against a scripted window.awefork twice (vi.resetModules
 * between boots = a restart), with a localStorage stand-in that survives
 * both — the second boot must revive the strip the first one parked.
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
  ...STORY_A,
  id: "story-b",
  title: "排查支付",
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

let apiSessions: SessionSummary[] = [STORY_A, STORY_B];

/** localStorage stand-in: shared across the two boots, like the real one. */
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};

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
  vi.stubGlobal("localStorage", localStorageMock);
  const state = await import("../src/renderer/src/state");
  await state.init();
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  apiSessions = [STORY_A, STORY_B];
  storage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("canvas tab restore across restarts", () => {
  it("brings the parked strip back on the next launch", async () => {
    // Launch one: two tabs open, story-b active (boot picked the latest).
    const first = await bootState();
    await first.openCanvasTab("story-a");
    expect(first.store.canvasTabs.length).toBe(2);
    // Let the debounced persist land.
    await vi.advanceTimersByTimeAsync(400);
    expect(storage.size).toBe(1);

    // Launch two (resetModules = a fresh module registry): the strip the
    // first launch parked comes back — same count, same stories, and the
    // active tab is still story-a's tab.
    const second = await bootState();
    expect(second.store.canvasTabs.length).toBe(2);
    expect(second.store.selectedId).toBe("story-a");
    const roots = second.store.canvasTabs.map((t) => t.rootId).sort();
    expect(roots).toEqual(["story-a", "story-b"]);
  });

  it("keeps each backend's strip in its own slot", async () => {
    const first = await bootState();
    await first.openCanvasTab("story-a");
    await vi.advanceTimersByTimeAsync(400);
    // Both a codex key and a distinct opencode key can coexist; the boot
    // only ever reads its own backend's.
    storage.set(
      "awefork:tabs:opencode",
      JSON.stringify({ tabs: [{ rootId: "x" }], activeTabId: "x" }),
    );
    const second = await bootState();
    expect(second.store.canvasTabs.map((t) => t.rootId).sort()).toEqual(["story-a", "story-b"]);
  });

  it("a closed strip restores as one blank tab, not yesterday's tabs", async () => {
    const first = await bootState();
    await first.openCanvasTab("story-a");
    // Close both tabs: the strip parks one blank tab. The restore must not
    // resurrect the closed stories as TABS — the blank tab may still adopt
    // the latest story on refill (that is the blank tab's job), but the
    // strip is one tab, not the two that were closed.
    const ids = first.store.canvasTabs.map((t) => t.id);
    for (const id of ids) await first.closeCanvasTab(id);
    await vi.advanceTimersByTimeAsync(400);

    const second = await bootState();
    expect(second.store.canvasTabs.length).toBe(1);
    // One tab whose own record was blank; whatever it adopted on refill is
    // the blank tab's normal behavior, not a restore of the closed pair.
    const saved = JSON.parse(storage.get("awefork:tabs:codex") ?? "{}") as {
      tabs: Array<{ rootId: string | null }>;
    };
    expect(saved.tabs.length).toBe(1);
    expect(saved.tabs[0]?.rootId).toBeNull();
  });

  it("ignores a corrupt saved strip and boots fresh", async () => {
    storage.set("awefork:tabs:codex", "{not json");
    const state = await bootState();
    // Corrupt entry costs only the restore: one blank tab boots (and the
    // refill may then adopt the latest story into it, as any blank tab
    // would), never a crash and never garbage tabs.
    expect(state.store.canvasTabs.length).toBe(1);
    expect(state.store.selectedId).toBe("story-b");
  });

  it("drops tabs whose story died while the app was away", async () => {
    const first = await bootState();
    await first.openCanvasTab("story-a");
    await vi.advanceTimersByTimeAsync(400);

    // story-b is gone by the next launch; only story-a's tab revives with
    // content, and the refill lands somewhere honest rather than claiming
    // a dead story.
    apiSessions = [STORY_A];
    const second = await bootState();
    expect(second.store.canvasTabs.length).toBe(2);
    // The first listing of a launch is exactly the one a cold server can
    // answer incompletely, so a restored tab gets the same grace every other
    // tab now gets — then the dead story parks blank.
    await second.refreshSessions();
    expect(second.store.canvasTabs.length).toBe(2);
    await vi.advanceTimersByTimeAsync(9_000);
    await second.refreshSessions();
    const live = second.store.canvasTabs.filter((t) => t.rootId !== null);
    expect(live.length).toBe(1);
    expect(live[0]?.rootId).toBe("story-a");
  });
});
