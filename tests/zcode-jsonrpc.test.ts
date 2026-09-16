import { describe, expect, it, vi } from "vitest";
import { createZcodeJsonRpc, splitLines } from "../src/main/zcode-jsonrpc.js";

interface Harness {
  /** Raw stdin lines, in write order. */
  writes: string[];
  request: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  push: (line: string) => void;
  disconnect: () => void;
  dispose: () => void;
}

function harness(options?: Parameters<typeof createZcodeJsonRpc>[2]): Harness {
  const writes: string[] = [];
  const dataListeners = new Set<(chunk: Buffer) => void>();
  let onEnd: (() => void) | null = null;
  const stdout = {
    setEncoding: () => {},
    on(event: string, listener: (chunk: Buffer) => void) {
      // Only "data" listeners receive chunks in this fake; end/error/close
      // are driven explicitly through disconnect().
      if (event === "data") dataListeners.add(listener);
      else onEnd = listener as () => void;
      return this;
    },
    removeListener(event: string, listener: (chunk: Buffer) => void) {
      if (event === "data") dataListeners.delete(listener);
      return this;
    },
  } as unknown as NodeJS.ReadableStream;
  const stdin = {
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  };
  const client = createZcodeJsonRpc(stdin, stdout, options ?? { onNotification: () => {} });
  return {
    writes,
    request: client.request.bind(client),
    push(line) {
      for (const listener of dataListeners) listener(Buffer.from(`${line}\n`, "utf8"));
    },
    disconnect() {
      onEnd?.();
    },
    dispose() {
      client.dispose();
    },
  };
}

describe("zcode-jsonrpc", () => {
  it("sends the bare envelope without a jsonrpc key and resolves by id", async () => {
    const call = harness({ onNotification: () => {} });
    const pending = call.request<{ ok: boolean }>("session/list", { sessionId: "s" });
    await Promise.resolve();
    expect(call.writes).toEqual([
      `${JSON.stringify({ id: 1, method: "session/list", params: { sessionId: "s" } })}\n`,
    ]);
    call.push(JSON.stringify({ id: 1, result: { ok: true } }));
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("answers server requests with safe replies and rejects unknown methods", async () => {
    const notifications: Array<{ method: string; params: unknown }> = [];
    const call = harness({
      onNotification: (method, params) => notifications.push({ method, params }),
    });
    call.push(
      JSON.stringify({
        id: "server-1",
        method: "session/requestRuntimePreferences",
        params: { sessionId: "sess_x", scope: "runtime-materialization" },
      }),
    );
    call.push(JSON.stringify({ id: "server-2", method: "session/somethingElse", params: {} }));
    call.push(JSON.stringify({ method: "session/event", params: { type: "turn_complete" } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const replies = call.writes.map(
      (line) => JSON.parse(line) as { id: string; result?: unknown; error?: unknown },
    );
    const pref = replies.find((reply) => reply.id === "server-1");
    expect(pref?.result).toMatchObject({
      memoryEnabled: false,
      modelContextBudgetStrategy: "preflight-v1",
    });
    const unknown = replies.find((reply) => reply.id === "server-2");
    expect(unknown?.error).toBeDefined();
    expect(notifications).toEqual([
      { method: "session/requestRuntimePreferences", params: expect.anything() },
      { method: "session/somethingElse", params: {} },
      { method: "session/event", params: { type: "turn_complete" } },
    ]);
  });

  it("keeps a multi-byte character split across chunks intact", () => {
    const whole = '{"a":"会话树"}';
    const splitAt = whole.indexOf("会") + 1;
    const first = splitLines("", whole.slice(0, splitAt));
    expect(first.lines).toEqual([]);
    const second = splitLines(first.rest, `${whole.slice(splitAt)}\nnext\n`);
    expect(second.lines).toEqual([whole, "next"]);
  });

  it("rejects every pending request when the stream dies", async () => {
    const call = harness({ onNotification: () => {} });
    const pending = call.request("session/list", {});
    const onReject = vi.fn();
    pending.catch(onReject);
    call.disconnect();
    await vi.waitFor(() => expect(onReject).toHaveBeenCalled());
  });
});
