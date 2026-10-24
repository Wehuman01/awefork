import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ClaudeAdapterNodeSeams,
  type ClaudeChild,
  claudeSpawnArgsFor,
  createClaudeAdapter,
} from "../src/shared/claude-adapter";
import type { AgentEvent } from "../src/shared/types";

/**
 * Fixture grammar mirrors the real store: one directory per encoded cwd, one
 * `<uuid>.jsonl` transcript per session. The seams read these real files and
 * fake every process — no test spawns a `claude` child.
 */
const FIXTURE_DIR = fileURLToPath(
  new URL("./fixtures/claude-sessions/-Users-a-b", import.meta.url),
);

const S1 = "0f1e2d3c-0001-4000-8000-000000000001";
const S2 = "0f1e2d3c-0002-4000-8000-000000000002";
const S3 = "0f1e2d3c-0003-4000-8000-000000000003";
const S4 = "0f1e2d3c-0004-4000-8000-000000000004";
const S5 = "0f1e2d3c-0005-4000-8000-000000000005";

interface FakeChild {
  child: ClaudeChild;
  sent: Array<Record<string, unknown>>;
  spawnArgs: { sessionId: string; cwd: string; resumeParent?: string };
  fire: (frame: Record<string, unknown>) => void;
  exit: (detail: string) => void;
  killed: boolean;
}

function fakeChildren() {
  const spawned: FakeChild[] = [];
  const spawn: ClaudeAdapterNodeSeams["spawnChild"] = async (sessionId, cwd, resumeParent) => {
    let eventHandler: ((frame: Record<string, unknown>) => void) | null = null;
    let exitHandler: ((detail: string) => void) | null = null;
    const sent: Array<Record<string, unknown>> = [];
    const record: FakeChild = {
      sent,
      spawnArgs: { sessionId, cwd, ...(resumeParent ? { resumeParent } : {}) },
      fire: (frame) => eventHandler?.(frame),
      exit: (detail) => exitHandler?.(detail),
      killed: false,
      child: {
        send(frame) {
          sent.push(frame);
        },
        setEventHandler(handler) {
          eventHandler = handler;
        },
        onExit(handler) {
          exitHandler = handler;
        },
        kill() {
          record.killed = true;
        },
      },
    };
    spawned.push(record);
    return record.child;
  };
  const spawnCompactChild: NonNullable<ClaudeAdapterNodeSeams["spawnCompactChild"]> = async (
    sessionId,
    cwd,
  ) => spawn(sessionId, cwd);
  return { spawnChild: spawn, spawnCompactChild, spawned };
}

/** Wait until the compact child exists (compress reads the store first). */
async function waitForSpawn(children: ReturnType<typeof fakeChildren>): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && children.spawned.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (children.spawned.length === 0) throw new Error("no child was spawned");
}

const dirs: string[] = [];

