import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPiAdapter,
  type PiAdapterNodeSeams,
  type PiRpcProcess,
} from "../src/shared/pi-adapter";
import type { AgentEvent } from "../src/shared/types";

/**
 * pi session fixtures per the store's discovery grammar: each file sits one
 * level under a per-cwd directory and is named `<timestamp>_<id>.jsonl`. These
 * tests let `listSessionFiles`/`readSessionFile` hit the real files on disk,
 * and fake every process seam — a test spawns no `pi` child.
 */
const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/pi-sessions/--Users-a-b--", import.meta.url));

/** Fixture id → absolute path, so the seams can hand the adapter real files. */
const FIXTURES: Record<string, string> = {
  "s5-fork": join(
    FIXTURE_DIR,
    "2026-07-01T12-00-00-000Z_55c53b20-97e4-4f30-9a3f-0000000000a1.jsonl",
  ),
  "s1-mixed": join(
    FIXTURE_DIR,
    "2026-06-01T09-00-00-000Z_55c53b20-97e4-4f30-9a3f-0000000000b2.jsonl",
  ),
  "s2-branch": join(
    FIXTURE_DIR,
    "2026-05-02T08-01-00-000Z_55c53b20-97e4-4f30-9a3f-0000000000c3.jsonl",
  ),
  "s3-orphan": join(
    FIXTURE_DIR,
    "2026-04-03T08-01-00-000Z_55c53b20-97e4-4f30-9a3f-0000000000d4.jsonl",
  ),
  "s4-late": join(
    FIXTURE_DIR,
    "2026-07-20T09-00-20-000Z_55c53b20-97e4-4f30-9a3f-0000000000e5.jsonl",
  ),
};

interface RpcChild {
  proc: PiRpcProcess;
  calls: Array<Record<string, unknown>>;
  spawnArgs: string[];
  fire: (event: unknown) => void;
}

interface FakePoolOpts {
  failPrompt?: boolean;
  /** Per-command reply stand-in; returned verbatim for matching commands. */
  request?: (command: Record<string, unknown>) => unknown;
}

function fakeRpcPool(opts: FakePoolOpts = {}) {
  const children: RpcChild[] = [];
  const spawn: PiAdapterNodeSeams["spawnRpc"] = async (args: string[]) => {
    let eventHandler: ((event: unknown) => void) | null = null;
    const calls: Array<Record<string, unknown>> = [];
    const proc: PiRpcProcess = {
      async request(command: Record<string, unknown>): Promise<unknown> {
        calls.push(command);
        if (opts.failPrompt && command.type === "prompt") {
          throw new Error("boom");
        }
        return typeof opts.request === "function" ? opts.request(command) : null;
      },
      setEventHandler(handler) {
        eventHandler = handler;
      },
      onExit() {
        // A dead child would drop it from the pool; tests keep children alive.
      },
      kill() {},
    };
    const child = { proc, calls, spawnArgs: args, fire: (event: unknown) => eventHandler?.(event) };
    children.push(child);
    return child.proc;
  };
  return { spawn, children };
}

const dirs: string[] = [];

interface Harness {
  adapter: ReturnType<typeof createPiAdapter>;
  rpc: ReturnType<typeof fakeRpcPool>;
  runCalls: string[];
  lineagePath: string;
}

/**
 * Adapter wired to real fixture reads and scripted fakes. `sessionIds` names
 * the fixtures the seams expose; nothing outside them is "installed".
 */
async function makeHarness(sessionIds: string[], opts: FakePoolOpts = {}): Promise<Harness> {
  const rpc = fakeRpcPool(opts);
  const runCalls: string[] = [];
  const seams: PiAdapterNodeSeams = {
    async listSessionFiles() {
      return sessionIds.map((id) => FIXTURES[id] ?? id);
    },
    readSessionFile(path) {
      return readFile(path, "utf8");
    },
    async runNodeScript(code) {
      runCalls.push(code);
      return JSON.stringify({ sessionFile: "/tmp/fake/new.jsonl", sessionId: "made-session-1" });
    },
    spawnRpc: rpc.spawn,
  };
  const dir = await mkdtemp(join(tmpdir(), "awefork-pi-"));
  dirs.push(dir);
  const lineagePath = join(dir, "lineage.json");
  return {
    adapter: createPiAdapter({ ...seams, lineagePath }),
    rpc,
    runCalls,
    lineagePath,
  };
}

