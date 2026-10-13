import { createServer, type Server } from "node:http";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { opencodeV2Descriptor } from "../src/shared/agent-descriptor";
import {
  createOpencodeClient,
  DEFAULT_TIMEOUT_MS,
  FORK_TIMEOUT_MS,
  OpencodeApiError,
} from "../src/shared/opencode-client";

/** Fake endpoints for the timeout behavior only; full API semantics live in
 *  opencode-adapter.test.ts. */
let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  servers = [];
});

function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("request timeouts", () => {
  it("fails a wedged request with a clear timeout error instead of hanging forever", async () => {
    // Never responds: a half-dead opencode process.
    const baseUrl = await listen(() => {});
    const client = createOpencodeClient(baseUrl, { timeoutMs: 100 });

    const error: unknown = await client.listSessions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpencodeApiError);
    expect((error as OpencodeApiError).message).toMatch(/timed out after 100ms/);
  });

  it("leaves the prompt endpoint untimed — its response arrives when the run finishes", async () => {
    const baseUrl = await listen((req, res) => {
      if (req.method === "POST" && req.url?.includes("/message")) {
        setTimeout(() => {
          res.writeHead(204);
          res.end();
        }, 150);
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    const client = createOpencodeClient(baseUrl, { timeoutMs: 50 });

    await expect(client.prompt("s1", "hello")).resolves.toBeUndefined();
  });

  it("shields the untimed prompt from undici's transport timeouts", async () => {
    // A real run answers only when it finishes — minutes past undici's
    // default 300s headersTimeout, which used to kill the request with a
    // bare "fetch failed" while the server kept executing the run.
    const baseUrl = await listen((req, res) => {
      if (req.method === "POST" && req.url?.includes("/message")) {
        setTimeout(() => {
          res.writeHead(204);
          res.end();
        }, 150);
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    // Hostile defaults, a tenth of the delay: a prompt riding the global
    // dispatcher instead of the no-deadline agent fails this test.
    const previous = getGlobalDispatcher();
    setGlobalDispatcher(new Agent({ headersTimeout: 40, bodyTimeout: 40 }));
    try {
      const client = createOpencodeClient(baseUrl, { timeoutMs: 50 });
      await expect(client.prompt("s1", "hello")).resolves.toBeUndefined();
    } finally {
      setGlobalDispatcher(previous);
    }
  });

  it("keeps the CRUD budget off fork — copy time scales with session size", async () => {
    // 150 ms is past the client budget below but nothing to FORK_TIMEOUT_MS:
    // a real ~60 MB session copy takes ~50 s server-side, which used to die
    // on the 15 s default while the server finished the fork anyway.
    const baseUrl = await listen((req, res) => {
      if (req.method === "POST" && req.url?.includes("/fork")) {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "s2",
              title: "",
              directory: "",
              time: { created: 0, updated: 0 },
            }),
          );
        }, 150);
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    expect(FORK_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
    const client = createOpencodeClient(baseUrl, { timeoutMs: 100 });
    await expect(client.fork("s1", null)).resolves.toMatchObject({ id: "s2" });
  });

  it("tells a timed-out fork apart from a dead server", async () => {
    // Never responds: the copy is still running. The old wording told the
    // user to restart the server and invite a blind retry — each spawning
    // another full copy of the session.
    const baseUrl = await listen(() => {});
    const client = createOpencodeClient(baseUrl, { forkTimeoutMs: 100 });

    const error: unknown = await client.fork("s1", null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpencodeApiError);
    const message = (error as OpencodeApiError).message;
    expect(message).toMatch(/timed out after 100ms/);
    expect(message).toMatch(/confirm no fork appeared before retrying/);
    expect(message).not.toMatch(/Restart it/);
  });
});

describe("unreachable server errors", () => {
  it("names the transport cause instead of a bare fetch failed", async () => {
    // An ephemeral port that just closed: connection refused, fast. (Port 1
    // would be blocked client-side by fetch's bad-port list — no network,
    // no ECONNREFUSED.)
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", () => resolve()));
    const address = holder.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolve) => holder.close(() => resolve()));
    const baseUrl = `http://127.0.0.1:${port}`;

    const client = createOpencodeClient(baseUrl, { timeoutMs: 1000 });
    const error: unknown = await client.listSessions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpencodeApiError);
    expect((error as OpencodeApiError).message).toMatch(
      `Cannot reach opencode server at ${baseUrl} (fetch failed: ECONNREFUSED)`,
    );
  });
});

/**
 * The v2 wire protocol, verified against a real opencode 2.0.26 server:
 * Basic auth on every route, `{data}` envelopes (with a bare exception),
 * cursor paging, text prompts whose model lives on the session, and a fork
 * body that spells the cut point `before`.
 */
describe("v2 protocol transport", () => {
  const PASSWORD = "test-password-value";

  /** A fake v2 server recording requests; `routes` answers per path+method. */
  function listenV2(routes: Record<string, (body: unknown) => unknown>): Promise<{
    baseUrl: string;
    calls: {
      method: string;
      path: string;
      search: string;
      auth: string | undefined;
      body: unknown;
    }[];
  }> {
    const calls: {
      method: string;
      path: string;
      search: string;
      auth: string | undefined;
      body: unknown;
    }[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const chunks: string[] = [];
      req.on("data", (chunk) => chunks.push(String(chunk)));
      req.on("end", () => {
        const body = chunks.length > 0 ? JSON.parse(chunks.join("")) : undefined;
        calls.push({
          method: req.method ?? "GET",
          path: url.pathname,
          search: url.search,
          auth: req.headers.authorization,
          body,
        });
        const route = routes[`${req.method ?? "GET"} ${url.pathname}`];
        if (!route) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ _tag: "RouteNotFound" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(route(body)));
      });
    });
    servers.push(server);
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, calls });
      });
    });
  }

  const expectedAuth = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`;

  it("authenticates every request with the descriptor's Basic scheme", async () => {
    const { baseUrl, calls } = await listenV2({
      "GET /api/session": () => ({ data: [], cursor: {} }),
      "GET /api/project": () => [],
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await client.listSessions();
    await client.listProjects();
    expect(calls.map((c) => c.auth)).toEqual([expectedAuth, expectedAuth]);
  });

  it("unwraps the {data} envelope, except where the descriptor says bare", async () => {
    const { baseUrl } = await listenV2({
      "GET /api/session": () => ({ data: [{ id: "s1" }], cursor: {} }),
      "GET /api/project": () => [{ id: "p1", canonical: "/tmp" }],
      "GET /api/session/s1": () => ({ data: { id: "s1", title: "t" } }),
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await expect(client.listSessions()).resolves.toEqual([{ id: "s1" }]);
    await expect(client.listProjects()).resolves.toEqual([{ id: "p1", worktree: "/tmp" }]);
    await expect(client.session("s1")).resolves.toEqual({ id: "s1", title: "t" });
  });

  it("walks cursor pages until the server stops handing out a next cursor", async () => {
    let page = 0;
    const { baseUrl, calls } = await listenV2({
      "GET /api/session": () => {
        page += 1;
        return page < 3
          ? { data: [{ id: `s${page}` }], cursor: { next: `c${page}` } }
          : { data: [{ id: `s${page}` }], cursor: {} };
      },
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await expect(client.listSessions()).resolves.toEqual([
      { id: "s1" },
      { id: "s2" },
      { id: "s3" },
    ]);
    expect(page).toBe(3);
    // Each page carries the cursor the previous one returned.
    expect(calls.map((c) => c.path)).toEqual(["/api/session", "/api/session", "/api/session"]);
  });

  it("asks the first page for oldest-first and never pairs order with a cursor", async () => {
    // The server defaults to newest-first — which renders the conversation
    // backwards and misreads the fork cut — and rejects a cursor combined
    // with `order` (InvalidCursorError), so only the first page carries it.
    let page = 0;
    const { baseUrl, calls } = await listenV2({
      "GET /api/session/s1/message": () => {
        page += 1;
        return page < 2
          ? { data: [{ id: `m${page}` }], cursor: { next: "c1" } }
          : { data: [{ id: `m${page}` }], cursor: {} };
      },
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await expect(client.messages("s1")).resolves.toEqual([{ id: "m1" }, { id: "m2" }]);
    const searches = calls.map((c) => c.search);
    expect(searches).toEqual(["?limit=200&order=asc", "?limit=200&cursor=c1"]);
  });

  it("rejects a non-array list answer — a foreign server on the port", async () => {
    const { baseUrl } = await listenV2({ "GET /api/session": () => ({ ok: true }) });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await expect(client.listSessions()).rejects.toThrow(/unexpected shape/);
  });

  it("names a 401 as a password mismatch instead of a generic failure", async () => {
    const server = createServer((req, res) => {
      if (req.url?.startsWith("/api/session")) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ _tag: "UnauthorizedError", message: "Authentication required" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(server);
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: "wrong",
    });
    await expect(client.listSessions()).rejects.toThrow(/password does not match/);
  });

  it("pins the session's model before prompting, then posts text + inline files", async () => {
    const { baseUrl, calls } = await listenV2({
      "POST /api/session/s1/model": () => ({}),
      "POST /api/session/s1/prompt": () => ({ data: { id: "msg_1" } }),
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await client.prompt(
      "s1",
      "hello",
      { providerId: "oc-awerouter", modelId: "glm/glm-5.3", variant: "low" },
      [
        {
          id: "a1",
          filename: "p.md",
          mime: "text/markdown",
          dataUrl: "data:text/markdown;base64,cGluZw==",
        },
      ],
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/session/s1/model",
      "POST /api/session/s1/prompt",
    ]);
    expect(calls[0]?.body).toEqual({
      model: { id: "glm/glm-5.3", providerID: "oc-awerouter", variant: "low" },
    });
    // The data URL itself is the attachment's uri — the server materializes
    // it (mime and all) into the inline file.
    expect(calls[1]?.body).toEqual({
      text: "hello",
      files: [{ uri: "data:text/markdown;base64,cGluZw==", name: "p.md" }],
    });
  });

  it("spells the fork cut point `before`", async () => {
    const { baseUrl, calls } = await listenV2({
      "POST /api/session/s1/fork": () => ({ data: { id: "s2" } }),
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
      forkTimeoutMs: 5000,
    });
    await expect(client.fork("s1", "msg_9")).resolves.toEqual({ id: "s2" });
    expect(calls[0]?.body).toEqual({ before: "msg_9" });
  });

  it("compacts without a body — the model rides the session", async () => {
    const { baseUrl, calls } = await listenV2({
      "POST /api/session/s1/model": () => ({}),
      "POST /api/session/s1/compact": () => ({ data: {} }),
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await client.summarize("s1", { providerId: "p", modelId: "m", variant: null });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/session/s1/model",
      "POST /api/session/s1/compact",
    ]);
    expect(calls[1]?.body).toEqual({});
  });

  it("creates a session in the body's location, not a query param", async () => {
    const { baseUrl, calls } = await listenV2({
      "POST /api/session": () => ({ data: { id: "s9" } }),
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await client.createSession("/tmp/project");
    expect(calls[0]?.path).toBe("/api/session");
    expect(calls[0]?.body).toEqual({ location: { directory: "/tmp/project" } });
  });

  it("maps the flat model list, reading attachment support off the input modalities", async () => {
    const { baseUrl } = await listenV2({
      "GET /api/model": () => ({
        data: [
          {
            id: "hub/glm-5.3",
            modelID: "hub/glm-5.3",
            providerID: "oc-aweshare",
            name: "GLM 5.3",
            capabilities: { input: ["text", "image"], output: ["text"] },
            variants: [{ id: "low" }, { id: "max" }],
          },
          {
            id: "text-only",
            modelID: "text-only",
            providerID: "oc-deepseek",
            capabilities: { input: ["text"] },
            variants: [],
          },
        ],
      }),
    });
    const client = createOpencodeClient(baseUrl, {
      descriptor: opencodeV2Descriptor(),
      password: PASSWORD,
    });
    await expect(client.listModels()).resolves.toEqual([
      {
        providerId: "oc-aweshare",
        providerName: "oc-aweshare",
        modelId: "hub/glm-5.3",
        modelName: "GLM 5.3",
        variants: ["low", "max"],
        attachment: true,
      },
      {
        providerId: "oc-deepseek",
        providerName: "oc-deepseek",
        modelId: "text-only",
        modelName: "text-only",
        variants: [],
        attachment: false,
      },
    ]);
  });
});

