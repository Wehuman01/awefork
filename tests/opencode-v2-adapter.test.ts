import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { opencodeV2Descriptor } from "../src/shared/agent-descriptor";
import { readLineage } from "../src/shared/lineage-store";
import { createOpencodeAdapter } from "../src/shared/opencode-adapter";
import type { AgentEvent, ModelChoice } from "../src/shared/types";

/**
 * End-to-end contract for the v2 protocol, driven against a fake server that
 * mirrors a real opencode 2.0.26 instance: `/api` routes, Basic auth, `{data}`
 * envelopes, flat rows (`location.directory`, `content[]`, row-level `text`),
 * and the new streaming event family. Every shape here was captured from the
 * real server (see docs/superpowers/specs/2026-10-13-opencode-v2-support-design.md).
 */

const PASSWORD = "test-password-value";
const AUTH = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`;

/** One v2 session row, flattened from the real API's shape. */
function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ses_1",
    title: "probe",
    location: { directory: "/tmp/project" },
    time: { created: 100, updated: 200 },
    ...overrides,
  };
}

/** One v2 user row: text lives on the row, files beside it. */
function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_u1",
    type: "user",
    text: "hello",
    time: { created: 101 },
    files: [],
    ...overrides,
  };
}

/** One v2 assistant row: parts live in `content`. */
function assistantRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_a1",
    type: "assistant",
    agent: "build",
    model: { id: "glm/glm-5.3", providerID: "oc-awerouter", variant: "low" },
    content: [],
    finish: "stop",
    tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 0, write: 0 } },
    time: { created: 102, completed: 103 },
    ...overrides,
  };
}

interface FakeV2 {
  baseUrl: string;
  close: () => Promise<void>;
  /** Requests recorded, in order. */
  calls: { method: string; path: string; auth: string | undefined; body: unknown }[];
  /** Push one SSE frame (already normalized) onto the live event stream. */
  pushFrame: (frame: Record<string, unknown>) => void;
  /** Server-side session rows, mutable so tests can set up forks. */
  sessions: Record<string, unknown>[];
  messages: Record<string, Record<string, unknown>[]>;
}

function startFakeV2(
  options: {
    sessions?: Record<string, unknown>[];
    messages?: Record<string, Record<string, unknown>[]>;
    projects?: Record<string, unknown>[];
  } = {},
): Promise<FakeV2> {
  const calls: FakeV2["calls"] = [];
  const sessions = options.sessions ?? [session()];
  const messages = options.messages ?? { ses_1: [userRow(), assistantRow()] };
  const projects = options.projects ?? [{ id: "p1", canonical: "/tmp/project" }];
  const sseResponses: import("node:http").ServerResponse[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks: string[] = [];
    req.on("data", (chunk) => chunks.push(String(chunk)));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(chunks.join("")) : undefined;
      calls.push({
        method: req.method ?? "GET",
        path: url.pathname,
        auth: req.headers.authorization,
        body,
      });
      const json = (payload: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const bare = (payload: unknown): void => json(payload);
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/api/event") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write('data: {"id":"evt_0","type":"server.connected","data":{}}\n\n');
        sseResponses.push(res);
        return;
      }
      if (method === "GET" && path === "/api/session") {
        const directory = url.searchParams.get("directory");
        const rows = directory
          ? sessions.filter((s) => (s.location as { directory: string }).directory === directory)
          : sessions;
        return json({ data: rows, cursor: {} });
      }
      if (method === "GET" && path === "/api/project") return bare(projects);
      if (method === "GET" && path === "/api/model") {
        return json({
          data: [
            {
              id: "glm/glm-5.3",
              modelID: "glm/glm-5.3",
              providerID: "oc-awerouter",
              name: "GLM 5.3",
              capabilities: { input: ["text", "image"] },
              variants: [{ id: "low" }, { id: "max" }],
            },
          ],
        });
      }
      if (method === "POST" && path === "/api/session") {
        const created = session({
          id: "ses_new",
          title: "",
          location: {
            directory:
              (body as { location?: { directory?: string } })?.location?.directory ??
              "/tmp/project",
          },
          time: { created: 500, updated: 500 },
        });
        sessions.push(created);
        return json({ data: created });
      }
      const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/);
      if (sessionMatch) {
        const id = sessionMatch[1] as string;
        if (method === "GET") {
          const row = sessions.find((s) => s.id === id);
          return row ? json({ data: row }) : json({ _tag: "SessionNotFoundError", message: "no" });
        }
        if (method === "DELETE") {
          const at = sessions.findIndex((s) => s.id === id);
          if (at >= 0) sessions.splice(at, 1);
          res.writeHead(204);
          return res.end();
        }
        if (method === "PATCH") {
          const row = sessions.find((s) => s.id === id);
          if (row) row.title = (body as { title?: string })?.title ?? row.title;
          res.writeHead(204);
          return res.end();
        }
      }
      const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/);
      if (messagesMatch && method === "GET") {
        return json({ data: messages[messagesMatch[1] as string] ?? [], cursor: {} });
      }
      const modelMatch = path.match(/^\/api\/session\/([^/]+)\/model$/);
      if (modelMatch && method === "POST") {
        const row = sessions.find((s) => s.id === modelMatch[1]);
        if (row) row.model = (body as { model?: unknown })?.model;
        return json({ data: {} });
      }
      const promptMatch = path.match(/^\/api\/session\/([^/]+)\/prompt$/);
      if (promptMatch && method === "POST") {
        return json({ data: { id: "msg_inbox", sessionID: promptMatch[1], type: "user" } });
      }
      const forkMatch = path.match(/^\/api\/session\/([^/]+)\/fork$/);
      if (forkMatch && method === "POST") {
        const parent = sessions.find((s) => s.id === forkMatch[1]);
        const cut = (body as { before?: string })?.before ?? null;
        const created = session({
          id: "ses_fork",
          title: `${parent?.title ?? ""} (fork #1)`,
          fork: {
            sessionID: forkMatch[1],
            boundary: { type: "before", messageID: cut },
          },
          time: { created: 600, updated: 600 },
        });
        sessions.push(created);
        return json({ data: created });
      }
      const compactMatch = path.match(/^\/api\/session\/([^/]+)\/compact$/);
      if (compactMatch && method === "POST") return json({ data: {} });
      const interruptMatch = path.match(/^\/api\/session\/([^/]+)\/interrupt$/);
      if (interruptMatch && method === "POST") return json({ data: { interrupted: true } });
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ _tag: "RouteNotFound" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
        calls,
        pushFrame: (frame) => {
          for (const response of sseResponses) {
            response.write(`data: ${JSON.stringify(frame)}\n\n`);
          }
        },
        sessions,
        messages,
      });
    });
  });
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.map((fn) => fn()));
  cleanup.length = 0;
});