/** The single RPC child a test drives for a session (one spawn per session). */
function childOf(harness: Harness): RpcChild {
  const child = harness.rpc.children[0];
  if (!child) throw new Error("no RPC child was spawned");
  return child;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// ── messages() ───────────────────────────────────────────────────────────────

describe("createPiAdapter messages()", () => {
  it("maps the active branch, inheriting model/variant from change entries", async () => {
    const { adapter } = await makeHarness(["s1-mixed"]);

    const rows = await adapter.messages("s1-mixed");
    expect(rows.map((r) => r.id)).toEqual(["c-u1", "c-a1", "c-u2", "c-a2"]);

    // c-u1 carries the model entered at the branch start and the medium
    // thinking level set there too.
    const [u1, a1] = rows;
    expect(u1).toMatchObject({
      id: "c-u1",
      role: "user",
      text: "帮我读登录代码",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "medium",
      finish: null,
    });
    expect(a1).toMatchObject({
      role: "assistant",
      text: "登录在 src/auth.ts",
      thinking: "先看入口路由",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      variant: "medium",
      finish: "stop",
      outputTokens: 30,
    });
    // c-a2 follows a model_change to openai/gpt-5 + thinking high, and carries
    // a tool call → its finish and token mapping differ from c-a1.
    const [, , u2, a2] = rows;
    expect(u2).toMatchObject({ providerId: "openai", modelId: "gpt-5", variant: "high" });
    expect(a2).toMatchObject({
      role: "assistant",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      toolNames: ["shell"],
      finish: "tool-calls",
      outputTokens: 55,
      text: "限流已加",
    });
  });

  it("keeps only the last (active) branch and drops its siblings", async () => {
    const { adapter } = await makeHarness(["s2-branch"]);

    // b-alpha and b-beta share a parent; the leaf b-beta (last file entry) is
    // the only branch that surfaces, so b-alpha's text never appears.
    const rows = await adapter.messages("s2-branch");
    expect(rows.map((r) => r.id)).toEqual(["b-u0", "b-a0", "b-u1", "b-beta"]);
    expect(rows.map((r) => r.text)).not.toContain("甲支路");
  });

  it("treats an orphan (missing parentId) as its own root, cutting disconnected history", async () => {
    const { adapter } = await makeHarness(["s3-orphan"]);

    // o-orphan points at a missing parentId, so it starts a fresh root; the
    // previous o-keep/o-gone chain is on a different limb and stays out.
    const rows = await adapter.messages("s3-orphan");
    expect(rows.map((r) => r.id)).toEqual(["o-orphan"]);
    expect(rows[0]?.text).toBe("孤立消息");
  });

  it("throws for a session id the store does not know", async () => {
    const { adapter } = await makeHarness(["s1-mixed"]);
    await expect(adapter.messages("nope")).rejects.toThrow(/不存在/);
  });
});

// ── listSessions() ───────────────────────────────────────────────────────────

describe("createPiAdapter listSessions()", () => {
  it("sorts newest-first and falls back to the first user text for a title", async () => {
    const { adapter } = await makeHarness(["s1-mixed", "s3-orphan", "s4-late"]);

    const sessions = await adapter.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["s4-late", "s1-mixed", "s3-orphan"]);
    // session_info wins a title; otherwise the first user message does.
    expect(sessions.find((s) => s.id === "s1-mixed")?.title).toBe("限流改造");
    expect(sessions.find((s) => s.id === "s4-late")?.title).toBe("最近的会话");
    expect(sessions.find((s) => s.id === "s3-orphan")?.title).toBe("不再被引用的历史");
    expect(sessions.every((s) => s.origin === "root")).toBe(true);
  });

  it("marks a session as a fork through the lineage sidecar", async () => {
    const { adapter, lineagePath } = await makeHarness(["s1-mixed", "s4-late"]);
    const { recordFork } = await import("../src/shared/lineage-store");
    await recordFork(lineagePath, "s4-late", {
      parentId: "s1-mixed",
      atMessageId: "c-u2",
      createdAt: 1,
    });

    const sessions = await adapter.listSessions();
    expect(sessions.find((s) => s.id === "s4-late")).toMatchObject({
      origin: "fork",
      parentSessionId: "s1-mixed",
    });
  });
});