async function makeHarness(ids: string[]) {
  const children = fakeChildren();
  const seams: ClaudeAdapterNodeSeams = {
    spawnChild: children.spawnChild,
    spawnCompactChild: children.spawnCompactChild,
    async listTranscriptFiles() {
      return ids.map((id) => join(FIXTURE_DIR, `${id}.jsonl`));
    },
    readTranscript: (path) => readFile(path, "utf8"),
    async projectDirs() {
      return [FIXTURE_DIR];
    },
  };
  const dir = await mkdtemp(join(tmpdir(), "awefork-claude-"));
  dirs.push(dir);
  const lineagePath = join(dir, "lineage.json");
  const adapter = createClaudeAdapter({ ...seams, lineagePath });
  const events: AgentEvent[] = [];
  await adapter.subscribe((event) => events.push(event));
  return { adapter, children, events, lineagePath };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// ── messages() ───────────────────────────────────────────────────────────────

describe("claude messages", () => {
  it("maps user/assistant rows with thinking, tool names and usage", async () => {
    const { adapter } = await makeHarness([S1]);
    const rows = await adapter.messages(S1);

    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const [user, assistant, , last] = rows;

    expect(user?.text).toBe("List the files");
    expect(user?.modelId).toBeNull();

    // Thinking stays separate from the reply text.
    expect(assistant?.text).toBe("Let me look.");
    expect(assistant?.thinking).toBe("I should run ls.");
    expect(assistant?.toolNames).toEqual(["Bash"]);
    expect(assistant?.modelId).toBe("claude-opus-5");
    expect(assistant?.providerId).toBe("claude");
    expect(assistant?.finish).toBe("tool_use");
    expect(assistant?.outputTokens).toBe(20);
    // input + output + cache read = the step's context footprint.
    expect(assistant?.contextTokens).toBe(1020);

    expect(last?.text).toBe("Two files: a.txt, b.txt.");
    expect(last?.finish).toBe("stop");
  });

  it("drops the pure tool_result pairing row", async () => {
    const { adapter } = await makeHarness([S1]);
    const rows = await adapter.messages(S1);
    expect(rows.some((r) => r.text.includes("a.txt\nb.txt"))).toBe(false);
  });

  it("walks the live branch only: siblings and sidechains stay out", async () => {
    const { adapter } = await makeHarness([S2]);
    const rows = await adapter.messages(S2);
    const texts = rows.map((r) => r.text);

    expect(texts).toContain("Original question");
    expect(texts).toContain("Original answer");
    expect(texts).toContain("Follow-up answer");
    // The abandoned sibling and the subagent chatter are other conversations.
    expect(texts).not.toContain("Abandoned answer");
    expect(texts).not.toContain("Subagent chatter");
  });

  it("flags the compaction boundary row", async () => {
    const { adapter } = await makeHarness([S3]);
    const rows = await adapter.messages(S3);
    const boundary = rows.filter((r) => r.compaction === true);
    expect(boundary).toHaveLength(1);
    expect(boundary[0]?.role).toBe("user");
    // The summary reply that follows is a normal assistant row.
    expect(rows.some((r) => r.text === "Summary reply")).toBe(true);
  });

  it("keeps pre-fold history visible across the CLI's chain break", async () => {
    // After /compact the CLI writes system(parent=None) + boundary as a NEW
    // chain, leaving the old conversation unlinked. The walk must splice the
    // old chain back in as the prefix so history stays readable.
    const { adapter } = await makeHarness([S5]);
    const rows = await adapter.messages(S5);

    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user"]);
    expect(rows[0]?.text).toBe("Say ONE");
    expect(rows[2]?.compaction).toBe(true);
    // The boundary's body is claude's boilerplate, not user text.
    expect(rows[2]?.text).toBe("");
  });

  it("returns an empty list for a pending session with no transcript", async () => {
    const { adapter } = await makeHarness([S1]);
    const created = await adapter.createSession("/Users/a/b");
    expect(await adapter.messages(created.id)).toEqual([]);
  });

  it("rejects a session whose transcript vanished", async () => {
    const { adapter } = await makeHarness([S1]);
    await expect(adapter.messages("00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      /no transcript yet/,
    );
  });
});

// ── listSessions() ───────────────────────────────────────────────────────────

describe("claude listSessions", () => {
  it("derives titles, directories and timestamps from the transcripts", async () => {
    const { adapter } = await makeHarness([S1, S4]);
    const sessions = await adapter.listSessions();

    expect(sessions).toHaveLength(2);
    const s1 = sessions.find((s) => s.id === S1);
    expect(s1?.title).toBe("List the files");
    expect(s1?.directory).toBe("/Users/a/b");
    expect(s1?.origin).toBe("root");
    expect(s1?.createdAt).toBe(Date.parse("2026-07-01T12:00:00.000Z"));
    expect(s1?.updatedAt).toBe(Date.parse("2026-07-01T12:01:04.000Z"));
  });

  it("prefers claude's own summary title when the transcript has one", async () => {
    const { adapter } = await makeHarness([S3]);
    const sessions = await adapter.listSessions();
    expect(sessions[0]?.title).toBe("Compacted: discussed long prompt");
  });

  it("merges pending sessions ahead of their first prompt", async () => {
    const { adapter } = await makeHarness([S1]);
    const created = await adapter.createSession("/Users/a/b");
    const sessions = await adapter.listSessions();
    expect(sessions.some((s) => s.id === created.id)).toBe(true);
  });

  it("sorts newest first", async () => {
    const { adapter } = await makeHarness([S1, S2, S3, S4]);
    const sessions = await adapter.listSessions();
    const stamps = sessions.map((s) => s.updatedAt);
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
  });
});

// ── createSession / fork / export ────────────────────────────────────────────

describe("claude sessions", () => {
  it("createSession assigns a UUID and a directory without touching disk", async () => {
    const { adapter, children } = await makeHarness([S1]);
    const session = await adapter.createSession("/Users/a/b");

    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(session.directory).toBe("/Users/a/b");
    expect(session.origin).toBe("root");
    expect(children.spawned).toHaveLength(0);
  });

  it("fork records lineage and defers the copy to the first prompt", async () => {
    const { adapter, children } = await makeHarness([S1]);
    const forked = await adapter.fork(S1, "11111111-1111-4111-8111-111111111111");

    expect(forked.origin).toBe("fork");
    expect(forked.parentSessionId).toBe(S1);
    expect(forked.directory).toBe("/Users/a/b");
    expect(children.spawned).toHaveLength(0);

    // The spawn seam learns the resume parent, so the child materializes the
    // copy with --resume <parent> --fork-session.
    await adapter.prompt(forked.id, "continue", null, []);
    expect(children.spawned[0]?.spawnArgs).toEqual({
      sessionId: forked.id,
      cwd: "/Users/a/b",
      resumeParent: S1,
    });
  });

  it("an empty-context fork spawns a plain new session", async () => {
    const { adapter, children } = await makeHarness([S1]);
    const forked = await adapter.fork(S1, null, { context: "none" });

    await adapter.prompt(forked.id, "fresh start", null, []);
    expect(children.spawned[0]?.spawnArgs.resumeParent).toBeUndefined();
  });

  it("exportSession copies without a canvas parent", async () => {
    const { adapter } = await makeHarness([S1]);
    const exported = await adapter.exportSession(S1, null);
    expect(exported.origin).toBe("root");
    expect(exported.parentSessionId).toBeNull();
  });

  it("rejects delete and rename, which the CLI has no primitive for", async () => {
    const { adapter } = await makeHarness([S1]);
    await expect(adapter.deleteSession(S1)).rejects.toThrow(/no whole-session delete/);
    await expect(adapter.deleteMessage(S1, "x")).rejects.toThrow(/no single-message delete/);
    await expect(adapter.renameSession(S1, "t")).rejects.toThrow(/no rename primitive/);
  });
});

// ── prompt + streaming ───────────────────────────────────────────────────────

describe("claude prompt", () => {
  it("sends one user frame carrying text and images", async () => {
    const { adapter, children } = await makeHarness([S1]);
    await adapter.prompt(S1, "look at this", { providerId: "claude", modelId: "opus" }, [
      {
        mime: "image/png",
        filename: "a.png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
      {
        mime: "text/plain",
        filename: "notes.txt",
        dataUrl: `data:text/plain;base64,${Buffer.from("hello notes").toString("base64")}`,
      },
    ]);

    const frame = children.spawned[0]?.sent[0];
    expect(frame?.type).toBe("user");
    const message = frame?.message as { content: Array<Record<string, unknown>> };
    const content = message.content;
    expect(content[0]).toEqual({
      type: "text",
      text: "look at this\n\n--- notes.txt ---\nhello notes",
    });
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
    });
    expect(frame?.model).toBe("opus");
  });

  it("omits the model field for the agent default", async () => {
    const { adapter, children } = await makeHarness([S1]);
    await adapter.prompt(S1, "hi", { providerId: "claude", modelId: "default" }, []);
    expect(children.spawned[0]?.sent[0]?.model).toBeUndefined();
  });

  it("reports the run as running until the result frame settles it", async () => {
    const { adapter, children, events } = await makeHarness([S1]);
    await adapter.prompt(S1, "hi", null, []);

    children.spawned[0]?.fire({ type: "system", subtype: "init", session_id: S1 });
    children.spawned[0]?.fire({ type: "result", is_error: false });

    expect(events.some((e) => e.type === "session.idle" && e.sessionId === S1)).toBe(true);
  });

  it("forwards token deltas as text and thinking", async () => {
    const { adapter, children, events } = await makeHarness([S1]);
    await adapter.prompt(S1, "hi", null, []);
    const child = children.spawned[0];
    child?.fire({ type: "assistant", uuid: "m1" });
    child?.fire({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
    });
    child?.fire({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "thinking_delta", thinking: "hm" },
      },
    });

    const deltas = events.filter((e) => e.type === "message.delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ kind: "text", delta: "Hel", partId: "block-0" });
    expect(deltas[1]).toMatchObject({ kind: "thinking", delta: "hm", partId: "block-1" });
  });

  it("surfaces a can_use_tool ask and answers it over the wire", async () => {
    const { adapter, children, events } = await makeHarness([S1]);
    await adapter.prompt(S1, "run it", null, []);

    children.spawned[0]?.fire({
      type: "control_request",
      request_id: "req-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "rm -rf node_modules" },
      },
    });

    const ask = events.find((e) => e.type === "interaction.requested");
    expect(ask).toMatchObject({
      type: "interaction.requested",
      request: {
        requestId: "req-1",
        sessionId: S1,
        kind: "command-approval",
        title: "claude.permissionTitle",
        command: "rm -rf node_modules",
      },
    });

    await adapter.respondInteraction("req-1", { decision: "allow" });
    const reply = children.spawned[0]?.sent.at(-1);
    expect(reply).toMatchObject({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        response: { behavior: "allow", updatedInput: { command: "rm -rf node_modules" } },
      },
    });
  });

  it("answers deny with a message the model can read", async () => {
    const { adapter, children } = await makeHarness([S1]);
    await adapter.prompt(S1, "run it", null, []);
    children.spawned[0]?.fire({
      type: "control_request",
      request_id: "req-2",
      request: { subtype: "can_use_tool", tool_name: "Write", input: { file_path: "/tmp/x" } },
    });
    await adapter.respondInteraction("req-2", { decision: "deny" });

    const reply = children.spawned[0]?.sent.at(-1) ?? {};
    const envelope = reply.response as { response: Record<string, unknown> };
    expect(envelope.response).toEqual({
      behavior: "deny",
      message: "awefork: denied by the user",
    });
  });

  it("treats a second reply to the same ask as a no-op", async () => {
    const { adapter, children } = await makeHarness([S1]);
    await adapter.prompt(S1, "run it", null, []);
    children.spawned[0]?.fire({
      type: "control_request",
      request_id: "req-3",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } },
    });
    await adapter.respondInteraction("req-3", { decision: "allow" });
    const after = children.spawned[0]?.sent.length;
    await adapter.respondInteraction("req-3", { decision: "deny" });
    expect(children.spawned[0]?.sent.length).toBe(after);
  });
});

