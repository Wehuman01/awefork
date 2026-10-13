/**
 * Thin typed client for opencode's local HTTP API. Only the fields awefork
 * needs; only the fields awefork reads. Talked to over fetch so it works in
 * the Electron main process with no SDK dependency and can be tested against
 * a fake server. Endpoint paths, the response envelope, paging, auth and body
 * recipes come from the agent descriptor so a renamed route is a data fix,
 * not a code fix.
 *
 * Two protocols are served from here: v1 (the historical `/session` API, bare
 * bodies, parts-based prompts) and v2 (the `/api` API — Basic auth, `{data}`
 * envelopes, cursor paging, text prompts whose model lives on the session).
 * Rows are returned exactly as the server sent them; the adapter is the
 * interpreter that maps them through the descriptor's field paths.
 */
import {
  Agent,
  type RequestInit as UndiciRequestInit,
  type Response as UndiciResponse,
  fetch as undiciFetch,
} from "undici";
import {
  type AgentEndpoints,
  type OpenCodeDescriptor,
  opencodeDescriptor,
  readPath,
} from "./agent-descriptor.js";
import type { ModelChoice, ModelOption, PromptAttachment } from "./types.js";

/** A session row as the server sent it; the adapter maps it via the descriptor. */
export type OcSession = Record<string, unknown>;
/** A message row as the server sent it. */
export type OcMessage = Record<string, unknown>;
/** One part row inside a message — v1's `parts[]`, v2's `content[]`. */
export type OcPart = Record<string, unknown>;

export interface OcProject {
  id: string;
  worktree: string;
}

export class OpencodeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpencodeApiError";
  }
}

/**
 * The app-level deadline fired while the server held the request. Distinct
 * from other API errors because the operation may still complete server-side
 * (a slow fork keeps copying after the client gives up) — callers reconcile
 * instead of treating it as a hard failure.
 */
export class OpencodeTimeoutError extends OpencodeApiError {
  constructor(message: string) {
    super(0, message);
    this.name = "OpencodeTimeoutError";
  }
}

/** Per-request deadline; 0 disables it (only the prompt endpoint needs that). */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fork is server-side data copying: a ~60 MB session takes ~50 s on the
 * server (measured), far past the CRUD budget above and with no event stream
 * to detach onto like prompt/summarize — the caller awaits it. Still finite
 * so a half-dead server cannot hang the awaiting IPC forever.
 */
export const FORK_TIMEOUT_MS = 120_000;

/**
 * undici's transport defaults (300s headers/body) contradict a request with
 * no app deadline: a prompt's response headers arrive only when the whole
 * run finishes, so a run past five minutes used to die client-side with a
 * bare "fetch failed" while the server kept executing it. Deadline-less
 * requests ride this agent instead; timed requests keep the defaults, which
 * sit far above any app deadline they already enforce themselves.
 */
const noDeadlineAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/** Known reasoning-effort keys, weakest to strongest; anything else sorts after. */
const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

function orderVariants(keys: string[]): string[] {
  const rank = (key: string): number => {
    const index = EFFORT_ORDER.indexOf(key);
    return index === -1 ? EFFORT_ORDER.length : index;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * undici wraps every transport failure in a bare TypeError("fetch failed");
 * the cause underneath names it (ECONNREFUSED, UND_ERR_HEADERS_TIMEOUT, …).
 */
function fetchFailureCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
    return cause.name;
  }
  return "";
}

/** One model row of v1's nested /config/providers map. */
interface OcV1ProviderModel {
  id?: string;
  name?: string;
  variants?: Record<string, unknown>;
  capabilities?: { attachment?: boolean };
}

/** One model row of v2's flat /api/model list. */
interface OcV2Model {
  id?: string;
  modelID?: string;
  providerID?: string;
  name?: string;
  variants?: { id?: string }[];
  capabilities?: { input?: string[] };
}

/** Safety stop for cursor paging: no real account pages past this. */
const MAX_PAGES = 100;

