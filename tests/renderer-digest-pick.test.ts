import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendEventEnvelope, BackendId } from "../src/shared/backend";
import type { DigestGroup } from "../src/shared/digest-types";
import type {
  AgentEvent,
  ChatMessage,
  ModelChoice,
  SessionSummary,
  TagStore,
} from "../src/shared/types";
import { createDiagnosticsMock } from "./helpers/diagnostics-mock";
import { createOverviewCacheMock, createOverviewLedgerMock } from "./helpers/overview-ledger-mock";

/**
 * The canvas digest pick (画布点选 → 事后总结): the ✦ card button's armed
 * selection and the digest it feeds. Against scripted IPC like the flow
 * test — this one drives the picks (armDigestPick / toggleDigestPick)
 * instead of the dialog's tab list, so the state machine and the
 * pick→startDigest hand-off are what get pinned here.
 */

function root(id: string, title: string): SessionSummary {
  return {
    id,
    title,
    directory: "/demo/project",
    parentSessionId: null,
    origin: "root",
    createdAt: 1,
    updatedAt: 1,
  };
}

const ROOT_A = root("sesA", "故事甲");
const ROOT_B = root("sesB", "故事乙");
const ROOT_C = root("sesC", "故事丙");
const ROOT_D = root("sesD", "故事丁");
const ROOT_E = root("sesE", "故事戊");
/** A story with no turns at all: the digest's "nothing to summarize" path. */
const ROOT_F = root("sesF", "故事空");
const ROOTS = [ROOT_A, ROOT_B, ROOT_C, ROOT_D, ROOT_E, ROOT_F];

function row(
  id: string,
  role: "user" | "assistant",
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role,
    text,
    thinking: "",
    toolNames: [],
    modelId: null,
    providerId: null,
    variant: null,
    attachmentNames: [],
    createdAt: 2,
    completedAt: role === "assistant" ? 3 : null,
    finish: role === "assistant" ? "stop" : null,
    outputTokens: null,
    error: null,
    ...extra,
  };
}