describe("createPiAdapter listModels() and createSession()", () => {
  it("derives ModelOption rows from get_available_models", async () => {
    const { adapter, rpc } = await makeHarness([], {
      request: (command) =>
        command.type === "get_available_models"
          ? {
              models: [
                {
                  id: "gpt-5",
                  name: "GPT-5",
                  provider: "openai",
                  reasoning: true,
                  input: ["text", "image"],
                },
                { id: "bare", name: "", provider: "ollama", reasoning: false, input: ["text"] },
              ],
            }
          : null,
    });

    const models = await adapter.listModels();
    expect(models.map((m) => m.modelId)).toEqual(["gpt-5", "bare"]);
    expect(rpc.children).toHaveLength(1);
    // The probe must not write a session file into the store; the child runs
    // in-memory with `--no-session`.
    expect(rpc.children[0]?.spawnArgs).toEqual(["--no-session"]);
    expect(rpc.children[0]?.calls[0]).toMatchObject({ type: "get_available_models" });
    expect(models[0]).toMatchObject({
      providerId: "openai",
      providerName: "openai",
      modelName: "GPT-5",
      variants: ["off", "minimal", "low", "medium", "high", "xhigh"],
      attachment: true,
    });
    expect(models[1]).toMatchObject({
      modelId: "bare",
      variants: [],
      attachment: false,
    });
  });

  it("returns a root summary from the SDK script, caching the new session id", async () => {
    const { adapter, runCalls } = await makeHarness([]);

    const created = await adapter.createSession("/work");
    expect(created).toMatchObject({
      id: "made-session-1",
      directory: "/work",
      origin: "root",
      parentSessionId: null,
    });
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]).toContain('SessionManager.create("/work")');
  });
});

// ── prompt() / abort() ───────────────────────────────────────────────────────

describe("createPiAdapter prompt() and abort()", () => {
  it("spawns the child directly on the session file and prompts it", async () => {
    const { adapter, rpc } = await makeHarness(["s1-mixed"]);

    await adapter.prompt("s1-mixed", "hi", null);
    expect(rpc.children).toHaveLength(1);
    // The child is told its session at boot (`--session file`), so no
    // switch_session round-trip — and a bare RPC child never creates a junk
    // empty session file for the user.
    expect(rpc.children[0]?.spawnArgs).toEqual(["--session", FIXTURES["s1-mixed"]]);
    expect(rpc.children[0]?.calls.map((c) => c.type)).toEqual(["prompt"]);
  });

  it("refuses to prompt a session the store does not know", async () => {
    const { adapter, rpc } = await makeHarness([]);
    // No fixture seeded, so nothing is readable and no child should spawn.
    await expect(adapter.prompt("nope", "hi")).rejects.toThrow(/不存在/);
    expect(rpc.children).toHaveLength(0);
  });

  it("pools one child per session; a prompt failure emits server.error and rejects", async () => {
    const { adapter, rpc } = await makeHarness(["s1-mixed", "s4-late"], { failPrompt: true });
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await expect(adapter.prompt("s1-mixed", "hi")).rejects.toThrow("boom");
    expect(events).toEqual([
      {
        type: "server.error",
        sessionId: "s1-mixed",
        message: "pi prompt failed: boom",
      },
    ]);
    expect(rpc.children).toHaveLength(1);

    // A second session reuses nothing: each gets its own pooled child.
    await expect(adapter.prompt("s4-late", "hi")).rejects.toThrow("boom");
    expect(rpc.children).toHaveLength(2);
  });

  it("throws when aborting a session with no running child", async () => {
    const { adapter } = await makeHarness(["s1-mixed"]);
    await expect(adapter.abort("s1-mixed")).rejects.toThrow("该会话当前没有正在运行的回合");
  });

  it("concurrent prompts on one session share a single spawned child", async () => {
    const { adapter, rpc } = await makeHarness(["s1-mixed"]);

    await Promise.all([
      adapter.prompt("s1-mixed", "first", null),
      adapter.prompt("s1-mixed", "second", null),
    ]);

    // The spawn memo closes the race that used to orphan one child per pair.
    expect(rpc.children).toHaveLength(1);
    expect(rpc.children[0]?.calls.filter((c) => c.type === "prompt")).toHaveLength(2);
  });
});

// ── summary cache invalidation ───────────────────────────────────────────────

