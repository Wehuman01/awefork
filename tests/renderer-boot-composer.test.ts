import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { ChatMessage, PersistedComposer, SessionSummary } from "../src/shared/types";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/** The session lives in /demo/shop-api but the app opens on a DIFFERENT dir
 *  first — the classic cold start where refreshSessions auto-selects the
 *  newest session's directory, which is a state change mid-boot. */
const OPENCODE: SessionSummary = {
  id: "s1",
  title: "登录接口排查",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const FAV = [
  { providerId: "magpie", modelId: "workbuddy-ai/step-5-preview" },
  { providerId: "oc-awerouter", modelId: "glm/glm-5.3-flash" },
];

/** The on-disk sidecar the app boots against. Mutated by the harness so the
 *  test sees what the app would really read next time. */
let onDisk: PersistedComposer | null = null;

async function boot(options: { composer?: PersistedComposer | null } = {}) {
  vi.resetModules();
  const saves: Array<{ backend: BackendId; value: PersistedComposer | null }> = [];
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: vi.fn(async () => ({ sessions: [OPENCODE], lineage: {} })),
    messages: vi.fn(async (): Promise<ChatMessage[]> => []),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => OPENCODE,
    fork: vi.fn(async () => OPENCODE),
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
    composer: vi.fn(async () => onDisk),
    saveComposer: vi.fn(async (_backend: BackendId, value: PersistedComposer | null) => {
      saves.push({ backend: _backend, value });
      onDisk = value;
    }),
    backends: async () => ({
      selected: "opencode",
      backends: [
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    // One-window harness: the multi-window jump never engages (multiWindow
    // defaults off) but init() subscribes unconditionally.
    requestAgentNavigate: async () => ({ ok: true }),
    onAgentNavigate: () => () => {},
    agentNavigateReady: async () => false,
    capabilities: async () => ({
      deleteMessage: true,
      attachments: true,
      compress: true,
      exportBranch: true,
    }),
    openPath: async () => ({ ok: true }),
    openExternal: async () => {},
    convertDocument: async () => "",
    checkUpdates: async () => ({ currentVersion: "0.3.7", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (_handler: (envelope: BackendEventEnvelope) => void) => () => {},
    ...createOverviewLedgerMock(),
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return { store: state.store, mod: state, api, saves };
}

beforeEach(() => {
  vi.useFakeTimers();
  onDisk = {
    draft: null,
    paneModels: {},
    lastModel: null,
    favoriteModels: FAV,
    recentModels: [],
    selectedDirectory: "/demo/shop-api",
  };
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("boot must not clobber the saved favorites", () => {
  it("a mid-boot state change does not wipe favorites before they are restored", async () => {
    const h = await boot();
    // Let the whole boot settle, including the debounced flush.
    await vi.advanceTimersByTimeAsync(2000);

    // The sidecar on disk still carries the favorites.
    expect(onDisk?.favoriteModels).toEqual(FAV);
    // And the store shows them.
    expect(h.store.favoriteModels).toEqual(FAV);
  });
});
