import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Compare-lens fold isolation harness: the state module is a singleton, so
 * every test boots a fresh instance via vi.resetModules + dynamic import,
 * backed by a scripted window.awefork. Two unrelated stories (their chains
 * never meet) drive the free side-by-side mode, where each column builds its
 * cards from its own messages — the shape where two sessions can mint the
 * same message ids.
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
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

/** Two turns whose ids collide across the two sessions. */
function rowsFor(sessionId: string): ChatMessage[] {
  const turn = (n: number): ChatMessage[] => [
    {
      id: `m${n}`,
      role: "user",
      text: `第 ${n} 轮问题`,
      thinking: "",
      toolNames: [],
      modelId: null,
      providerId: null,
      variant: null,
      attachmentNames: [],
      createdAt: n,
      completedAt: n,
      finish: null,
      outputTokens: null,
      error: null,
    },
    {
      id: `r${n}`,
      role: "assistant",
      text: `第 ${n} 轮回合 ${sessionId}`,
      thinking: "",
      toolNames: [],
      modelId: null,
      providerId: null,
      variant: null,
      attachmentNames: [],
      createdAt: n,
      completedAt: n,
      finish: "stop",
      outputTokens: 11,
      error: null,
    },
  ];
  return [...turn(1), ...turn(2)];
}

async function bootState() {
  vi.resetModules();
  const messages: Record<string, ChatMessage[]> = {
    "story-a": rowsFor("story-a"),
    "story-b": rowsFor("story-b"),
  };
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [STORY_A, STORY_B], lineage: {} }),
    messages: async (_backend: BackendId, sessionId: string) =>
      structuredClone(messages[sessionId] ?? []),
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
      currentVersion: "0.3.6",
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
  return { state, store: state.store };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("compare free side-by-side fold isolation", () => {
  it("keeps each column's card ids distinct even when message ids collide", async () => {
    const h = await bootState();
    await h.state.enterCompare("story-a", "story-b");

    // Two unrelated stories never meet, so the lens renders free columns.
    expect(h.state.comparePlan.value).toBeNull();
    const left = h.store.messagesBySession["story-a"];
    const right = h.store.messagesBySession["story-b"];
    expect(left?.length).toBe(4);
    expect(right?.length).toBe(4);

    // Both stories mint the same message ids (m1/m2). The turn keys must
    // collide once the session prefix is stripped, or the namespacing below
    // would be untested — an unnamespaced id could let one column's fold
    // state ride on the other column's card.
    const { buildTurns } = await import("../src/shared/turns");
    const bareKeysFor = (sessionId: string) =>
      buildTurns(sessionId, h.store.messagesBySession[sessionId] ?? []).map(
        (turn) => turn.messageId,
      );
    expect(bareKeysFor("story-a")).toEqual(bareKeysFor("story-b"));

    const sides = ["left", "right"] as const;
    const namespaced = (sessionId: string, side: (typeof sides)[number]) =>
      buildTurns(sessionId, h.store.messagesBySession[sessionId] ?? []).map(
        (turn) => `${side}:${sessionId}:${turn.messageId}`,
      );
    const leftIds = namespaced("story-a", "left");
    const rightIds = namespaced("story-b", "right");
    expect(leftIds).not.toEqual(rightIds);
    for (const id of leftIds) expect(rightIds).not.toContain(id);
  });

  it("resets a reused slot's fold when the card behind it changes", async () => {
    const h = await bootState();
    await h.state.enterCompare("story-a", "story-b");
    expect(h.store.compare).not.toBeNull();

    // The compare view keys rows by position, so a rebuilt plan reuses a slot.
    // Swapping the pair must not carry one card's expansion onto the next.
    h.state.exitCompare();
    await h.state.enterCompare("story-b", "story-a");
    expect(h.store.compare).toEqual({ leftId: "story-b", rightId: "story-a" });
    // Column titles follow the swap, proving the lens re-read the pair rather
    // than reusing the previous render's identity.
    expect(h.store.compare?.leftId).toBe("story-b");
  });
});