describe("createPiAdapter summary cache invalidation", () => {
  /** Harness whose readSessionFile can be overridden per file mid-test. */
  async function makeOverlayHarness(): Promise<{
    adapter: ReturnType<typeof createPiAdapter>;
    overlay: (text: string) => Promise<void>;
  }> {
    const rpc = fakeRpcPool();
    const overlays = new Map<string, string>();
    const seams: PiAdapterNodeSeams = {
      async listSessionFiles() {
        return [FIXTURES["s1-mixed"]];
      },
      async readSessionFile(path) {
        return overlays.get(path) ?? readFile(path, "utf8");
      },
      async runNodeScript() {
        return JSON.stringify({ sessionFile: "/tmp/fake/new.jsonl", sessionId: "made-session-1" });
      },
      spawnRpc: rpc.spawn,
    };
    const dir = await mkdtemp(join(tmpdir(), "awefork-pi-"));
    dirs.push(dir);
    return {
      adapter: createPiAdapter({ ...seams, lineagePath: join(dir, "lineage.json") }),
      overlay: async (text) => {
        overlays.set(
          FIXTURES["s1-mixed"],
          `${await readFile(FIXTURES["s1-mixed"], "utf8")}\n${text}`,
        );
      },
    };
  }

  it("re-reads summaries after a prompt moved the session file", async () => {
    const { adapter, overlay } = await makeOverlayHarness();
    expect((await adapter.listSessions()).find((s) => s.id === "s1-mixed")?.title).not.toBe(
      "改后标题",
    );

    // The pooled RPC child appends entries out from under the cache mid-run.
    await overlay(
      JSON.stringify({
        type: "session_info",
        id: "c-renamed",
        parentId: null,
        timestamp: "2026-06-02T09:00:00.000Z",
        name: "改后标题",
      }),
    );

    await adapter.prompt("s1-mixed", "hi", null);
    // The prompt's settle drops the pre-run cache; without it the sidebar
    // would keep stale summaries until some create/fork invalidated them.
    const after = await adapter.listSessions();
    expect(after.find((s) => s.id === "s1-mixed")?.title).toBe("改后标题");
  });

  it("re-reads summaries after renameSession", async () => {
    const { adapter, overlay } = await makeOverlayHarness();

    await overlay(
      JSON.stringify({
        type: "session_info",
        id: "c-renamed",
        parentId: null,
        timestamp: "2026-06-02T09:00:00.000Z",
        name: "SDK 改的名",
      }),
    );

    await adapter.renameSession("s1-mixed", "SDK 改的名");
    const after = await adapter.listSessions();
    expect(after.find((s) => s.id === "s1-mixed")?.title).toBe("SDK 改的名");
  });
});

// ── fork() ───────────────────────────────────────────────────────────────────

describe("createPiAdapter fork()", () => {
  it("forks at the session tip when atMessageId is null", async () => {
    const { adapter, runCalls, lineagePath } = await makeHarness(["s5-fork"]);

    const forked = await adapter.fork("s5-fork", null);
    // No cut point: the whole running branch is kept, so the SDK gets the leaf.
    expect(runCalls[0]).toContain('sm.createBranchedSession("m-a3")');
    expect(forked).toMatchObject({ origin: "fork", parentSessionId: "s5-fork" });
    const saved = JSON.parse(await readFile(lineagePath, "utf8"));
    expect(saved["made-session-1"]).toMatchObject({ parentId: "s5-fork", atMessageId: null });
  });

  it("cuts after the turn starting at the chosen message (middle of branch)", async () => {
    const { adapter, runCalls } = await makeHarness(["s5-fork"]);

    // The turn starting at m-q1 runs through m-a2; the cut leaf is the entry
    // right before the *next* user turn, so m-a2 is kept and m-q2 is not.
    await adapter.fork("s5-fork", "m-q1");
    expect(runCalls[0]).toContain('sm.createBranchedSession("m-a2")');
  });

  it("cuts at the tail when the message starts the last turn", async () => {
    const { adapter, runCalls } = await makeHarness(["s5-fork"]);

    // m-q2 is the last user message → there is no following turn to cut, so
    // the branch ends where the file ends.
    await adapter.fork("s5-fork", "m-q2");
    expect(runCalls[0]).toContain('sm.createBranchedSession("m-a3")');
  });

  it("refuses to fork at a message that is not a branch root", async () => {
    const { adapter } = await makeHarness(["s5-fork"]);
    await expect(adapter.fork("s5-fork", "ghost")).rejects.toThrow(/找不到/);
  });

  it("empty-context fork starts a fresh session — no branch copy, lineage kept", async () => {
    const { adapter, runCalls, lineagePath } = await makeHarness(["s5-fork"]);

    const forked = await adapter.fork("s5-fork", "m-q1", { context: "none" });
    // The create script ran (newSession), never the branch copy.
    expect(runCalls[0]).toContain("sm.newSession()");
    expect(runCalls[0]).not.toContain("createBranchedSession");
    expect(forked).toMatchObject({ origin: "fork", parentSessionId: "s5-fork" });
    // The cut point is still recorded, so the canvas hangs the branch there.
    const saved = JSON.parse(await readFile(lineagePath, "utf8"));
    expect(saved["made-session-1"]).toMatchObject({ parentId: "s5-fork", atMessageId: "m-q1" });
  });
});

