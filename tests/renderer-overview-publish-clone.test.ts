import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi, TagStore } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { ChatMessage, SessionSummary } from "../src/shared/types";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Regression: the cross-window overview publish rides inside refreshSessions'
 * try, and the real IPC boundary structured-clones its payload — a Vue
 * reactive Proxy there throws a DataCloneError synchronously, which the
 * surrounding catch turned into a workspace-wide 未连接. It was
 * deterministic (every refresh, every 15s re-probe), so the self-heal never
 * healed and the pill carried "An object could not be cloned" forever. The
 * overview labs switch is on, so every refresh paid it.
 *
 * The shared overview cache mock clones its argument the way the real
 * ipcRenderer.invoke does, so a reactive payload fails here too.
 */

const S1: SessionSummary = {
  id: "s1",
  title: "会话一",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const C1: SessionSummary = { ...S1, id: "c1", title: "codex 会话" };

const S1_USER: ChatMessage = {
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

async function bootState() {
  vi.resetModules();
  const tags: TagStore = { sessions: { s1: ["执行"] }, colors: {} };
  const published: Array<{ backend: BackendId; listing: unknown }> = [];
  const api: AweforkApi = {
    ready: vi.fn(async () => ({ ok: true })),
    sessions: vi.fn(async (backend: BackendId) =>
      backend === "codex" ? { sessions: [C1], lineage: {} } : { sessions: [S1], lineage: {} },
    ),
    messages: vi.fn(async (_backend: BackendId, sessionId: string) =>
      sessionId === "s1" ? [S1_USER] : [],
    ),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => S1,
    fork: async () => S1,
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
    tags: vi.fn(async (): Promise<TagStore> => tags),
    setSessionTags: vi.fn(async (): Promise<TagStore> => tags),
    setTagColor: vi.fn(async (): Promise<TagStore> => ({ sessions: {}, colors: {} })),
    deleteTag: vi.fn(async (): Promise<TagStore> => ({ sessions: {}, colors: {} })),
    trash: async () => [{ id: "s1", deletedAt: 1 }],
    trashAdd: async () => [],
    trashRemove: async () => [],
    archive: async () => ({ sessions: [{ id: "old", archivedAt: 1 }], directories: [] }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: vi.fn(async () => ({ sessions: [], directories: [] })),
    composer: async () => null,
    saveComposer: async () => {},
    backends: async () => ({
      selected: "opencode",
      backends: [
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
        { id: "codex", label: "codex", installed: true, version: null, versionWarning: null },
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
    checkUpdates: async () => ({
      currentVersion: "0.5.4",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (_handler: (envelope: BackendEventEnvelope) => void) => () => {},
    ...createOverviewLedgerMock(),
    // The publish's real boundary: ipcRenderer.invoke structured-clones its
    // arguments and throws synchronously on a payload it cannot clone.
    overviewListings: async () => ({}),
    overviewPublishListing: (backend: BackendId, listing: unknown) => {
      structuredClone(listing);
      published.push({ backend, listing });
      return Promise.resolve(true);
    },
    onOverviewListing: () => () => {},
    overviewRunning: async () => [],
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return { store: state.store, published, switchBackend: state.switchBackend };
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

describe("overview publish payload", () => {
  it("keeps the workspace connected when the publish crosses the IPC boundary", async () => {
    const h = await bootState();
    // The overview labs switch is on, so the boot's refresh really published.
    expect(h.published.length).toBeGreaterThan(0);
    // A failed publish is best-effort: it must never read as 未连接.
    expect(h.store.connectionError).toBeNull();
  });

  it("keeps the workspace connected across a backend switch", async () => {
    const h = await bootState();
    await h.switchBackend("codex");
    expect(h.store.connectionError).toBeNull();
    expect(h.published.some((entry) => entry.backend === "codex")).toBe(true);
  });
});