export interface OpencodeClient {
  /**
   * GET /session is scoped to the server's current project (resolved from its
   * cwd) and pages at 100. `directory` switches scope to any directory's
   * sessions regardless of project.
   */
  listSessions(directory?: string): Promise<OcSession[]>;
  listProjects(): Promise<OcProject[]>;
  /** GET /session/:id — one session's own row (the file-change recorder's project root). */
  session(sessionId: string): Promise<OcSession>;
  messages(sessionId: string): Promise<OcMessage[]>;
  listModels(): Promise<ModelOption[]>;
  /**
   * POST /session — start an empty session scoped to `directory` (the server
   * falls back to its own cwd when omitted). The response session maps through
   * the same shape as the sessions list.
   */
  createSession(directory?: string): Promise<OcSession>;
  /** Cut point is exclusive: the new session keeps messages strictly before it. */
  fork(sessionId: string, cutMessageId: string | null): Promise<OcSession>;
  /** Permanently remove a session and its messages. */
  deleteSession(sessionId: string): Promise<void>;
  /** DELETE /session/:id/message/:messageId — remove one message row. */
  deleteMessage(sessionId: string, messageId: string): Promise<void>;
  /** PATCH /session/:id — rename a session in place. */
  renameSession(sessionId: string, title: string): Promise<OcSession>;
  /**
   * Fire a run on the prompt endpoint. v1 resolves only when the whole run
   * finishes — and unlike prompt_async it publishes the run's events on /event
   * (opencode 1.18: prompt_async publishes none), so callers detach it and
   * follow progress through the event stream. v2 answers as soon as the run is
   * enqueued and streams everything on /event. Sent without a deadline: a run
   * can legitimately outlive any timeout.
   */
  prompt(
    sessionId: string,
    text: string,
    model?: ModelChoice | null,
    attachments?: PromptAttachment[],
  ): Promise<void>;
  /**
   * Fold the session's history into a summary. v1 posts the model in the body;
   * v2 takes it from the session (the client pins it first). Same contract as
   * prompt: resolves only when the whole compaction is done while the summary
   * itself streams in on /event, so callers detach it and it rides no deadline.
   */
  summarize(sessionId: string, model: ModelChoice): Promise<void>;
  abort(sessionId: string): Promise<void>;
}