/** Real state singleton with scripted IPC; the digest sidecar is a spy. */
async function bootState() {
  vi.resetModules();
  let handler: ((event: BackendEventEnvelope) => void) | undefined;
  const histories = new Map<string, ChatMessage[]>();
  const sessions: SessionSummary[] = [...ROOTS];
  const key = (backend: BackendId, id: string) => `${backend}:${id}`;
  // Stories A and B carry two turns each; C–E one; F none.
  histories.set(key("codex", ROOT_A.id), [
    row("a-u1", "user", "甲的第一个问题"),
    row("a-a1", "assistant", "甲的第一个回答"),
    row("a-u2", "user", "甲的第二个问题"),
    row("a-a2", "assistant", "甲的第二个回答"),
  ]);
  histories.set(key("codex", ROOT_B.id), [
    row("b-u1", "user", "乙的第一个问题"),
    row("b-a1", "assistant", "乙的第一个回答"),
    row("b-u2", "user", "乙的第二个问题"),
    row("b-a2", "assistant", "乙的第二个回答"),
  ]);
  for (const session of [ROOT_C, ROOT_D, ROOT_E]) {
    histories.set(key("codex", session.id), [
      row(`${session.id}-u1`, "user", `${session.title}的问题`),
      row(`${session.id}-a1`, "assistant", `${session.title}的回答`),
    ]);
  }
  const heldPrompts: Array<() => void> = [];
  let pendingHold = false;
  const fork = vi.fn(async (backend: BackendId, id: string, _atMessageId: string | null) => {
    const forked: SessionSummary = {
      ...(sessions.find((session) => session.id === id) ?? ROOT_A),
      id: `fork-${sessions.length + 1}`,
      parentSessionId: id,
      origin: "fork",
    };
    sessions.push(forked);
    histories.set(key(backend, forked.id), []);
    return forked;
  });
  const prompt = vi.fn(
    async (backend: BackendId, id: string, text: string, _model: ModelChoice | null) => {
      const history = histories.get(key(backend, id)) ?? [];
      const land = () =>
        histories.set(key(backend, id), [...history, row(`u-${id}`, "user", text)]);
      if (pendingHold) {
        await new Promise<void>((resolve) => {
          heldPrompts.push(() => {
            land();
            resolve();
          });
        });
      } else {
        land();
      }
    },
  );
  const digestsSave = vi.fn(async (group: DigestGroup) => {
    void structuredClone(group);
    return true;
  });
  const api = {
    ready: async () => ({ ok: true }),
    sessions: async () => ({ sessions: [...sessions], lineage: {} }),
    messages: async (backend: BackendId, id: string) =>
      structuredClone(histories.get(key(backend, id)) ?? []),
    models: async () => [],
    messageAttachments: async () => [],
    createSession: async () => ROOT_A,
    fork,
    prompt,
    deleteSession: async () => [],
    deleteMessage: async () => {},
    abort: async () => {},
    respondInteraction: async () => {},
    renameSession: vi.fn(async () => {}),
    openSessionTerminal: async () => ({ ok: true }),
    tags: async (): Promise<TagStore> => ({ sessions: {}, colors: {}, forkPref: {} }),
    setSessionTags: async (): Promise<TagStore> => ({ sessions: {}, colors: {}, forkPref: {} }),
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
        { id: "opencode", label: "opencode", installed: true, version: null, versionWarning: null },
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
      currentVersion: "0.5.4",
      latest: null,
      updateAvailable: false,
    }),
    skipUpdate: async () => ({ ok: true }),
    openRelease: async () => ({ ok: true }),
    fileChanges: async () => null,
    fileChangeDiff: async () => null,
    onEvent: (listener: (event: BackendEventEnvelope) => void) => {
      handler = listener;
      return () => {};
    },
    digestsList: async () => [],
    digestsSave,
    ...createOverviewLedgerMock(),
    ...createOverviewCacheMock(),
    ...createDiagnosticsMock(),
  } as unknown as AweforkApi;
  (globalThis as unknown as { window: { awefork: AweforkApi } }).window = { awefork: api };
  const state = await import("../src/renderer/src/state");
  // The same fresh settings singleton state.ts sees — a static import would
  // hold the pre-reset module after vi.resetModules().
  const { settings } = await import("../src/renderer/src/settings");
  await state.init();
  return {
    state,
    settings,
    store: state.store,
    fork,
    prompt,
    digestsSave,
    histories,
    key,
    emit: (event: AgentEvent, backend: BackendId = "codex") => handler?.({ backend, event }),
    append(id: string, answer: ChatMessage) {
      const k = key("codex", id);
      histories.set(k, [...(histories.get(k) ?? []), answer]);
    },
    holdPrompts: () => {
      pendingHold = true;
    },
    releasePrompts: () => {
      const held = [...heldPrompts];
      heldPrompts.length = 0;
      pendingHold = false;
      for (const release of held) release();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("canvas digest picks", () => {
  it("arms with the clicked card's story and records the clicked turn", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_A.id, `${ROOT_A.id}:a-u1`);
    expect(h.store.digestPicks).toEqual([
      {
        storyRootId: ROOT_A.id,
        sessionId: ROOT_A.id,
        selectedTurnId: `${ROOT_A.id}:a-u1`,
        title: "故事甲",
      },
    ]);
    // A tip card (no turn) still picks its story; the scope decides what
    // the turn-less pick contributes.
    h.state.armDigestPick(ROOT_B.id, null);
    expect(h.store.digestPicks.map((pick) => pick.sessionId)).toEqual([ROOT_A.id, ROOT_B.id]);
    expect(h.store.digestPicks[1]?.selectedTurnId).toBeNull();
  });

  it("keeps the pick order and refuses a story already picked", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_A.id, null);
    h.state.armDigestPick(ROOT_B.id, null);
    h.state.armDigestPick(ROOT_A.id, `${ROOT_A.id}:a-u2`);
    expect(h.store.digestPicks.map((pick) => pick.storyRootId)).toEqual([ROOT_A.id, ROOT_B.id]);
    // The first pick stands: re-arming neither duplicates nor reorders.
    expect(h.store.digestPicks[0]?.selectedTurnId).toBeNull();
  });

  it("caps the selection at four stories and says so", async () => {
    const h = await bootState();
    for (const session of [ROOT_A, ROOT_B, ROOT_C, ROOT_D]) {
      h.state.armDigestPick(session.id, null);
    }
    h.state.armDigestPick(ROOT_E.id, null);
    expect(h.store.digestPicks).toHaveLength(4);
    expect(h.store.digestPicks.map((pick) => pick.sessionId)).not.toContain(ROOT_E.id);
    expect(h.store.actionError).toContain("4");
  });

  it("toggles a story out; removing the last one disarms", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_A.id, null);
    h.state.armDigestPick(ROOT_B.id, null);
    h.state.toggleDigestPick(ROOT_A.id, null);
    expect(h.store.digestPicks.map((pick) => pick.sessionId)).toEqual([ROOT_B.id]);
    // Toggling an unpicked story back in is the same handler's other half.
    h.state.toggleDigestPick(ROOT_C.id, null);
    expect(h.store.digestPicks.map((pick) => pick.sessionId)).toEqual([ROOT_B.id, ROOT_C.id]);
    h.state.toggleDigestPick(ROOT_B.id, null);
    h.state.toggleDigestPick(ROOT_C.id, null);
    expect(h.store.digestPicks).toEqual([]);
  });

  it("reports each card's story position, 0 when unpicked", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_A.id, null);
    h.state.armDigestPick(ROOT_B.id, null);
    expect(h.state.digestPickOrderOf(ROOT_A.id)).toBe(1);
    expect(h.state.digestPickOrderOf(ROOT_B.id)).toBe(2);
    expect(h.state.digestPickOrderOf(ROOT_C.id)).toBe(0);
    // A session the window does not know has no position either.
    expect(h.state.digestPickOrderOf("ses-nope")).toBe(0);
  });

  it("clears the whole selection on cancel", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_A.id, null);
    h.state.armDigestPick(ROOT_B.id, null);
    h.state.cancelDigestPicks();
    expect(h.store.digestPicks).toEqual([]);
  });

  it("drops the armed selection when the digest switch is turned off", async () => {
    const h = await bootState();
    // The labs master switch first: the digest's gate is the two of them.
    h.settings.labs.parallelModels = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.digestEnabled.value).toBe(true);
    h.state.armDigestPick(ROOT_A.id, null);
    h.state.armDigestPick(ROOT_B.id, null);
    expect(h.store.digestPicks).toHaveLength(2);
    // The switch is the opt-out row under the multi-model settings; a
    // selection the entries can no longer act on must not linger.
    h.settings.labs.parallel.digest = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.digestPicks).toEqual([]);
    // The labs master switch covers it too.
    h.settings.labs.parallel.digest = true;
    await vi.advanceTimersByTimeAsync(0);
    h.state.armDigestPick(ROOT_A.id, null);
    h.settings.labs.parallelModels = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.digestPicks).toEqual([]);
  });

  it("starts the digest from the picks: fork at the first story's clicked turn", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_A.id, `${ROOT_A.id}:a-u1`);
    h.state.armDigestPick(ROOT_B.id, null);
    h.holdPrompts();
    const done = h.state.startDigest({
      stories: h.store.digestPicks.map((pick) => ({ ...pick })),
      scope: "story",
      model: null,
      length: "brief",
    });
    await vi.advanceTimersByTimeAsync(5);
    h.releasePrompts();
    // The fork is cut at the clicked turn, on the first story — the pick
    // order is the digest order.
    expect(h.fork).toHaveBeenCalledWith("codex", ROOT_A.id, "a-u1", { context: "none" });
    // The selection is consumed: the canvas returns to normal clicking.
    expect(h.store.digestPicks).toEqual([]);
    const group = h.state.digestGroups.at(-1);
    const summaryId = group?.summarySessionId ?? "";
    expect(summaryId).not.toBe("");
    expect(group?.sources.map((source) => source.title)).toEqual(["故事甲", "故事乙"]);
    h.append(summaryId, row(`ans-${summaryId}`, "assistant", "画布点选总结完成"));
    h.emit({ type: "session.idle", sessionId: summaryId });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await done).toBe(true);
    expect(group?.status).toBe("done");
    expect(group?.text).toBe("画布点选总结完成");
    const sent = String(h.prompt.mock.calls.at(-1)?.[2]);
    expect(sent).toContain("【1 · 故事甲】");
    expect(sent).toContain("【2 · 故事乙】");
  });

  it("fails with the reason when no picked story has turns", async () => {
    const h = await bootState();
    h.state.armDigestPick(ROOT_F.id, null);
    const ok = await h.state.startDigest({
      stories: h.store.digestPicks.map((pick) => ({ ...pick })),
      scope: "story",
      model: null,
      length: "brief",
    });
    expect(ok).toBe(false);
    expect(h.store.actionError).toContain("故事空");
    expect(h.fork).not.toHaveBeenCalled();
    // A refused digest leaves the selection armed — the user can pick more
    // and try again without re-doing the whole selection.
    expect(h.store.digestPicks).toHaveLength(1);
  });
});
