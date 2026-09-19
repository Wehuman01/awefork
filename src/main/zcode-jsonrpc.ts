/**
 * Minimal client for the ZCode Protocol over a child process's stdio.
 *
 * `zcode app-server` speaks newline-delimited JSON with a strict envelope
 * that is close to, but not, JSON-RPC 2.0: a request is `{id, method,
 * params}` with no `jsonrpc` key (the server's schema rejects unknown keys),
 * and ids are opaque strings, not numbers. Frames split across read chunks
 * at any byte, so the reader decodes once at the source and buffers the
 * partial tail until the next chunk.
 *
 * The protocol is bidirectional. After `session/resume` the server asks the
 * client questions (runtime preferences) and BLOCKS until answered, so a
 * server-originated request with an `id` MUST get some reply. Known requests
 * get their safe answer (see SAFE_REPLIES); anything we do not know is
 * answered with a method-not-found error so zcode fails the request visibly
 * instead of hanging — never silence, never a default-allow.
 */

interface PendingEntry {
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export type ZcodeRequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>;

export interface ZcodeJsonRpcOptions {
  onNotification: (method: string, params: unknown) => void;
  /** Fired once when the stream ends, errors, or the client is disposed. */
  onDisconnect?: () => void;
  /** Handles server→client requests after the adapter has subscribed. */
  onRequest?: ZcodeRequestHandler;
  /** Safe-reply deadline for a server request. */
  requestTimeoutMs?: number;
}

export interface ZcodeJsonRpc {
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  /** Replace the notification handler (the adapter installs its own post-handshake). */
  setNotificationHandler(handler: (method: string, params: unknown) => void): void;
  setRequestHandler(handler?: ZcodeRequestHandler): void;
  dispose(): void;
}

interface RpcFrame {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * Safe replies verified against the zcode.cjs schema. session/resume blocks
 * on runtime preferences; the values mirror the ZCode desktop client's own
 * defaults (MEt schema): no memory, no extra shell probing, preflight budget.
 */
const SAFE_REPLIES: Record<string, unknown> = {
  "session/requestRuntimePreferences": {
    nativeSearchEnhancementsEnabled: true,
    memoryEnabled: false,
    askUserQuestionAutoResolutionEnabled: true,
    modelContextBudgetStrategy: "preflight-v1",
  },
  // 0.16.5 asks for auth headers of its official MCP plugins before a prompt;
  // an empty header map is accepted and the plugin proceeds unauthenticated
  // (verified live — the request retries per prompt otherwise).
  "interaction/requestOfficialMcpAuthHeaders": { headers: {} },
};

const KNOWN_REQUESTS = new Set(Object.keys(SAFE_REPLIES));
const REQUEST_TIMEOUT_MS = 30_000;

export function createZcodeJsonRpc(
  stdin: { write(chunk: string | Uint8Array): boolean },
  stdout: NodeJS.ReadableStream,
  options: ZcodeJsonRpcOptions,
): ZcodeJsonRpc {
  const pending = new Map<string, PendingEntry>();
  /** Server requests whose guard timer is still live; settled on disconnect. */
  const openServerRequests = new Set<() => void>();
  let nextId = 1;
  let buffer = "";
  let disconnected = false;
  let notify = options.onNotification;
  let handleRequest = options.onRequest;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  const notifyDisconnect = () => {
    if (disconnected) return;
    disconnected = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("zcode app-server connection lost"));
    }
    pending.clear();
    // Settle in-flight server requests as well: their fallback timers (and
    // any late user reply resolving the handler) would otherwise write to
    // the dead stdin, raising an unhandled stream error in the main process.
    for (const cancel of openServerRequests) cancel();
    openServerRequests.clear();
    stdout.removeListener("data", onData);
    stdout.removeListener("end", onEnd);
    stdout.removeListener("error", onEnd);
    stdout.removeListener("close", onEnd);
    options.onDisconnect?.();
  };

  // Writing to a destroyed pipe emits 'error' with no listener — a crash —
  // so every reply path checks the flag; request() checks it on entry.
  const replyResult = (id: string | number, result: unknown) => {
    if (disconnected) return;
    stdin.write(`${JSON.stringify({ id, result })}\n`);
  };