async function adapterFor(fake: FakeV2, lineagePath: string, fileChangesDir?: string) {
  const adapter = createOpencodeAdapter({
    baseUrl: fake.baseUrl,
    lineagePath,
    fileChangesDir,
    descriptor: opencodeV2Descriptor(),
    password: PASSWORD,
    // No fork adoption polling in tests: the fake answers instantly.
    adoptSleep: async () => {},
  });
  cleanup.push(async () => {
    await adapter.dispose();
  });
  return adapter;
}

describe("v2 session listing", () => {
  it("maps location.directory, fork.sessionID and the row's own fields", async () => {
    const fake = await startFakeV2({
      sessions: [
        session({ id: "ses_root", title: "root", time: { created: 1, updated: 2 } }),
        session({
          id: "ses_fork",
          title: "root (fork #1)",
          fork: { sessionID: "ses_root", boundary: { type: "before", messageID: "msg_u1" } },
          time: { created: 3, updated: 4 },
        }),
      ],
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));

    await expect(adapter.listSessions()).resolves.toEqual([
      {
        id: "ses_fork",
        title: "root (fork #1)",
        directory: "/tmp/project",
        parentSessionId: "ses_root",
        origin: "subagent",
        createdAt: 3,
        updatedAt: 4,
      },
      {
        id: "ses_root",
        title: "root",
        directory: "/tmp/project",
        parentSessionId: null,
        origin: "root",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    // Every request authenticated.
    expect(fake.calls.every((c) => c.auth === AUTH)).toBe(true);
  });

  it("fans out to each project's worktree (canonical) like v1 did", async () => {
    const fake = await startFakeV2({
      sessions: [session({ id: "ses_a", location: { directory: "/tmp/one" } })],
      projects: [
        { id: "p1", canonical: "/tmp/one" },
        { id: "p2", canonical: "/tmp/two" },
      ],
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));
    const sessions = await adapter.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["ses_a"]);
    // One scoped request per worktree, on top of the unscoped one.
    const sessionCalls = fake.calls.filter((c) => c.path === "/api/session");
    expect(sessionCalls.length).toBe(3);
  });
});

describe("v2 message mapping", () => {
  it("reads user text off the row and assistant parts out of content", async () => {
    const fake = await startFakeV2({
      messages: {
        ses_1: [
          userRow({
            text: "fix the bug",
            files: [{ name: "err.log", mime: "text/plain", data: "cGluZw==" }],
          }),
          assistantRow({
            content: [
              { type: "reasoning", text: "let me look", time: { created: 10, completed: 11 } },
              {
                type: "tool",
                id: "call_1",
                name: "edit",
                state: { status: "completed", input: { path: "/tmp/project/a.md" } },
              },
              { type: "text", text: "done" },
            ],
            finish: "tool-calls",
            tokens: { input: 5, output: 7, reasoning: 3, cache: { read: 0, write: 0 } },
          }),
        ],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));

    const messages = await adapter.messages("ses_1");
    expect(messages).toEqual([
      {
        id: "msg_u1",
        role: "user",
        text: "fix the bug",
        thinking: "",
        toolNames: [],
        modelId: null,
        providerId: null,
        variant: null,
        attachmentNames: ["err.log"],
        createdAt: 101,
        completedAt: null,
        finish: null,
        outputTokens: null,
        error: null,
      },
      {
        id: "msg_a1",
        role: "assistant",
        text: "done",
        thinking: "let me look",
        toolNames: ["edit"],
        modelId: "glm/glm-5.3",
        providerId: "oc-awerouter",
        variant: "low",
        attachmentNames: [],
        createdAt: 102,
        completedAt: 103,
        finish: "tool-calls",
        outputTokens: 7,
        error: null,
      },
    ]);
  });

  it("drops bookkeeping rows and keeps the compaction marker as a user row", async () => {
    const fake = await startFakeV2({
      messages: {
        ses_1: [
          userRow({ id: "msg_u0", text: "old question" }),
          assistantRow({ id: "msg_a0", content: [{ type: "text", text: "old answer" }] }),
          // v2's compaction marker IS a row.
          {
            id: "msg_c1",
            type: "compaction",
            status: "completed",
            reason: "manual",
            summary: "folded",
            time: { created: 150 },
          },
          userRow({ id: "msg_u1", text: "next question" }),
          { id: "msg_i1", type: "idle", outcome: "succeeded", time: { created: 160 } },
          { id: "msg_m1", type: "model-switched", model: { id: "x" }, time: { created: 161 } },
          { id: "msg_s1", type: "synthetic", text: "note", time: { created: 162 } },
        ],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));

    const messages = await adapter.messages("ses_1");
    expect(messages.map((m) => `${m.role}:${m.id}`)).toEqual([
      "user:msg_u0",
      "assistant:msg_a0",
      "user:msg_c1",
      "user:msg_u1",
    ]);
    expect(messages[2]).toMatchObject({ compaction: true, text: "" });
  });

  it("reads a failed assistant row's error message", async () => {
    const fake = await startFakeV2({
      messages: {
        ses_1: [
          assistantRow({
            content: [],
            error: { type: "provider.auth", message: "consumer key required" },
          }),
        ],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));
    const [message] = await adapter.messages("ses_1");
    expect(message?.error).toBe("consumer key required");
  });

  it("round-trips row-level attachments back into prompt attachments", async () => {
    const fake = await startFakeV2({
      messages: {
        ses_1: [
          userRow({
            text: "look",
            files: [
              { name: "a.png", mime: "image/png", data: "AAAA" },
              { name: "lost.txt", mime: "text/plain" },
            ],
          }),
        ],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));

    await expect(adapter.messageAttachments("ses_1", "msg_u1")).resolves.toEqual([
      { mime: "image/png", filename: "a.png", dataUrl: "data:image/png;base64,AAAA" },
    ]);
  });
});

describe("v2 mutations", () => {
  it("creates, renames, deletes and interrupts through the /api routes", async () => {
    const fake = await startFakeV2();
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));

    await expect(adapter.createSession("/tmp/other")).resolves.toMatchObject({
      id: "ses_new",
      directory: "/tmp/other",
      origin: "root",
    });
    await adapter.renameSession("ses_1", "renamed");
    await adapter.abort("ses_1");
    await adapter.deleteSession("ses_1");

    const paths = fake.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toEqual([
      "POST /api/session",
      "PATCH /api/session/ses_1",
      "POST /api/session/ses_1/interrupt",
      "DELETE /api/session/ses_1",
    ]);
    expect(fake.calls[1]?.body).toEqual({ title: "renamed" });
  });

  it("forks with the next-user cut and records lineage", async () => {
    const fake = await startFakeV2({
      messages: {
        ses_1: [
          userRow({ id: "msg_u1", text: "one" }),
          assistantRow({ id: "msg_a1", content: [{ type: "text", text: "reply" }] }),
          userRow({ id: "msg_u2", text: "two" }),
          assistantRow({ id: "msg_a2", content: [{ type: "text", text: "reply2" }] }),
        ],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const lineagePath = join(dir, "lineage.json");
    const adapter = await adapterFor(fake, lineagePath);

    // Fork after the first turn: the cut is the NEXT user message (msg_u2).
    const forked = await adapter.fork("ses_1", "msg_a1", null);
    expect(forked).toMatchObject({
      id: "ses_fork",
      origin: "fork",
      parentSessionId: "ses_1",
    });
    const forkCall = fake.calls.find((c) => c.path === "/api/session/ses_1/fork");
    expect(forkCall?.body).toEqual({ before: "msg_u2" });
    const lineage = await readLineage(lineagePath);
    expect(lineage.ses_fork).toMatchObject({
      parentId: "ses_1",
      atMessageId: "msg_a1",
      createdAt: 600,
    });
  });

  it("exports a branch as a detached root session with no lineage", async () => {
    const fake = await startFakeV2({
      messages: {
        ses_1: [
          userRow({ id: "msg_u1" }),
          assistantRow({ id: "msg_a1" }),
          userRow({ id: "msg_u2" }),
        ],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const lineagePath = join(dir, "lineage.json");
    const adapter = await adapterFor(fake, lineagePath);

    const exported = await adapter.exportSession("ses_1", "msg_a1");
    expect(exported).toMatchObject({ id: "ses_fork", origin: "root", parentSessionId: null });
    expect(existsSync(lineagePath)).toBe(false);
  });

  it("pins the model before prompting and before compacting", async () => {
    const fake = await startFakeV2();
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));
    const model: ModelChoice = {
      providerId: "oc-awerouter",
      modelId: "glm/glm-5.3",
      variant: "low",
    };
    const landed = (path: string): Promise<void> =>
      new Promise((resolve) => {
        const check = (): void => {
          if (fake.calls.some((c) => c.path === path)) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

    // Prompt and compress are detached by design (the run streams on /event),
    // so each settles on its own; the model POST must precede its own call.
    await adapter.prompt("ses_1", "hi", model, []);
    await landed("/api/session/ses_1/prompt");
    await adapter.compress("ses_1", model);
    await landed("/api/session/ses_1/compact");

    const paths = fake.calls.map((c) => c.path);
    expect(paths.indexOf("/api/session/ses_1/model")).toBeLessThan(
      paths.indexOf("/api/session/ses_1/prompt"),
    );
    expect(paths.lastIndexOf("/api/session/ses_1/model")).toBeLessThan(
      paths.indexOf("/api/session/ses_1/compact"),
    );
  });
});

describe("v2 event stream", () => {
  it("streams a run: started → text parts and deltas → idle", async () => {
    const fake = await startFakeV2();
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const adapter = await adapterFor(fake, join(dir, "lineage.json"));
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribe((event) => events.push(event));
    try {
      // The stream is live once the adapter has asked for /api/event.
      for (let i = 0; i < 40 && !fake.calls.some((c) => c.path === "/api/event"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      fake.pushFrame({
        id: "evt_1",
        created: 1000,
        type: "session.execution.started",
        data: { sessionID: "ses_1" },
      });
      fake.pushFrame({
        id: "evt_2",
        created: 1001,
        type: "session.text.started",
        data: { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0 },
      });
      fake.pushFrame({
        id: "evt_3",
        created: 1002,
        type: "session.text.delta",
        data: { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, delta: "po" },
      });
      fake.pushFrame({
        id: "evt_4",
        created: 1003,
        type: "session.text.ended",
        data: { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, text: "pong" },
      });
      fake.pushFrame({
        id: "evt_5",
        created: 1004,
        type: "session.execution.succeeded",
        data: { sessionID: "ses_1" },
      });
      for (let i = 0; i < 40 && events.length < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      unsubscribe();
    }

    expect(events).toEqual([
      { type: "message.started", sessionId: "ses_1", messageId: "" },
      {
        type: "message.part",
        sessionId: "ses_1",
        messageId: "msg_a1",
        partId: "text:msg_a1#0",
        kind: "text",
        text: "",
        startedAt: null,
        endedAt: null,
      },
      {
        type: "message.delta",
        sessionId: "ses_1",
        messageId: "msg_a1",
        partId: "text:msg_a1#0",
        kind: "text",
        delta: "po",
      },
      {
        type: "message.part",
        sessionId: "ses_1",
        messageId: "msg_a1",
        partId: "text:msg_a1#0",
        kind: "text",
        text: "pong",
        startedAt: null,
        endedAt: 1003,
      },
      { type: "session.idle", sessionId: "ses_1" },
    ]);
  });

  it("records file changes from the tool lifecycle, keyed by call id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awefork-v2-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "a.md");
    await writeFile(file, "one\ntwo\n", "utf8");
    const fake = await startFakeV2();
    // The recorder only tracks paths inside the session's directory.
    fake.sessions[0] = { ...fake.sessions[0], location: { directory: dir } };
    const changesRoot = join(dir, "file-changes");
    const adapter = createOpencodeAdapter({
      baseUrl: fake.baseUrl,
      lineagePath: join(dir, "lineage.json"),
      fileChangesDir: changesRoot,
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
      readFile: (path) => readFile(path),
    });
    cleanup.push(() => adapter.dispose());
    const events: AgentEvent[] = [];
    const unsubscribe = await adapter.subscribe((event) => events.push(event));
    try {
      for (let i = 0; i < 40 && !fake.calls.some((c) => c.path === "/api/event"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      fake.pushFrame({
        id: "evt_1",
        created: 1,
        type: "session.tool.called",
        data: {
          sessionID: "ses_1",
          assistantMessageID: "msg_a1",
          id: "call_1",
          name: "edit",
          input: { path: file },
          executed: false,
        },
      });
      // The recorder reads "before" asynchronously; wait for it to land.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeFile(file, "one\nTWO\n", "utf8");
      fake.pushFrame({
        id: "evt_2",
        created: 2,
        type: "session.tool.success",
        data: {
          sessionID: "ses_1",
          assistantMessageID: "msg_a1",
          id: "call_1",
          content: [{ type: "text", text: "Edited" }],
        },
      });
      const index = join(changesRoot, "ses_1", "index.json");
      for (let i = 0; i < 40 && !existsSync(index); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const recorded = JSON.parse(await readFile(index, "utf8")) as {
        messages: Record<string, Array<{ path: string; status: string; added: number }>>;
      };
      const entry = recorded.messages.msg_a1?.find((e) => e.path === file);
      expect(entry).toMatchObject({ status: "modified", added: 1 });
    } finally {
      unsubscribe();
    }
  });
});
