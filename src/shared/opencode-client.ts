/**
 * Thin typed client for opencode's local HTTP API (opencode serve).
 * Only the fields awefork needs; only the fields awefork reads.
 * Talked to over fetch so it works in the Electron main process with no
 * SDK dependency and can be tested against a fake server. Endpoint paths
 * come from the agent descriptor so a renamed route is a data fix, not a
 * code fix.
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
} from "./agent-descriptor.js";
import type { ModelChoice, ModelOption, PromptAttachment } from "./types.js";

export interface OcSession {
  id: string;
  title: string;
  directory: string;
  parentID?: string;
  time: { created: number; updated: number };
}

/** Shape of GET /config/providers — only the fields awefork reads. */
interface OcProviderList {
  providers?: {
    id: string;
    name?: string;
    models?: Record<
      string,
      {
        id?: string;
        name?: string;
        variants?: Record<string, unknown>;
        capabilities?: { attachment?: boolean };
      }
    >;
  }[];
}

interface OcMessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  /** Present on assistant messages, e.g. "glm/glm-5.3-flash". */
  modelID?: string;
  /** Provider that served the model, e.g. "oc-awerouter". */
  providerID?: string;
  /** Present on assistant messages: the reasoning-effort variant the run used. */
  variant?: string;
  /** User messages record the run's model here instead of top-level modelID. */
  model?: { providerID?: string; modelID?: string; variant?: string };
  /** Present on assistant messages: {total, input, output, reasoning, cache}. */
  tokens?: { input?: number; output?: number; total?: number };
  /** Set when the run failed; `data.message` carries the human-readable reason. */
  error?: { name?: string; data?: { message?: string } };
  /** Why this assistant step stopped: "stop", "tool-calls", "length", … */
  finish?: string;
  time: { created: number; completed?: number };
}

export interface OcPart {
  type: string;
  text?: string;
  state?: string;
  tool?: string;
  filename?: string;
  /** File parts only: the mime they were sent with. */
  mime?: string;
  /** File parts only: the data URL (or remote URL) they were sent with. */
  url?: string;
}

export interface OcMessage {
  info: OcMessageInfo;
  parts: OcPart[];
}

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

/** Per-request deadline; 0 disables it (only the prompt endpoint needs that). */
export const DEFAULT_TIMEOUT_MS = 15_000;

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
   * Fire a run on POST /session/:id/message. This endpoint resolves only when
   * the whole run finishes — and unlike prompt_async it publishes the run's
   * events on /event (opencode 1.18: prompt_async publishes none), so callers
   * detach it and follow progress through the event stream. Sent without a
   * deadline: a run can legitimately outlive any timeout.
   */
  prompt(
    sessionId: string,
    text: string,
    model?: ModelChoice | null,
    attachments?: PromptAttachment[],
  ): Promise<void>;
  /**
   * POST /session/:id/summarize — fold the session's history into a summary.
   * Same contract as prompt: resolves only when the whole compaction is done
   * while the summary itself streams in on /event, so callers detach it and
   * it rides no deadline. providerID/modelID are required (no server
   * fallback); auto:false marks a user-triggered compaction.
   */
  summarize(sessionId: string, model: ModelChoice): Promise<void>;
  abort(sessionId: string): Promise<void>;
}

export function createOpencodeClient(
  baseUrl: string,
  config: { timeoutMs?: number; descriptor?: OpenCodeDescriptor } = {},
): OpencodeClient {
  const descriptor = config.descriptor ?? opencodeDescriptor();
  const url = (path: string) => `${baseUrl.replace(/\/$/, "")}${path}`;
  // Guidance names the port this client actually talks to — after dynamic
  // port discovery that often is not the historical default 4096.
  const serveHint = `opencode serve --port ${baseUrl.match(/:(\d+)\s*$/)?.[1] ?? "4096"}`;
  /** Descriptor endpoint with `{id}` / `{messageId}` filled in. */
  const endpoint = (key: keyof AgentEndpoints, params: Record<string, string> = {}): string => {
    let path = descriptor.endpoints[key];
    for (const [name, value] of Object.entries(params)) {
      path = path.replaceAll(`{${name}}`, value);
    }
    return path;
  };

  async function request<T>(
    path: string,
    init?: UndiciRequestInit,
    timeoutMs: number = config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    let response: UndiciResponse;
    // Without a deadline, a half-dead server (port open, never responding)
    // hangs the IPC call — and with it the UI — forever.
    const timer = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
    try {
      response = await undiciFetch(url(path), {
        ...init,
        signal: timer ?? init?.signal,
        // No app deadline means no transport deadline either (see agent).
        ...(timeoutMs > 0 ? {} : { dispatcher: noDeadlineAgent }),
      });
    } catch (error) {
      if (timer?.aborted) {
        throw new OpencodeApiError(
          0,
          `opencode API ${path} timed out after ${timeoutMs}ms — the server is not responding. Restart it with: ${serveHint}`,
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
      throw new OpencodeApiError(
        response.status,
        `opencode API ${path} failed: ${response.status} ${body.slice(0, 200)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    listSessions: (directory?: string) => {
      const query = new URLSearchParams({ limit: "1000" });
      if (directory) query.set("directory", directory);
      return request<OcSession[]>(`${endpoint("sessions")}?${query.toString()}`);
    },
    listProjects: () => request<OcProject[]>(endpoint("projects")),
    session: (id) => request<OcSession>(endpoint("session", { id })),
    messages: (id) => request<OcMessage[]>(endpoint("sessionMessages", { id })),
    listModels: async () => {
      // Read only ids and names — the response also carries provider secrets.
      const list = await request<OcProviderList>(endpoint("providers"));
      const options: ModelOption[] = [];
      for (const provider of list.providers ?? []) {
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
      request<OcSession>(endpoint("sessionFork", { id }), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cutMessageId ? { messageID: cutMessageId } : {}),
      }),
    createSession: (directory) => {
      const query = new URLSearchParams();
      if (directory) query.set("directory", directory);
      return request<OcSession>(`${endpoint("sessions")}?${query.toString()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    },
    deleteSession: async (id) => {
      await request(endpoint("session", { id }), { method: "DELETE" });
    },
    deleteMessage: async (id, messageId) => {
      await request(endpoint("sessionMessage", { id, messageId }), { method: "DELETE" });
    },
    renameSession: (id, title) =>
      request<OcSession>(endpoint("session", { id }), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      }),
    prompt: async (id, text, model, attachments) => {
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
      await request(
        endpoint("sessionSummarize", { id }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerID: model.providerId,
            modelID: model.modelId,
            auto: false,
          }),
        },
        0,
      );
    },
    abort: (id) => request(endpoint("sessionAbort", { id }), { method: "POST" }),
  };
}