  const replyError = (id: string | number, code: number, message: string) => {
    if (disconnected) return;
    stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  };

  const handleServerRequest = (id: string | number, method: string, params: unknown) => {
    if (!KNOWN_REQUESTS.has(method)) {
      replyError(id, -32601, `awefork does not handle ${method}`);
      return;
    }
    if (!handleRequest) {
      replyResult(id, SAFE_REPLIES[method]);
      return;
    }
    let settled = false;
    const finish = (result: unknown, error?: unknown) => {
      if (settled) return;
      settled = true;
      openServerRequests.delete(cancel);
      clearTimeout(timer);
      if (error) replyError(id, -32000, error instanceof Error ? error.message : String(error));
      else replyResult(id, result);
    };
    const timer = setTimeout(() => finish(SAFE_REPLIES[method]), requestTimeoutMs);
    // Disconnect settles the request here (the reply write is a guarded
    // no-op), so neither the timer above nor a late handler resolution can
    // reach the dead stdin.
    const cancel = () => finish(null, "zcode app-server connection lost");
    openServerRequests.add(cancel);
    Promise.resolve(handleRequest(method, params)).then(
      (result) => finish(result ?? SAFE_REPLIES[method]),
      (error) => finish(null, error),
    );
  };

  const handleLine = (line: string) => {
    if (disconnected || line.trim() === "") return;
    let frame: RpcFrame;
    try {
      frame = JSON.parse(line) as RpcFrame;
    } catch {
      // Malformed frame — drop it rather than kill the whole stream.
      return;
    }
    if (typeof frame.method === "string") {
      if (frame.id !== undefined && frame.id !== null) {
        handleServerRequest(frame.id, frame.method, frame.params ?? null);
      }
      notify(frame.method, frame.params ?? null);
      return;
    }
    // Response: zcode echoes our numeric ids verbatim.
    if (typeof frame.id !== "number") return;
    const key = String(frame.id);
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    clearTimeout(entry.timer);
    if (frame.error) {
      const detail =
        typeof frame.error.message === "string"
          ? frame.error.message
          : `zcode error ${frame.error.code ?? "unknown"}`;
      entry.reject(new Error(detail));
    } else {
      entry.resolve(frame.result ?? null);
    }
  };

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    // Feed complete lines through and keep the partial tail buffered.
    const { lines, rest } = splitLines(buffer, "");
    buffer = rest;
    for (const line of lines) handleLine(line);
  };
  const onEnd = () => notifyDisconnect();

  // Decode at the source, not per chunk: Node's string decoder keeps a
  // multi-byte character split across read chunks intact, where per-chunk
  // toString would turn both halves into U+FFFD and silently garble CJK
  // frames. Test doubles push plain EventBuffers, hence the guard.
  if (typeof stdout.setEncoding === "function") stdout.setEncoding("utf8");
  stdout.on("data", onData);
  stdout.on("end", onEnd);
  stdout.on("error", onEnd);
  stdout.on("close", onEnd);

  return {
    request<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
      if (disconnected) return Promise.reject(new Error("zcode app-server not connected"));
      const id = nextId++;
      const payload = JSON.stringify({ id, method, params: params ?? {} });
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.has(String(id))) return;
          pending.delete(String(id));
          reject(new Error(`zcode request ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(String(id), { timer, resolve: resolve as (value: unknown) => void, reject });
        // A failed write (EPIPE while the child is dying) surfaces through the
        // stream's close handler, which rejects every pending request.
        stdin.write(`${payload}\n`);
      });
    },
    setNotificationHandler(handler: (method: string, params: unknown) => void) {
      notify = handler;
    },
    setRequestHandler(handler?: ZcodeRequestHandler) {
      handleRequest = handler;
    },
    dispose() {
      notifyDisconnect();
    },
  };
}

/**
 * Pure line splitter exported for tests: complete lines pass through, a
 * trailing partial line is returned as `rest` to feed into the next chunk.
 */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim() !== ""), rest };
}