// ── compress / abort / attachments / models ──────────────────────────────────

describe("claude compress and abort", () => {
  it("compress sends /compact on a resume child and announces completion", async () => {
    const { adapter, children, events } = await makeHarness([S1]);
    const pending = adapter.compress(S1, { providerId: "claude", modelId: "default" });
    // The child settles the run; the adapter reports only after the verdict.
    await waitForSpawn(children);
    children.spawned[0]?.fire({ type: "result", subtype: "success", is_error: false, result: "" });
    await pending;

    const frame = children.spawned[0]?.sent[0];
    expect(frame?.message).toEqual({
      role: "user",
      content: [{ type: "text", text: "/compact" }],
    });
    expect(events.some((e) => e.type === "session.compressed")).toBe(true);
  });

  it("compress surfaces the CLI's refusal instead of a silent toast", async () => {
    const { adapter, children, events } = await makeHarness([S1]);
    const pending = adapter.compress(S1, { providerId: "claude", modelId: "default" });
    await waitForSpawn(children);
    children.spawned[0]?.fire({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Not enough messages to compact.",
    });
    await expect(pending).rejects.toThrow(/Not enough messages to compact/);
    expect(events.some((e) => e.type === "session.compressed")).toBe(false);
    expect(events.some((e) => e.type === "server.error")).toBe(true);
  });

  it("abort sends an interrupt control request", async () => {
    const { adapter, children } = await makeHarness([S1]);
    await adapter.prompt(S1, "long job", null, []);
    await adapter.abort(S1);

    const frame = children.spawned[0]?.sent.at(-1);
    expect(frame?.type).toBe("control_request");
    const request = frame?.request as { subtype: string };
    expect(request.subtype).toBe("interrupt");
  });

  it("abort refuses when nothing is running", async () => {
    const { adapter } = await makeHarness([S1]);
    await expect(adapter.abort(S1)).rejects.toThrow(/no turn running/);
  });

  it("reports a child exit as a session error and settles the run", async () => {
    const { adapter, children, events } = await makeHarness([S1]);
    await adapter.prompt(S1, "hi", null, []);
    children.spawned[0]?.exit("exit 1 — boom");

    expect(events.some((e) => e.type === "server.error" && e.sessionId === S1)).toBe(true);
    expect(events.some((e) => e.type === "session.idle" && e.sessionId === S1)).toBe(true);
  });
});

