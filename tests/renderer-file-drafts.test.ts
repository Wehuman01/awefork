import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { TurnNode } from "../src/shared/canvas-graph";
import type {
  ChatMessage,
  ModelChoice,
  PersistedComposer,
  SessionSummary,
} from "../src/shared/types";
import { createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * Draft identity × multi-draft preservation: opening a draft for another
 * target parks the outgoing one instead of dropping its text, and coming
 * back restores it verbatim. This is the state half of the path-drop
 * feature — the canvas drop itself inserts into whatever draft is open.
 */

const SESSION: SessionSummary = {
  id: "s1",
  title: "排查登录接口",
  directory: "/demo/shop-api",
  parentSessionId: null,
  origin: "root",
  createdAt: 1,
  updatedAt: 1,
};

const MODEL: ModelChoice = { providerId: "oc", modelId: "glm-5.3" };

function message(
  id: string,
  role: "user" | "assistant",
  over: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role,
    text: role === "user" ? "问题" : "回答",
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
    ...over,
  };
}

/** A turn node for one user message; the last one is the session tip. */
function turnNode(messageId: string): TurnNode {
  return {
    id: `s1:${messageId}`,
    kind: "turn",
    sessionId: "s1",
    messageId,
    title: "一轮",
    preview: "",
    toolNames: [],
    modelIds: [],
    model: null,
    createdAt: 1,
    durationMs: null,
    outputTokens: 0,
    error: null,
    col: 0,
    row: 0,
    x: 0,
    y: 0,
    height: 100,
  };
}

const TIP = turnNode("u3");
const MID = turnNode("u1");

async function bootState(options: { composer?: PersistedComposer | null } = {}) {
  vi.resetModules();
  const saves: Array<{ backend: BackendId; value: PersistedComposer | null }> = [];
  const api: AweforkApi = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [SESSION], lineage: {} }),
    messages: async () => [
      message("u1", "user"),
      message("a1", "assistant"),
      message("u2", "user"),
      message("a2", "assistant"),
      message("u3", "user"),
      message("a3", "assistant"),
    ],
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => SESSION,
    fork: async () => SESSION,
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
    composer: async () => options.composer ?? null,
    saveComposer: vi.fn(async (backend: BackendId, value: PersistedComposer | null) => {
      saves.push({ backend, value });
    }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    backends: async () => ({
      selected: "opencode",
      backends: [{ id: "opencode", label: "opencode", installed: true }],
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
    checkUpdates: async () => ({ currentVersion: "0.2.2", latest: null, updateAvailable: false }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    listDir: async () => ({ ok: false, error: { code: "not-found" } }),
    statFile: async () => ({
      ok: true,
      value: {
        path: "/x",
        exists: false,
        isDir: false,
        isSymlink: false,
        size: null,
        mtime: null,
        hidden: false,
        childCount: null,
      },
    }),
    readTextPreview: async () => ({ ok: false, error: { code: "not-found" } }),
    readImagePreview: async () => ({ ok: false, error: { code: "not-found" } }),
    relativeToRoot: async () => ({ ok: true, value: "x" }),
    searchFiles: async () => ({ ok: true, value: [] }),
    homePath: async () => "/home/demo",
    showInFolder: async () => ({ ok: true }),
    pathForFile: () => null,
    onEvent: (_handler: (envelope: BackendEventEnvelope) => void) => () => {},
    ...createOverviewLedgerMock(),
  };
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  await state.init();
  return { store: state.store, state, api, saves };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("draft identity", () => {
  it("keys a tip draft and a fork draft of the same session apart", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    expect(h.store.draft?.atMessageId).toBeNull();
    h.state.openDraft(MID);
    expect(h.store.draft?.atMessageId).toBe("u1");
  });

  it("starts a fresh draft when the target has no parked text", async () => {
    const h = await bootState();
    h.state.openDraft(MID);
    expect(h.store.draft?.text).toBe("");
  });
});

describe("parking drafts when the target changes", () => {
  it("keeps the outgoing target's text, model and context mode", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.setDraftText("给会话末尾的话");
    h.state.setDraftModel(MODEL);
    h.state.setDraftContextMode("none");

    h.state.openDraft(MID);
    expect(h.store.draft?.text).toBe("");

    h.state.openDraft(TIP);
    expect(h.store.draft?.text).toBe("给会话末尾的话");
    expect(h.store.draft?.model).toEqual(MODEL);
    expect(h.store.draft?.contextMode).toBe("none");
  });

  it("keeps the parked draft's attachments across the switch", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.setDraftText("带附件的话");
    h.state.setDraftAttachments([
      { id: "att_1", name: "a.md", mime: "text/plain", dataUrl: "data:text/plain;base64,QQ==" },
    ]);
    h.state.openDraft(MID);
    h.state.openDraft(TIP);
    expect(h.store.draft?.text).toBe("带附件的话");
    expect(h.store.draft?.attachments.map((a) => a.name)).toEqual(["a.md"]);
  });

  it("does not park an empty draft", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.openDraft(MID);
    expect(Object.keys(h.store.stashedDrafts)).toEqual([]);
  });

  it("drops the parked copy when the draft is closed", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.setDraftText("待放弃");
    h.state.openDraft(MID);
    h.state.openDraft(TIP);
    h.state.dismissDraft();
    h.state.openDraft(TIP);
    expect(h.store.draft?.text).toBe("");
  });

  it("caps the parked drafts, evicting the oldest", async () => {
    const h = await bootState();
    // Fourteen distinct targets (u3 is the session tip, so it parks under
    // the tip key); the thirteenth park pushes the oldest one out past the
    // cap of twelve.
    for (let i = 1; i <= 14; i += 1) {
      h.state.openDraft(turnNode(`u${i}`));
      h.state.setDraftText(`草稿 ${i}`);
    }
    expect(Object.keys(h.store.stashedDrafts).length).toBe(12);
    // u1 was parked first and is the first to go.
    expect(h.store.stashedDrafts["s1:u1"]).toBeUndefined();
    // The newest survivors keep their text.
    expect(h.store.stashedDrafts["s1:u2"]?.text).toBe("草稿 2");
    expect(h.store.stashedDrafts["s1:*"]?.text).toBe("草稿 3");
    expect(h.store.stashedDrafts["s1:u13"]?.text).toBe("草稿 13");
    // Opening another target parks the active one (evicting the next
    // oldest, s1:u2); restoring u5's own parked text then takes its entry
    // back out of the stash, leaving eleven.
    h.state.openDraft(turnNode("u5"));
    expect(Object.keys(h.store.stashedDrafts).length).toBe(11);
    expect(h.store.stashedDrafts["s1:u2"]).toBeUndefined();
    expect(h.store.draft?.text).toBe("草稿 5");
  });
});

