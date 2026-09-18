import { createServer, type Server } from "node:http";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { createOpencodeClient, OpencodeApiError } from "../src/shared/opencode-client";

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