describe("claude attachments and models", () => {
  it("round-trips image attachments from the transcript", async () => {
    const { adapter } = await makeHarness([S4]);
    const attachments = await adapter.messageAttachments(
      S4,
      "ccccccc1-1111-4111-8111-111111111111",
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.mime).toBe("image/png");
    expect(attachments[0]?.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("returns nothing for a message with no image parts", async () => {
    const { adapter } = await makeHarness([S1]);
    const attachments = await adapter.messageAttachments(
      S1,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(attachments).toEqual([]);
  });

  it("offers the CLI's model aliases", async () => {
    const { adapter } = await makeHarness([S1]);
    const models = await adapter.listModels();
    expect(models.map((m) => m.modelId)).toEqual(["default", "opus", "sonnet", "haiku"]);
    expect(models.every((m) => m.providerId === "claude")).toBe(true);
  });
});

// ── spawn argv ───────────────────────────────────────────────────────────────

describe("claudeSpawnArgsFor", () => {
  it("names a plain session", () => {
    expect(claudeSpawnArgsFor(S1)).toEqual(["--session-id", S1]);
  });

  it("resumes and forks for a pending copy", () => {
    expect(claudeSpawnArgsFor(S2, S1)).toEqual([
      "--resume",
      S1,
      "--fork-session",
      "--session-id",
      S2,
    ]);
  });
});