describe("inserting a path into the active draft", () => {
  it("appends the path on its own line at the draft's end", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.setDraftText("请看这个文件：");
    const result = h.state.insertDraftText("/demo/shop-api/docs/a.md");
    expect(result).toEqual({ ok: true });
    expect(h.store.draft?.text).toBe("请看这个文件：\n/demo/shop-api/docs/a.md\n");
  });

  it("reports no target when no draft is open", async () => {
    const h = await bootState();
    expect(h.state.insertDraftText("/x")).toEqual({ ok: false, reason: "no-draft" });
  });

  it("reports a send in flight instead of writing into it", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.setDraftText("正在发送");
    void h.state.sendDraft();
    expect(h.state.insertDraftText("/x")).toEqual({ ok: false, reason: "sending" });
    expect(h.store.draft?.text).toBe("正在发送");
  });
});

describe("composer persistence of parked drafts", () => {
  it("round-trips parked drafts through the sidecar", async () => {
    const first = await bootState();
    first.state.openDraft(TIP);
    first.state.setDraftText("重启后还要在");
    first.state.openDraft(MID);
    // The debounced flush writes the snapshot (active + parked).
    await vi.advanceTimersByTimeAsync(1000);
    const saved = first.saves.at(-1)?.value;
    expect(saved?.stashed?.["s1:*"]?.text).toBe("重启后还要在");

    const second = await bootState({ composer: saved ?? null });
    second.state.openDraft(TIP);
    expect(second.store.draft?.text).toBe("重启后还要在");
  });

  it("drops parked drafts whose session is gone on restore", async () => {
    const composer: PersistedComposer = {
      draft: null,
      stashed: {
        "s1:*": {
          sessionId: "s1",
          atMessageId: null,
          text: "在",
          model: null,
          attachments: [],
        },
        "s gone": {
          sessionId: "s-gone",
          atMessageId: null,
          text: "不在",
          model: null,
          attachments: [],
        },
      },
      paneModels: {},
      lastModel: null,
    };
    const h = await bootState({ composer });
    expect(Object.keys(h.store.stashedDrafts)).toEqual(["s1:*"]);
  });

  it("drops an empty parked draft on restore", async () => {
    const composer: PersistedComposer = {
      draft: null,
      stashed: {
        "s1:*": { sessionId: "s1", atMessageId: null, text: "   ", model: null, attachments: [] },
      },
      paneModels: {},
      lastModel: null,
    };
    const h = await bootState({ composer });
    expect(Object.keys(h.store.stashedDrafts)).toEqual([]);
  });
});

describe("sending", () => {
  it("does not resurrect the sent text on the next visit", async () => {
    const h = await bootState();
    h.state.openDraft(TIP);
    h.state.setDraftText("发出去的话");
    await h.state.sendDraft();
    expect(h.store.draft).toBeNull();
    h.state.openDraft(TIP);
    expect(h.store.draft?.text).toBe("");
  });
});