export function createOpencodeClient(
  baseUrl: string,
  config: {
    timeoutMs?: number;
    /** Overrides FORK_TIMEOUT_MS — for tests; copy time scales with session
     * size, so the CRUD-level `timeoutMs` never constrains fork. */
    forkTimeoutMs?: number;
    descriptor?: OpenCodeDescriptor;
    /** Server password for the descriptor's auth scheme; absent = no auth (v1). */
    password?: string;
  } = {},
): OpencodeClient {
  const descriptor = config.descriptor ?? opencodeDescriptor();
  const url = (path: string) => `${baseUrl.replace(/\/$/, "")}${path}`;
  // Guidance names the port this client actually talks to — after dynamic
  // port discovery that often is not the historical default 4096.
  const serveHint = `opencode serve --port ${baseUrl.match(/:(\d+)\s*$/)?.[1] ?? "4096"}`;
  /** Descriptor endpoint with `{id}` / `{messageId}` filled in. */
  const endpoint = (key: keyof AgentEndpoints, params: Record<string, string> = {}): string => {
    const raw = descriptor.endpoints[key];
    if (raw === undefined) {
      throw new Error(
        `opencode descriptor has no endpoint "${key}" (protocol ${descriptor.protocol})`,
      );
    }
    let path = raw;
    for (const [name, value] of Object.entries(params)) {
      path = path.replaceAll(`{${name}}`, value);
    }
    return path;
  };
  /** Basic auth header for the descriptor's scheme; v1 sends none. */
  const authHeaders = (): Record<string, string> => {
    const auth = descriptor.auth;
    if (!auth || config.password === undefined) return {};
    const token = Buffer.from(`${auth.username}:${config.password}`).toString("base64");
    return { authorization: `Basic ${token}` };
  };
  /**
   * Unwrap a response body: v2 wraps payloads in `{data: …}` except for the
   * endpoints its descriptor lists as bare. v1 answers unwrapped.
   */
  const unwrap = (json: unknown, key: keyof AgentEndpoints): unknown => {
    const envelope = descriptor.envelope;
    if (!envelope || envelope.bare.includes(key)) return json;
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return (json as Record<string, unknown>)[envelope.dataKey];
    }
    return json;
  };

  async function request<T>(
    path: string,
    init?: UndiciRequestInit,
    timeoutMs: number = config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    /** Replaces the default "restart the server" guidance when a timeout on
     * this request means "the server may still finish it" (fork). */
    timeoutHint?: string,
    /** Endpoint key the path belongs to — drives envelope/paging policy. */
    endpointKey?: keyof AgentEndpoints,
  ): Promise<T> {
    let response: UndiciResponse;
    // Without a deadline, a half-dead server (port open, never responding)
    // hangs the IPC call — and with it the UI — forever.
    const timer = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
    try {
      response = await undiciFetch(url(path), {
        ...init,
        signal: timer ?? init?.signal,
        headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
        // No app deadline means no transport deadline either (see agent).
        ...(timeoutMs > 0 ? {} : { dispatcher: noDeadlineAgent }),
      });
    } catch (error) {
      if (timer?.aborted) {
        throw new OpencodeTimeoutError(
          `opencode API ${path} timed out after ${timeoutMs}ms — ${
            timeoutHint ?? `the server is not responding. Restart it with: ${serveHint}`
          }`,
        );
      }
      const causeCode = fetchFailureCode(error);
      if (causeCode === "UND_ERR_HEADERS_TIMEOUT" || causeCode === "UND_ERR_BODY_TIMEOUT") {
        // The server was reached and kept the request — undici gave up on
        // it. Telling the user to restart the server here would be a lie.
        throw new OpencodeApiError(
          0,
          `opencode API ${path} was in flight longer than undici's transport timeout (${causeCode}) — the server may still be processing it; check the session before retrying.`,
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new OpencodeApiError(
        0,
        `Cannot reach opencode server at ${baseUrl} (${reason}${causeCode ? `: ${causeCode}` : ""}). Start it with: ${serveHint}`,
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 401) {
        // v2 authenticates every route; a 401 means the password this client
        // carries does not match the server it reached.
        throw new OpencodeApiError(
          401,
          `opencode API ${path} failed: 401 Unauthorized — the server password does not match. Restart awefork's opencode server, or stop the foreign one holding the port.`,
        );
      }
      throw new OpencodeApiError(
        response.status,
        `opencode API ${path} failed: ${response.status} ${body.slice(0, 200)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    const json: unknown = await response.json();
    return (endpointKey === undefined ? json : unwrap(json, endpointKey)) as T;
  }

  /**
   * List endpoints that page by cursor (v2). Walks pages until the server
   * stops handing out a next cursor or a page comes back empty; v1 answers
   * everything in one shot and skips this entirely. The envelope is read here
   * (not unwrapped by `request`) because the next cursor lives beside the rows.
   */
  async function requestPaged(
    path: string,
    endpointKey: keyof AgentEndpoints,
    query: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    const paging = descriptor.pagination;
    const build = (cursor: string | null): string => {
      const params = new URLSearchParams(query);
      if (paging) {
        params.set(paging.limitParam, String(paging.limits?.[endpointKey] ?? paging.limit));
        // The cursor carries the timeline order onward, so the two never ride
        // together: the server rejects the combination (InvalidCursorError).
        // Only the first page asks for the order the descriptor names —
        // without it the server defaults to newest-first, which renders the
        // conversation backwards and misreads the fork cut.
        if (cursor) params.set(paging.cursorParam, cursor);
        else if (paging.order) params.set("order", paging.order);
      } else {
        // v1's historical one-shot: a big limit, no cursor.
        params.set("limit", "1000");
      }
      const search = params.toString();
      return search ? `${path}?${search}` : path;
    };
    const rowsOf = (envelope: unknown): Record<string, unknown>[] => {
      const wrapped = descriptor.envelope && !descriptor.envelope.bare.includes(endpointKey);
      const rows = wrapped
        ? (envelope as Record<string, unknown> | null)?.[descriptor.envelope?.dataKey ?? "data"]
        : envelope;
      // A non-array answer is a foreign server on the port (any HTTP server
      // can 200 a path it does not know) — the reuse probe's shape check
      // depends on this rejecting rather than coercing to "no sessions".
      if (!Array.isArray(rows)) {
        throw new OpencodeApiError(
          200,
          `opencode API ${path} returned an unexpected shape (expected a sessions/messages array)`,
        );
      }
      return rows as Record<string, unknown>[];
    };
    const envelope = await request<unknown>(build(null));
    const rows = rowsOf(envelope);
    if (!paging) return rows;
    let cursor = readPath(envelope, paging.nextPath);
    for (let page = 1; page < MAX_PAGES && typeof cursor === "string" && cursor !== ""; page += 1) {
      const next = await request<unknown>(build(cursor));
      const page$ = rowsOf(next);
      rows.push(...page$);
      cursor = page$.length === 0 ? null : readPath(next, paging.nextPath);
    }
    return rows;
  }

  /** Pin the session's model — v2's prompt body carries none. */
  async function setSessionModel(sessionId: string, model: ModelChoice): Promise<void> {
    if (!descriptor.endpoints.sessionModel) return;
    await request(
      endpoint("sessionModel", { id: sessionId }),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: {
            id: model.modelId,
            providerID: model.providerId,
            ...(model.variant ? { variant: model.variant } : {}),
          },
        }),
      },
      undefined,
      undefined,
      "sessionModel",
    );
  }

  /**
   * v2's prompt files: the data URL itself is the `uri` — the server
   * materializes a `data:` uri into the inline attachment (mime sniffed from
   * it), which is why the body carries no mime or source of its own.
   */
  const promptFiles = (attachments: PromptAttachment[] | undefined): unknown[] | undefined => {
    if (!attachments || attachments.length === 0) return undefined;
    return attachments.map((a) => ({ uri: a.dataUrl, name: a.filename }));
  };

  return {
    listSessions: (directory?: string) => {
      const query: Record<string, string> = {};
      if (directory) query.directory = directory;
      return requestPaged(endpoint("sessions"), "sessions", query) as Promise<OcSession[]>;
    },
    listProjects: async () => {
      const rows = await request<unknown>(
        endpoint("projects"),
        undefined,
        undefined,
        undefined,
        "projects",
      );
      const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
      if (descriptor.protocol === "v2") {
        // v2 spells the worktree `canonical`.
        return list.map((row) => ({
          id: typeof row.id === "string" ? row.id : "",
          worktree: typeof row.canonical === "string" ? row.canonical : "",
        }));
      }
      return list as unknown as OcProject[];
    },
    session: (id) =>
      request<OcSession>(endpoint("session", { id }), undefined, undefined, undefined, "session"),
    messages: (id) =>
      requestPaged(endpoint("sessionMessages", { id }), "sessionMessages", {}) as Promise<
        OcMessage[]
      >,
    listModels: async () => {
      // Read only ids and names — the response also carries provider secrets.
      // `request` already unwrapped the envelope, so this is the payload.
      const list = await request<unknown>(
        endpoint("providers"),
        undefined,
        undefined,
        undefined,
        "providers",
      );
      const options: ModelOption[] = [];
      if (descriptor.protocol === "v2") {
        // Flat list; every row names its own provider. Attachment support is
        // a media question, so it reads off the accepted input modalities.
        for (const model of (Array.isArray(list) ? list : []) as OcV2Model[]) {
          const modelId = model.modelID || model.id || "";
          if (!modelId) continue;
          options.push({
            providerId: model.providerID ?? "",
            providerName: model.providerID ?? "",
            modelId,
            modelName: model.name || modelId,
            variants: orderVariants((model.variants ?? []).map((v) => v.id ?? "")),
            attachment: (model.capabilities?.input ?? []).includes("image"),
          });
        }
        return options;
      }
      const providers =
        ((list as { providers?: unknown })?.providers as
          | { id: string; name?: string; models?: Record<string, OcV1ProviderModel> }[]
          | undefined) ?? [];
      for (const provider of providers) {
        for (const [key, model] of Object.entries(provider.models ?? {})) {
          const id = model.id || key;
          options.push({
            providerId: provider.id,
            providerName: provider.name || provider.id,
            modelId: id,
            modelName: model.name || id,
            variants: orderVariants(Object.keys(model.variants ?? {})),
            attachment: model.capabilities?.attachment === true,
          });
        }
      }
      return options.filter((o) => o.modelId);
    },
    fork: (id, cutMessageId) =>
      request<OcSession>(
        endpoint("sessionFork", { id }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(cutMessageId ? { [descriptor.fork.cutParam]: cutMessageId } : {}),
        },
        config.forkTimeoutMs ?? FORK_TIMEOUT_MS,
        // A timed-out fork is often still copying on the server; restarting it
        // or retrying blind each spawn another 60 MB copy of the same session.
        "the server may still be copying the session — refresh the session list and confirm no fork appeared before retrying",
        "sessionFork",
      ),
    createSession: (directory) => {
      const directoryIn = descriptor.sessions.create?.directoryIn ?? "query";
      const body =
        directoryIn === "body"
          ? JSON.stringify(directory ? { location: { directory } } : {})
          : "{}";
      const query = new URLSearchParams();
      if (directory && directoryIn === "query") query.set("directory", directory);
      const suffix = query.toString();
      return request<OcSession>(
        `${endpoint("sessions")}${suffix ? `?${suffix}` : ""}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
        undefined,
        undefined,
        "sessions",
      );
    },
    deleteSession: async (id) => {
      await request(
        endpoint("session", { id }),
        { method: "DELETE" },
        undefined,
        undefined,
        "session",
      );
    },
    deleteMessage: async (id, messageId) => {
      await request(
        endpoint("sessionMessage", { id, messageId }),
        { method: "DELETE" },
        undefined,
        undefined,
        "sessionMessage",
      );
    },
    renameSession: (id, title) =>
      request<OcSession>(
        endpoint("session", { id }),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        },
        undefined,
        undefined,
        "session",
      ),
    prompt: async (id, text, model, attachments) => {
      const recipe = descriptor.prompt;
      if (recipe?.setModelFirst && model) await setSessionModel(id, model);
      if (recipe && recipe.style === "text") {
        const files = promptFiles(attachments);
        await request(
          endpoint("sessionPrompt", { id }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text,
              ...(files ? { files } : {}),
            }),
          },
          0,
          undefined,
          "sessionPrompt",
        );
        return;
      }
      await request(
        endpoint("sessionMessages", { id }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // File parts first, text last — the order opencode's own clients send.
            parts: [
              ...(attachments ?? []).map((a) => ({
                type: "file",
                mime: a.mime,
                filename: a.filename,
                url: a.dataUrl,
              })),
              { type: "text", text },
            ],
            ...(model ? { model: { providerID: model.providerId, modelID: model.modelId } } : {}),
            ...(model?.variant ? { variant: model.variant } : {}),
          }),
        },
        0,
      );
    },
    summarize: async (id, model) => {
      const recipe = descriptor.prompt;
      if (recipe?.setModelFirst && model) await setSessionModel(id, model);
      const modelInBody = recipe?.modelInBody ?? true;
      await request(
        endpoint("sessionSummarize", { id }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            modelInBody
              ? { providerID: model.providerId, modelID: model.modelId, auto: false }
              : {},
          ),
        },
        0,
        undefined,
        "sessionSummarize",
      );
    },
    abort: (id) =>
      request(
        endpoint("sessionAbort", { id }),
        { method: "POST" },
        undefined,
        undefined,
        "sessionAbort",
      ),
  };
}