// ── event / emitPiEvent normalization ────────────────────────────────────────

describe("createPiAdapter event normalization", () => {
  it("maps message_start → started, agent_end → idle + updated", async () => {
    const { adapter, rpc } = await makeHarness(["s1-mixed"]);
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await adapter.prompt("s1-mixed", "hi", null);
    const child = rpc.children[0];
    expect(child).toBeDefined();

    child?.fire({ type: "message_start", message: { id: "c-a2" } });
    child?.fire({ type: "agent_end" });
    expect(events).toContainEqual({
      type: "message.started",
      sessionId: "s1-mixed",
      messageId: "c-a2",
    });
    expect(events).toContainEqual({ type: "session.idle", sessionId: "s1-mixed" });
    expect(events).toContainEqual({ type: "session.updated", sessionId: "s1-mixed" });
  });

  it("maps message_update → one message.part snapshot per content block", async () => {
    const { adapter, rpc } = await makeHarness(["s1-mixed"]);
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await adapter.prompt("s1-mixed", "hi", null);
    const child = rpc.children[0];
    child?.fire({
      type: "message_update",
      message: {
        id: "m-a2",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "想" },
          { type: "text", text: "限流已加" },
        ],
      },
    });

    expect(events).toEqual([
      // pi streams the whole message each time; each block becomes a snapshot.
      {
        type: "message.part",
        sessionId: "s1-mixed",
        messageId: "m-a2",
        partId: "m-a2:0",
        kind: "thinking",
        text: "想",
        startedAt: null,
        endedAt: null,
      },
      {
        type: "message.part",
        sessionId: "s1-mixed",
        messageId: "m-a2",
        partId: "m-a2:1",
        kind: "text",
        text: "限流已加",
        startedAt: null,
        endedAt: null,
      },
    ]);
  });

  it("maps tool_execution_* frames to a session refresh (chips reload)", async () => {
    const { adapter, rpc } = await makeHarness(["s1-mixed"]);
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await adapter.prompt("s1-mixed", "hi", null);
    rpc.children[0]?.fire({ type: "tool_execution_start", toolCallId: "tc1", toolName: "bash" });

    expect(events).toEqual([{ type: "session.updated", sessionId: "s1-mixed" }]);
  });
});

// ── rename / unsupported surfaces ────────────────────────────────────────────

describe("createPiAdapter renameSession and unsupported surfaces", () => {
  it("renames through the SDK appendSessionInfo script", async () => {
    const { adapter, runCalls } = await makeHarness(["s1-mixed"]);
    await adapter.renameSession("s1-mixed", "新标题");
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]).toContain("SessionManager.open");
    expect(runCalls[0]).toContain("appendSessionInfo");
  });

  it("returns no attachments", async () => {
    const { adapter } = await makeHarness(["s1-mixed"]);
    expect(await adapter.messageAttachments("s1-mixed", "c-u1")).toEqual([]);
  });

  it("refuses delete / export / single-message delete / interaction reply", async () => {
    const { adapter } = await makeHarness(["s1-mixed"]);
    await expect(adapter.deleteSession("s1-mixed")).rejects.toThrow(/删除/);
    await expect(adapter.deleteMessage("s1-mixed", "c-u1")).rejects.toThrow(/删除原语/);
    await expect(adapter.exportSession("s1-mixed", null)).rejects.toThrow(/不支持导出/);
    await expect(adapter.respondInteraction("r1", { decision: "deny" })).rejects.toThrow(
      /交互请求/,
    );
  });
});
