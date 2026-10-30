import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexHome } from "../src/main/codex-homes.js";
import { createCodexMultiHomeAdapter } from "../src/main/codex-multihome.js";
import { recordFork } from "../src/shared/lineage-store.js";
import type { AgentAdapter, AgentEvent } from "../src/shared/types.js";

const tempDirs: string[] = [];
type Mock = ReturnType<typeof vi.fn>;
type FakeHomeAdapter = AgentAdapter & {
  listSessions: Mock;
  messages: Mock;
  createSession: Mock;
  fork: Mock;
  exportSession: Mock;
  deleteSession: Mock;
  prompt: Mock;
  respondInteraction: Mock;
  subscribe: Mock;
};

function makeDir(): string {
  const dir = join(tmpdir(), `awefork-mh-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** In-memory per-home adapter recording which calls it received. */
function fakeHomeAdapter(
  home: CodexHome,
  sessions: string[],
  updatedAt: Record<string, number> = {},
): FakeHomeAdapter {
  const adapter = {
    kind: "codex",
    listSessions: vi
      .fn()
      .mockResolvedValue(
        sessions.map((id) => makeSummary(id, updatedAt[id] ?? (home.id === "default" ? 200 : 100))),
      ),
    messages: vi.fn().mockResolvedValue([]),
    messageAttachments: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    fork: vi.fn().mockResolvedValue(makeSummary("forked", 100)),
    exportSession: vi.fn().mockResolvedValue(makeSummary("exported", 100)),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    respondInteraction: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(() => {}),
    dispose: vi.fn(),
  };
  return adapter as unknown as FakeHomeAdapter;
}

function homeAdapter(byHome: Map<string, FakeHomeAdapter>, id: string): FakeHomeAdapter {
  const adapter = byHome.get(id);
  if (!adapter) throw new Error(`no fake adapter for home "${id}"`);
  return adapter;
}

/** A RolloutSession-shaped record for the facade's disk fallback. */
function rolloutRow(id: string, parentId: string | null, updatedAt: number) {
  return {
    sessionId: id,
    parentId,
    listed: true,
    cwd: "/repo",
    title: null,
    createdAt: 1,
    updatedAt,
  };
}

function makeSummary(
  id: string,
  updatedAt: number,
): {
  id: string;
  title: string;
  directory: string;
  parentSessionId: null;
  origin: "root";
  createdAt: number;
  updatedAt: number;
} {
  return {
    id,
    title: `session ${id}`,
    directory: "/tmp",
    parentSessionId: null,
    origin: "root",
    createdAt: 1,
    updatedAt,
  };
}

interface Harness {
  facade: AgentAdapter;
  byHome: Map<string, FakeHomeAdapter>;
  lineagePath: string;
}

function makeFacade(
  homeSessions: Record<string, string[]>,
  overrides: Partial<Parameters<typeof createCodexMultiHomeAdapter>[0]> = {},
  updatedAt: Record<string, Record<string, number>> = {},
): Harness {
  const homes: CodexHome[] = Object.keys(homeSessions).map((id) => ({
    id,
    path: join("/homes", id),
    label: id,
  }));
  const byHome = new Map<string, FakeHomeAdapter>(
    homes.map((home) => [
      home.id,
      fakeHomeAdapter(home, homeSessions[home.id] ?? [], updatedAt[home.id]),
    ]),
  );
  const lineagePath = join(makeDir(), "lineage.json");
  const facade = createCodexMultiHomeAdapter({
    lineagePath,
    homes: () => homes,
    createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
    defaultHomePath: () => "/homes/default",
    ...overrides,
  });
  return { facade, byHome, lineagePath };
}

describe("codex multi-home facade", () => {
  it("merges sessions from every home, default home winning id collisions", async () => {
    const { facade } = makeFacade({
      default: ["shared", "own"],
      cxo: ["foreign"],
    });
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id).sort()).toEqual(["foreign", "own", "shared"]);
    // The duplicate from the foreign home is dropped, not double-listed.
    expect(sessions).toHaveLength(3);
  });

  it("sorts the merged list by updatedAt descending", async () => {
    // A foreign session newer than every default-home one must still land on
    // top — the merge is not default-first.
    const { facade } = makeFacade({ default: ["old"], cxo: ["new"] }, {}, { cxo: { new: 300 } });
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("keeps a colliding id owned by the default home even when its fetch lands last", async () => {
    // Dedupe must follow homes order, not fetch-completion order: a foreign
    // home that answers first would otherwise claim the shared id (an
    // imported rollout keeps the id in both homes) and route reads to its
    // staler copy.
    const homes: CodexHome[] = [
      { id: "default", path: "/homes/default", label: "Codex" },
      { id: "cxo", path: "/homes/cxo", label: "cxo" },
    ];
    const slowDefault = fakeHomeAdapter(homes[0], []);
    (slowDefault.listSessions as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [{ ...makeSummary("shared", 200), title: "default copy" }];
    });
    const foreign = fakeHomeAdapter(homes[1], []);
    (foreign.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...makeSummary("shared", 100), title: "foreign copy" },
    ]);
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", slowDefault],
      ["cxo", foreign],
    ]);
    const facade = createCodexMultiHomeAdapter({
      lineagePath: join(makeDir(), "lineage.json"),
      homes: () => homes,
      createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
      defaultHomePath: () => "/homes/default",
    });
    const sessions = await facade.listSessions();
    expect(sessions.find((s) => s.id === "shared")?.title).toBe("default copy");
    await facade.messages("shared");
    expect(homeAdapter(byHome, "default").messages).toHaveBeenCalledWith("shared");
    expect(homeAdapter(byHome, "cxo").messages).not.toHaveBeenCalled();
  });

  it("does not drop a foreign home's later sessions after an id collision", async () => {
    // A duplicate id must skip only its own row, not end the home's loop. The
    // foreign home answers last, so its duplicate is mid-list when it lands.
    const homes: CodexHome[] = [
      { id: "default", path: "/homes/default", label: "Codex" },
      { id: "cxo", path: "/homes/cxo", label: "cxo" },
    ];
    const foreign = fakeHomeAdapter(homes[1], []);
    (foreign.listSessions as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [makeSummary("shared", 100), makeSummary("other", 100)];
    });
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], ["shared"])],
      ["cxo", foreign],
    ]);
    const facade = createCodexMultiHomeAdapter({
      lineagePath: join(makeDir(), "lineage.json"),
      homes: () => homes,
      createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
      defaultHomePath: () => "/homes/default",
    });
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id).sort()).toEqual(["other", "shared"]);
  });

  it("keeps a created session listed until thread/list carries it", async () => {
    // codex 0.154 lists only threads that wrote a turn of their own, so a
    // fresh thread/start is invisible to every listSessions until its first
    // prompt — without the memo the renderer could never select the session
    // it just made.
    let serverListsFresh = false;
    const { facade, byHome } = makeFacade({ default: [] });
    (homeAdapter(byHome, "default").listSessions as ReturnType<typeof vi.fn>).mockImplementation(
      async () => (serverListsFresh ? [makeSummary("fresh", 300)] : [makeSummary("older", 100)]),
    );
    (homeAdapter(byHome, "default").createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSummary("fresh", 200),
    );

    await facade.createSession("/repo");
    const before = await facade.listSessions();
    expect(before.map((s) => s.id)).toEqual(["fresh", "older"]);

    // The first own turn lands: the server now lists the id, so the memo row
    // retires instead of duplicating.
    serverListsFresh = true;
    const after = await facade.listSessions();
    expect(after.filter((s) => s.id === "fresh")).toHaveLength(1);
    expect(after.find((s) => s.id === "fresh")?.updatedAt).toBe(300);
  });

  it("keeps a just-cut fork listed before its first own turn", async () => {
    const { facade, byHome } = makeFacade({ default: ["parent"] });
    (homeAdapter(byHome, "default").fork as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeSummary("fork-1", 300),
      origin: "fork",
      parentSessionId: "parent",
    });
    const forked = await facade.fork("parent", null);
    expect(forked).toMatchObject({ id: "fork-1", origin: "fork", parentSessionId: "parent" });
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["fork-1", "parent"]);
  });

  it("lists a rollout the server's listing dropped, so a story stays whole", async () => {
    // codex 0.165's thread/list is index-backed and can lag the rollouts for
    // hours (verified: 282 of 418 on-disk threads missing, settled turns
    // included, while thread/read stayed correct). A story's root dropping
    // out of the listing is what tore the user's canvas tabs apart, so the
    // facade merges disk rows for what the listing lacks.
    const { facade } = makeFacade(
      { default: ["fork-1"] },
      {
        rolloutSessions: async () => [
          rolloutRow("disk-root", null, 150),
          rolloutRow("disk-fork", "disk-root", 180),
        ],
      },
    );
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id).sort()).toEqual(["disk-fork", "disk-root", "fork-1"]);
    const diskRoot = sessions.find((s) => s.id === "disk-root");
    expect(diskRoot).toMatchObject({ parentSessionId: null, origin: "root" });
    // The disk row carries its recorded parent, so a fork the listing missed
    // still nests under the root the listing missed.
    expect(sessions.find((s) => s.id === "disk-fork")).toMatchObject({
      parentSessionId: "disk-root",
      origin: "fork",
    });
    // The server's own row wins whenever it exists — the disk is a fallback.
    expect(sessions.find((s) => s.id === "fork-1")?.updatedAt).toBe(200);
  });

  it("does not let a disk row override the server's own row", async () => {
    const { facade } = makeFacade(
      { default: ["listed-1"] },
      { rolloutSessions: async () => [rolloutRow("listed-1", null, 999)] },
    );
    const sessions = await facade.listSessions();
    expect(sessions.filter((s) => s.id === "listed-1")).toHaveLength(1);
    expect(sessions.find((s) => s.id === "listed-1")?.updatedAt).toBe(200);
  });

  it("skips subagent rollouts in the disk fallback", async () => {
    // The rollout scan marks subagent/guardian files (source is an object),
    // and the facade must drop them: a listing never carries them, and every
    // awefork view hides them by design.
    const { facade } = makeFacade(
      { default: [] },
      {
        rolloutSessions: async () => [
          { ...rolloutRow("sub-1", "parent", 100), listed: false },
          rolloutRow("plain", null, 100),
        ],
      },
    );
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["plain"]);
  });

  it("keeps the listing usable when the rollout scan fails", async () => {
    const { facade } = makeFacade(
      { default: ["own"] },
      {
        rolloutSessions: async () => {
          throw new Error("home unreadable");
        },
      },
    );
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["own"]);
  });

  it("keeps a just-exported copy listed before its first own turn", async () => {
    // An export cuts the same copy a fork does, so thread/list omits it
    // until its first own turn. Without the memo row the renderer's
    // selectSession would find no such session and silently no-op — the
    // export would look like nothing happened at all.
    const { facade, byHome } = makeFacade({ default: ["parent"] });
    (homeAdapter(byHome, "default").exportSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...makeSummary("exported-1", 300),
      origin: "root",
      parentSessionId: null,
    });
    const exported = await facade.exportSession("parent", null);
    expect(exported).toMatchObject({ id: "exported-1", origin: "root", parentSessionId: null });
    expect(homeAdapter(byHome, "default").exportSession).toHaveBeenCalledWith("parent", null);
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["exported-1", "parent"]);
  });

  it("retires an exported copy's memo row once the server lists it", async () => {
    let serverListsExport = false;
    const { facade, byHome } = makeFacade({ default: ["parent"] });
    (homeAdapter(byHome, "default").listSessions as ReturnType<typeof vi.fn>).mockImplementation(
      async () =>
        serverListsExport
          ? [makeSummary("exported-1", 400), makeSummary("parent", 100)]
          : [makeSummary("parent", 100)],
    );
    (homeAdapter(byHome, "default").exportSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSummary("exported-1", 300),
    );
    await facade.exportSession("parent", null);
    serverListsExport = true;
    const sessions = await facade.listSessions();
    expect(sessions.filter((s) => s.id === "exported-1")).toHaveLength(1);
    expect(sessions.find((s) => s.id === "exported-1")?.updatedAt).toBe(400);
  });

  it("drops the memo row when the session is deleted before the server lists it", async () => {
    const { facade, byHome } = makeFacade({ default: [] });
    (homeAdapter(byHome, "default").createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSummary("fresh", 200),
    );
    await facade.createSession("/repo");
    await facade.deleteSession("fresh");
    expect(await facade.listSessions()).toEqual([]);
  });

  it("still lists the default home when a foreign home cannot spawn", async () => {
    const homes: CodexHome[] = [
      { id: "default", path: "/homes/default", label: "Codex" },
      { id: "broken", path: "/homes/broken", label: "broken" },
    ];
    const defaultAdapter = fakeHomeAdapter(homes[0], ["own"]);
    const facade = createCodexMultiHomeAdapter({
      lineagePath: "/tmp/lineage.json",
      homes: () => homes,
      createHomeAdapter: (home) =>
        home.id === "broken"
          ? Promise.reject(new Error("spawn failed"))
          : Promise.resolve(defaultAdapter),
      defaultHomePath: () => "/homes/default",
    });
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["own"]);
  });

  it("still lists the default home when a foreign home's listing fails", async () => {
    // A wedged account app-server (or a thread/list that outlives the request
    // deadline) fails the fetch, not just the spawn: the whole backend must
    // not read as disconnected over one foreign account.
    const homes: CodexHome[] = [
      { id: "default", path: "/homes/default", label: "Codex" },
      { id: "wedged", path: "/homes/wedged", label: "wedged" },
    ];
    const defaultAdapter = fakeHomeAdapter(homes[0], ["own"]);
    const wedged = fakeHomeAdapter(homes[1], []);
    wedged.listSessions.mockRejectedValue(new Error("thread/list timed out after 60000ms"));
    const facade = createCodexMultiHomeAdapter({
      lineagePath: "/tmp/lineage.json",
      homes: () => homes,
      createHomeAdapter: (home) =>
        home.id === "wedged" ? Promise.resolve(wedged) : Promise.resolve(defaultAdapter),
      defaultHomePath: () => "/homes/default",
    });
    const sessions = await facade.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["own"]);
  });

  it("reads a foreign session through its own home", async () => {
    const { facade, byHome } = makeFacade({ default: [], cxo: ["foreign"] });
    await facade.listSessions();
    await facade.messages("foreign");
    expect(homeAdapter(byHome, "cxo").messages).toHaveBeenCalledWith("foreign");
    expect(homeAdapter(byHome, "default").messages).not.toHaveBeenCalled();
  });

  it("continues a foreign session on the default account by importing its rollout", async () => {
    const foreignHome = makeDir();
    const defaultHome = makeDir();
    const threadId = "01a08d8f-4862-7093-98da-e763eb8024af";
    const rel = join("sessions", "2026", "09", "11");
    mkdirSync(join(foreignHome, rel), { recursive: true });
    writeFileSync(join(foreignHome, rel, `rollout-2026-09-11T07-02-52-${threadId}.jsonl`), "{}\n");

    const homes: CodexHome[] = [
      { id: "default", path: defaultHome, label: "Codex" },
      { id: "cxo", path: foreignHome, label: "cxo" },
    ];
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], [])],
      ["cxo", fakeHomeAdapter(homes[1], [threadId])],
    ]);
    const { facade } = makeFacade(
      { default: [], cxo: [threadId] },
      {
        homes: () => homes,
        createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
        defaultHomePath: () => defaultHome,
      },
    );
    await facade.listSessions();
    await facade.prompt(threadId, "继续", null);

    // The rollout landed in the default home and the turn ran there.
    expect(
      existsSync(join(defaultHome, rel, `rollout-2026-09-11T07-02-52-${threadId}.jsonl`)),
    ).toBe(true);
    expect(homeAdapter(byHome, "default").prompt.mock.calls[0]?.slice(0, 3)).toEqual([
      threadId,
      "继续",
      null,
    ]);
    expect(homeAdapter(byHome, "cxo").prompt).not.toHaveBeenCalled();

    // The session now routes to the default home for everything else.
    await facade.messages(threadId);
    expect(homeAdapter(byHome, "default").messages).toHaveBeenCalledWith(threadId);
  });

  it("does not import when continuing a default-home session", async () => {
    const defaultHome = makeDir();
    const homes: CodexHome[] = [{ id: "default", path: defaultHome, label: "Codex" }];
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], ["own"])],
    ]);
    const { facade } = makeFacade(
      { default: ["own"] },
      {
        homes: () => homes,
        createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
        defaultHomePath: () => defaultHome,
      },
    );
    await facade.listSessions();
    await facade.prompt("own", "hi", null);
    expect(homeAdapter(byHome, "default").prompt).toHaveBeenCalled();
  });

  it("forks a foreign session under the default account too", async () => {
    const foreignHome = makeDir();
    const defaultHome = makeDir();
    const threadId = "01a08d8f-fork-test";
    const rel = join("sessions", "2026", "09", "11");
    mkdirSync(join(foreignHome, rel), { recursive: true });
    writeFileSync(join(foreignHome, rel, `rollout-${threadId}.jsonl`), "{}\n");

    const homes: CodexHome[] = [
      { id: "default", path: defaultHome, label: "Codex" },
      { id: "cxo", path: foreignHome, label: "cxo" },
    ];
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], [])],
      ["cxo", fakeHomeAdapter(homes[1], [threadId])],
    ]);
    const { facade } = makeFacade(
      { default: [], cxo: [threadId] },
      {
        homes: () => homes,
        createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
        defaultHomePath: () => defaultHome,
      },
    );
    await facade.listSessions();
    await facade.fork(threadId, null);

    // Third arg is the (absent here) fork options the facade forwards.
    expect(homeAdapter(byHome, "default").fork).toHaveBeenCalledWith(threadId, null, undefined);
    expect(existsSync(join(defaultHome, rel, `rollout-${threadId}.jsonl`))).toBe(true);
  });

  it("continues a foreign empty-context fork in its own home without importing a rollout", async () => {
    const { facade, byHome, lineagePath } = makeFacade({ default: [], cxo: ["parent"] });
    await facade.listSessions();
    const foreign = homeAdapter(byHome, "cxo");
    foreign.fork.mockResolvedValue({
      ...makeSummary("forked-empty", 300),
      origin: "fork",
      parentSessionId: "parent",
    });

    const forked = await facade.fork("parent", "turn", { context: "none" });
    // The fake fork does not write lineage itself; the real adapter records
    // context: none before returning, so mirror that here.
    await recordFork(lineagePath, "forked-empty", {
      parentId: "parent",
      atMessageId: "turn",
      createdAt: 1,
      context: "none",
    });
    await facade.prompt(forked.id, "第一条消息", null);

    expect(foreign.prompt.mock.calls[0]?.slice(0, 3)).toEqual(["forked-empty", "第一条消息", null]);
    expect(homeAdapter(byHome, "default").prompt).not.toHaveBeenCalled();
  });

  it("deletes an imported session's account-home original too, so it stays deleted", async () => {
    // Regression: deleteSession only hit the owning (default) home, so the
    // aweswitch account home's original rollout re-listed the session on
    // the next refresh — a deleted session that came back.
    const foreignHome = makeDir();
    const defaultHome = makeDir();
    const threadId = "01a08d8f-del-test";
    const rel = join("sessions", "2026", "09", "11");
    for (const base of [foreignHome, defaultHome]) {
      mkdirSync(join(base, rel), { recursive: true });
      writeFileSync(join(base, rel, `rollout-${threadId}.jsonl`), "{}\n");
    }
    const homes: CodexHome[] = [
      { id: "default", path: defaultHome, label: "Codex" },
      { id: "cxo", path: foreignHome, label: "cxo" },
    ];
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], [threadId])],
      ["cxo", fakeHomeAdapter(homes[1], [threadId])],
    ]);
    // thread/delete removes that home's rollout file, like the real server.
    for (const [id, adapter] of byHome) {
      const base = id === "default" ? defaultHome : foreignHome;
      adapter.deleteSession.mockImplementation(async (sessionId: string) => {
        rmSync(join(base, rel, `rollout-${sessionId}.jsonl`));
      });
    }
    const { facade } = makeFacade(
      { default: [threadId], cxo: [threadId] },
      {
        homes: () => homes,
        createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
        defaultHomePath: () => defaultHome,
      },
    );
    await facade.listSessions(); // default wins the collision, owns the id
    await facade.deleteSession(threadId);

    expect(homeAdapter(byHome, "default").deleteSession).toHaveBeenCalledWith(threadId);
    expect(homeAdapter(byHome, "cxo").deleteSession).toHaveBeenCalledWith(threadId);
    expect(existsSync(join(defaultHome, rel, `rollout-${threadId}.jsonl`))).toBe(false);
    expect(existsSync(join(foreignHome, rel, `rollout-${threadId}.jsonl`))).toBe(false);
  });

  it("keeps the delete successful when a copy in another home cannot be removed", async () => {
    const foreignHome = makeDir();
    const defaultHome = makeDir();
    const threadId = "01a08d8f-del-fail";
    const rel = join("sessions", "2026", "09", "11");
    mkdirSync(join(foreignHome, rel), { recursive: true });
    writeFileSync(join(foreignHome, rel, `rollout-${threadId}.jsonl`), "{}\n");
    const homes: CodexHome[] = [
      { id: "default", path: defaultHome, label: "Codex" },
      { id: "cxo", path: foreignHome, label: "cxo" },
    ];
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], [threadId])],
      ["cxo", fakeHomeAdapter(homes[1], [])],
    ]);
    homeAdapter(byHome, "cxo").deleteSession.mockRejectedValue(new Error("spawn failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { facade } = makeFacade(
      { default: [threadId], cxo: [] },
      {
        homes: () => homes,
        createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
        defaultHomePath: () => defaultHome,
      },
    );
    try {
      await facade.listSessions();
      await expect(facade.deleteSession(threadId)).resolves.toBeUndefined();
      expect(homeAdapter(byHome, "default").deleteSession).toHaveBeenCalledWith(threadId);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("re-mints interaction request ids so replies reach the right home", async () => {
    const homes: CodexHome[] = [
      { id: "default", path: "/homes/default", label: "Codex" },
      { id: "cxo", path: "/homes/cxo", label: "cxo" },
    ];
    const byHome = new Map<string, FakeHomeAdapter>([
      ["default", fakeHomeAdapter(homes[0], [])],
      ["cxo", fakeHomeAdapter(homes[1], ["foreign"])],
    ]);
    const { facade } = makeFacade(
      { default: [], cxo: ["foreign"] },
      {
        homes: () => homes,
        createHomeAdapter: (home) => Promise.resolve(homeAdapter(byHome, home.id)),
      },
    );
    await facade.listSessions();

    // Both homes mint the same inner id "codex-interaction-1"; the facade
    // must hand out distinct outer ids.
    const events: AgentEvent[] = [];
    await facade.subscribe((event) => events.push(event));
    for (const id of ["default", "cxo"]) {
      const adapter = byHome.get(id) as unknown as {
        subscribe: ReturnType<typeof vi.fn>;
      };
      const handler = adapter.subscribe.mock.calls[0][0] as (event: AgentEvent) => void;
      handler({
        type: "interaction.requested",
        request: {
          requestId: "codex-interaction-1",
          sessionId: null,
          kind: "command-approval",
          title: "t",
          detail: "d",
          command: "ls",
        },
      });
    }
    const requestIds = events
      .filter((e) => e.type === "interaction.requested")
      .map((e) => (e.request as { requestId: string }).requestId);
    expect(new Set(requestIds).size).toBe(2);

    await facade.respondInteraction(requestIds[1], { decision: "allow" });
    expect(homeAdapter(byHome, "cxo").respondInteraction).toHaveBeenCalledWith(
      "codex-interaction-1",
      {
        decision: "allow",
      },
    );
    expect(homeAdapter(byHome, "default").respondInteraction).not.toHaveBeenCalled();
  });

  it("delivers events again after a re-subscribe", async () => {
    // Regression: unsubscribe used to tear down the cached home adapters'
    // subscriptions, and a later subscribe only swapped the sink — the
    // cached adapters kept their handlers detached, so every event after a
    // resubscribe was silently dropped.
    const { facade, byHome } = makeFacade({ default: ["own"] });
    await facade.listSessions();
    const first: AgentEvent[] = [];
    const unsubscribe = await facade.subscribe((event) => first.push(event));
    const adapter = byHome.get("default") as unknown as {
      subscribe: ReturnType<typeof vi.fn>;
    };
    const handler = adapter.subscribe.mock.calls[0][0] as (event: AgentEvent) => void;
    handler({ type: "session.updated", sessionId: "own" });
    unsubscribe();

    const second: AgentEvent[] = [];
    await facade.subscribe((event) => second.push(event));
    handler({ type: "session.updated", sessionId: "own" });

    expect(first).toHaveLength(1);
    expect(second).toEqual([{ type: "session.updated", sessionId: "own" }]);
  });
});
