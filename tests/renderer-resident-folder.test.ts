import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { SessionSummary } from "../src/shared/types";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * The resident folder: one standing folder in the sidebar's file list, kept
 * in the settings blob (app-level, so a backend switch cannot drop it) and
 * folded into a session's project group when both name the same directory.
 *
 * The state module is a singleton, so each test boots a fresh instance with
 * a seeded settings blob and a scripted window.awefork.
 */

const SHOP: SessionSummary = {
  id: "s1",
  title: "登录接口排查",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_000_000,
  updatedAt: 1_726_000_000_000,
};

const HOME: SessionSummary = {
  id: "s2",
  title: "随手记",
  directory: "/demo/notes",
  parentSessionId: null,
  origin: "root",
  createdAt: 1_726_000_100_000,
  updatedAt: 1_726_000_100_000,
};

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let storage: MemoryStorage;

/** A blob with every section but the resident-folder key — a pre-upgrade file. */
function legacyBlob(): string {
  return JSON.stringify({ appearance: { theme: "system" } });
}

async function bootState(
  options: {
    sessions?: SessionSummary[];
    /** What the legacy dirs sidecar answers (read for the adoption). */
    legacyDirs?: string[];
    /** What the native folder picker answers. */
    picked?: string | null;
    /** A settings blob to seed; omit for the pre-upgrade shape. */
    blob?: string;
  } = {},
) {
  vi.resetModules();
  storage = new MemoryStorage();
  if (options.blob !== undefined) storage.setItem("awefork:settings", options.blob);
  else storage.setItem("awefork:settings", legacyBlob());
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;

  const sessions = options.sessions ?? [SHOP, HOME];
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions, lineage: {} }),
    messages: async () => [],
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => SHOP,
    fork: async () => SHOP,
    deleteSession: async () => [],
    deleteMessage: async () => {},
    prompt: async () => {},
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: async () => {},
    openSessionTerminal: async () => ({ ok: true }),
    pins: async () => [],
    togglePin: async () => [],
    dirs: async () => options.legacyDirs ?? [],
    pickDirectory: async () => options.picked ?? null,
    tags: async () => ({ sessions: {}, colors: {} }),
    setSessionTags: async () => ({ sessions: {}, colors: {} }),
    setTagColor: async () => ({ sessions: {}, colors: {} }),
    deleteTag: async () => ({ sessions: {}, colors: {} }),
    addTagsToSessions: async () => ({ sessions: {}, colors: {} }),
    setForkTagPref: async () => ({ sessions: {}, colors: {} }),
    trash: async () => [],
    trashAdd: async () => [],
    trashRemove: async () => [],
    archive: async () => ({ sessions: [], directories: [] }),
    archiveAdd: async () => ({ sessions: [], directories: [] }),
    archiveRemove: async () => ({ sessions: [], directories: [] }),
    composer: async () => null,
    saveComposer: async () => {},
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    backends: async () => ({
      selected: "codex" as BackendId,
      backends: [
        {
          id: "codex" as BackendId,
          label: "codex",
          installed: true,
          version: null,
          versionWarning: null,
        },
      ],
    }),
    selectBackend: async () => ({ ok: true }),
    openAgentWindow: async () => ({ ok: true }),
    capabilities: async () => ({ deleteMessage: false, attachments: false, fileChanges: false }),
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
    onEvent: (_handler: (envelope: BackendEventEnvelope) => void) => () => {},
    ...createOverviewLedgerMock(),
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };

  const state = await import("../src/renderer/src/state");
  const settings = await import("../src/renderer/src/settings");
  await state.init();
  return { state, settings };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

describe("resident folder", () => {
  it("adopts the first legacy hand-added directory on the first boot", async () => {
    const { state } = await bootState({ legacyDirs: ["/legacy/first", "/legacy/second"] });
    // One folder, not a list: the extra registrations are the pre-upgrade
    // shape and the ＋ entry replaces the standing one from here on.
    expect(state.residentFolder.value).toBe("/legacy/first");
    expect(state.sessionGroups.value.map((group) => group.directory)).toEqual([
      "/demo/notes",
      "/demo/shop-api",
      "/legacy/first",
    ]);
  });

  it("does not re-adopt after the user cleared the folder", async () => {
    const { state, settings } = await bootState({ legacyDirs: ["/legacy/first"] });
    expect(state.residentFolder.value).toBe("/legacy/first");
    await state.clearResidentFolder();
    expect(settings.settings.files.residentFolder).toBe("");

    // A second boot with the same sidecar must leave it cleared — the blob
    // now carries the key, which is the user's answer.
    const second = await bootState({
      legacyDirs: ["/legacy/first"],
      blob: JSON.stringify({ files: { residentFolder: "" } }),
    });
    expect(second.state.residentFolder.value).toBe("");
  });

  it("folds into the project group when it is the same folder", async () => {
    const { state } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/demo/shop-api" } }),
    });
    // One row for the folder, not an empty twin beside it.
    expect(state.sessionGroups.value.map((group) => group.directory)).toEqual([
      "/demo/notes",
      "/demo/shop-api",
    ]);
    expect(state.isResidentFolder("/demo/shop-api")).toBe(true);
    expect(state.isResidentFolder("/demo/shop-api/")).toBe(true);
    expect(state.isResidentFolder("/demo/notes")).toBe(false);
  });

  it("keeps a standing group for a folder with no conversations", async () => {
    const { state } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/demo/scratch" } }),
    });
    const scratch = state.sessionGroups.value.find((g) => g.directory === "/demo/scratch");
    expect(scratch).toBeDefined();
    expect(scratch?.roots).toEqual([]);
  });

  it("＋ stands the picked folder up and opens it as the project", async () => {
    const { state, settings } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/old/home" } }),
      picked: "/demo/shop-api",
    });
    await state.chooseResidentFolder();
    // Replacing, not accumulating: one standing folder at a time.
    expect(settings.settings.files.residentFolder).toBe("/demo/shop-api");
    expect(state.store.selectedDirectory).toBe("/demo/shop-api");
    expect(state.sessionGroups.value).toHaveLength(2);
  });

  it("a canceled picker changes nothing", async () => {
    const { state, settings } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/demo/scratch" } }),
      picked: null,
    });
    await state.chooseResidentFolder();
    expect(settings.settings.files.residentFolder).toBe("/demo/scratch");
  });

  it("clearing the folder while it is the empty open project moves the view on", async () => {
    const { state, settings } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/demo/scratch" } }),
    });
    await state.switchDirectory("/demo/scratch");
    expect(state.store.selectedDirectory).toBe("/demo/scratch");

    await state.clearResidentFolder();
    expect(settings.settings.files.residentFolder).toBe("");
    expect(state.sessionGroups.value.some((g) => g.directory === "/demo/scratch")).toBe(false);
    expect(state.store.selectedDirectory).not.toBe("/demo/scratch");
  });

  it("clearing keeps the view when the folder still holds conversations", async () => {
    const { state, settings } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/demo/shop-api" } }),
    });
    await state.switchDirectory("/demo/shop-api");
    await state.clearResidentFolder();
    expect(settings.settings.files.residentFolder).toBe("");
    expect(state.store.selectedDirectory).toBe("/demo/shop-api");
  });

  it("ignores a blank pick", async () => {
    const { state, settings } = await bootState({
      blob: JSON.stringify({ files: { residentFolder: "/demo/scratch" } }),
    });
    state.setResidentFolder("   ");
    expect(settings.settings.files.residentFolder).toBe("/demo/scratch");
    state.setResidentFolder("  /demo/other  ");
    expect(settings.settings.files.residentFolder).toBe("/demo/other");
  });
});
