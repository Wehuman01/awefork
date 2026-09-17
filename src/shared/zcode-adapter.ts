import { canonicalizeSessionDirectories } from "./canonical-paths.js";
import { recordFork } from "./lineage-store.js";
import type {
  AgentAdapter,
  AgentEvent,
  ChatMessage,
  ModelOption,
  PromptAttachment,
  SessionSummary,
} from "./types.js";

/**
 * zcode implementation of AgentAdapter, talking to a `zcode app-server`
 * child over the ZCode Protocol (newline JSON; the client lives in main —
 * see src/main/zcode-server.ts).
 *
 * Verified against zcode 0.16.5 on 2026-09. The message shape is opencode's:
 * rows carry `{info, parts}` with info.modelID/providerID/tokens.output and
 * parts typed text/reasoning/tool/file, so the mapping below reads like the
 * opencode descriptor's field table in code form.
 *
 * Fork semantics: `session/fork` with target `{kind:"message", messageId}`
 * copies the history up to AND INCLUDING that message into a new session
 * (forkedSessionId). awefork's cut — keep through the turn that starts with
 * user message atMessageId — therefore passes the LAST message of that turn.
 */

export interface ZcodeClient {
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  setNotificationHandler(handler: (method: string, params: unknown) => void): void;
  setRequestHandler?(
    handler?: (method: string, params: unknown) => unknown | Promise<unknown>,
  ): void;
}

export interface ZcodeAdapterOptions {
  /** The live client; re-spawns the app-server child when it died. */
  client(): Promise<ZcodeClient>;
  /** Fired with every fresh client after a respawn; handlers re-attach. */
  onClientReplaced(cb: (client: ZcodeClient) => void): void;
  /** Path to the lineage sidecar file (per-backend). */
  lineagePath: string;
  /**
   * Raw provider registry the desktop client pushes (zcode v2 config.json);
   * null when missing or unreadable. The app-server itself has no model
   * listing — its catalog fills only when a desktop client connects — so
   * awefork reads the same file the CLI itself configures from.
   */
  readProviderConfig?(): Promise<string | null> | string | null;
  /** Fallback workspace for createSession when the caller passes none. */
  homeDirectory?: string;
  now?: () => number;
}

interface ZcodeSessionRow {
  sessionId?: string;
  title?: string | null;
  parentSessionId?: string | null;
  sessionKind?: string | null;
  directory?: string | null;
  workspace?: { workspaceKey?: string | null; workspacePath?: string | null } | null;
  createdAt?: number;
  updatedAt?: number;
}

interface ZcodeMessage {
  info?: {
    id?: string;
    /** The resume projection spells it `messageId`; session/messages uses `id`. */
    messageId?: string;
    role?: string;
    parentID?: string | null;
    parentMessageId?: string | null;
    modelID?: string | null;
    providerID?: string | null;
    variant?: string | null;
    model?: { modelID?: string | null; providerID?: string | null; variant?: string | null } | null;
    time?: { created?: number; completed?: number | null } | null;
    tokens?: { output?: number | null } | null;
    finish?: string | null;
    error?: { message?: string; data?: { message?: string } } | null;
    /** Runtime-injected rows carry metadata with a visibility flag. */
    metadata?: { source?: string; visibility?: string } | null;
  } | null;
  parts?: Array<{
    type?: string;
    text?: string;
    tool?: string;
    filename?: string;
    /** Runtime-injected parts are flagged synthetic / model-only. */
    synthetic?: boolean;
    metadata?: { visibility?: string } | null;
  }> | null;
}

/**
 * A row the harness injected (todo reminders, background-task notices, …)
 * rather than a real user turn. The app server stores these as role:"user"
 * and stamps them model-only either on info.metadata or on a synthetic part.
 * Filter on the visibility flag, never on source strings — real user rows may
 * carry no metadata at all, so only a negative check is safe.
 */
function isModelOnly(message: ZcodeMessage): boolean {
  if (message.info?.metadata?.visibility === "model-only") return true;
  return (message.parts ?? []).some(
    (part) => part.synthetic === true || part.metadata?.visibility === "model-only",
  );
}

/** The slice of the provider registry listModels reads. */
interface ZcodeProviderModel {
  name?: string;
  reasoning?: { variants?: string[] } | null;
  modalities?: { input?: string[] } | null;
}

interface ZcodeProviderEntry {
  name?: string;
  enabled?: boolean;
  models?: Record<string, ZcodeProviderModel | null> | null;
}

interface ZcodeProviderConfig {
  provider?: Record<string, ZcodeProviderEntry | null> | null;
}

const SESSION_EVENT_METHOD = "session/event";

export function createZcodeAdapter(options: ZcodeAdapterOptions): AgentAdapter {
  const now = options.now ?? Date.now;
  let emitEvent: ((event: AgentEvent) => void) | null = null;
  /** Events stream only to a subscribed session; ensured before every send. */
  const subscribedSessions = new Set<string>();

  const emit = (event: AgentEvent) => emitEvent?.(event);

  const mapSessionRow = (row: ZcodeSessionRow): SessionSummary => {
    const kind = row.sessionKind ?? "";
    const directory = row.workspace?.workspacePath ?? row.directory ?? "";
    const parent = row.parentSessionId ?? null;
    // zcode marks its own forks and subagents on the row; awefork's lineage
    // (forks awefork cut) merges on top in the renderer.
    const origin =
      kind === "subagent_child" ? "subagent" : kind === "fork" || parent ? "fork" : "root";
    return {
      id: row.sessionId ?? "",
      title: row.title || "(未命名会话)",
      directory,
      parentSessionId: parent,
      origin,
      createdAt: row.createdAt ?? now(),
      updatedAt: row.updatedAt ?? now(),
    };
  };

  const fetchMessages = async (sessionId: string): Promise<ZcodeMessage[]> => {
    const client = await options.client();
    // Resume attaches the session to this server instance; browsing without
    // it returns zero rows (verified live). It appends a session_resumed
    // event — the price of going through the native API instead of the
    // sqlite store. Its rows are a compact projection (messageId, model{},
    // no parts), so the canonical rows come from session/messages, which
    // serves the opencode-shaped `{info, parts}` only after the attach.
    await client.request("session/resume", { sessionId }, 45_000);
    const page = await client.request<{ messages?: ZcodeMessage[] }>(
      "session/messages",
      { sessionId },
      30_000,
    );
    return page?.messages ?? [];
  };

  const promptTextOf = (parts: ZcodeMessage["parts"]): string =>
    (parts ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();

  function mapMessage(message: ZcodeMessage): ChatMessage[] {
    const info = message.info ?? {};
    const parts = message.parts ?? [];
    const rows: ChatMessage[] = [];
    // Harness-injected rows are not real user input; render nothing for them.
    if (isModelOnly(message)) return rows;
    const id = info.id ?? info.messageId ?? "";
    const createdAt = info.time?.created ?? now();
    const modelId = info.model?.modelID ?? info.modelID ?? null;
    const providerId = info.model?.providerID ?? info.providerID ?? null;
    const variant = info.model?.variant ?? info.variant ?? null;

    if (info.role === "user") {
      rows.push({
        id,
        role: "user",
        text: promptTextOf(parts),
        thinking: "",
        toolNames: [],
        modelId,
        providerId,
        variant,
        attachmentNames: (parts ?? [])
          .filter((part) => part.type === "file")
          .map((part) => part.filename ?? "附件"),
        createdAt,
        completedAt: null,
        finish: null,
        outputTokens: null,
        error: null,
      });
      return rows;
    }
    if (info.role !== "assistant") return rows;

    const text = (parts ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const thinking = (parts ?? [])
      .filter((part) => part.type === "reasoning" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const toolNames = [
      ...new Set(
        (parts ?? [])
          .map((part) => {
            if (part.type === "tool") return part.tool ?? "tool";
            if (part.type === "subagent") return "subagent";
            return null;
          })
          .filter((name): name is string => name !== null),
      ),
    ];
    const error =
      (typeof info.error?.data?.message === "string" && info.error.data.message) ||
      (typeof info.error?.message === "string" && info.error.message) ||
      null;
    // A turn whose assistant side produced nothing visible yields no row —
    // empty rows would flicker above the live stream (same as codex).
    if (text || thinking || toolNames.length > 0 || error) {
      rows.push({
        id,
        role: "assistant",
        text,
        thinking,
        toolNames,
        modelId,
        providerId,
        variant,
        attachmentNames: [],
        createdAt,
        completedAt: info.time?.completed ?? null,
        finish: info.finish === "tool-calls" ? "tool-calls" : info.finish ? "stop" : null,
        outputTokens: typeof info.tokens?.output === "number" ? info.tokens.output : null,
        error,
      });
    }
    return rows;
  }

  /** The id session/fork's `target:{kind:"message"}` keeps history through. */
  const cutMessageIdOf = (
    messages: ZcodeMessage[],
    atMessageId: string | null,
  ): { cutId: string } => {
    const rows = messages
      .filter((message) => !isModelOnly(message))
      .map((message) => message.info ?? {})
      .filter((info) => info.role === "user" || info.role === "assistant")
      .map((info) => ({ role: info.role ?? "", id: info.id ?? info.messageId ?? "" }));
    if (rows.length === 0) throw new Error("会话没有任何消息，无法分叉");
    const last = rows[rows.length - 1];
    if (!last) throw new Error("会话没有任何消息，无法分叉");
    if (!atMessageId) return { cutId: last.id };
    const anchorIndex = rows.findIndex((row) => row.id === atMessageId);
    if (anchorIndex < 0) {
      throw new Error(`未找到消息 ${atMessageId}，刷新会话后重试`);
    }
    // Keep the anchor turn whole: walk to the last assistant row before the
    // next user message. A turn with no reply yet cuts at the user row.
    // Harness-injected rows (role:"user") are filtered above so they cannot
    // truncate the walk mid-turn.
    let cutIndex = anchorIndex;
    for (let i = anchorIndex + 1; i < rows.length; i += 1) {
      if (rows[i]?.role === "user") break;
      cutIndex = i;
    }
    const cut = rows[cutIndex];
    if (!cut?.id) throw new Error("未找到可用的分叉切点，刷新会话后重试");
    return { cutId: cut.id };
  };

  const ensureSubscribed = async (sessionId: string): Promise<void> => {
    if (subscribedSessions.has(sessionId)) return;
    const client = await options.client();
    // Without this the server never pushes session/event frames for the
    // session, and a finished run would leave the renderer running forever.
    await client.request("session/subscribe", { sessionId }, 15_000);
    subscribedSessions.add(sessionId);
  };

  const attachHandlers = (client: ZcodeClient): void => {
    client.setNotificationHandler((method, params) => {
      if (method !== SESSION_EVENT_METHOD) return;
      const frame = (params ?? {}) as {
        sessionId?: string;
        type?: string;
        payload?: { turnId?: string; message?: string; error?: { message?: string } };
      };
      const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : null;
      if (!sessionId) return;
      switch (frame.type) {
        case "turn_started":
          emit({
            type: "message.started",
            sessionId,
            messageId: frame.payload?.turnId ?? "",
          });
          break;
        case "turn_complete":
          emit({ type: "session.idle", sessionId });
          emit({ type: "session.updated", sessionId });
          break;
        case "turn_error":
          emit({
            type: "server.error",
            sessionId,
            message: frame.payload?.message ?? frame.payload?.error?.message ?? "zcode 回合失败",
          });
          emit({ type: "session.idle", sessionId });
          break;
        // Title changes and fork/create/resume bookkeeping: re-read.
        case "session_title_updated":
        case "session_forked":
        case "session_created":
        case "session_mode_changed":
          emit({ type: "session.updated", sessionId });
          break;
        default:
          break;
      }
    });
    client.setRequestHandler?.(() => {
      // Preferences are answered by the transport's safe replies; the
      // adapter hook exists so future server questions surface here.
      return undefined;
    });
  };

  return {
    kind: "zcode",

    async listSessions() {
      const client = await options.client();
      const page = await client.request<{ sessions?: ZcodeSessionRow[] }>("session/list", {});
      const sessions = (page?.sessions ?? []).map(mapSessionRow);
      return canonicalizeSessionDirectories(
        sessions.filter((session) => session.id !== "").sort((a, b) => b.updatedAt - a.updatedAt),
      );
    },

    async messages(sessionId) {
      return (await fetchMessages(sessionId)).flatMap((message) => mapMessage(message));
    },

    // zcode keeps attachment bytes behind its own blob URLs; retry prefill
    // is text-only for now.
    async messageAttachments() {
      return [] as PromptAttachment[];
    },

    async listModels() {
      const raw = options.readProviderConfig ? await options.readProviderConfig() : null;
      if (!raw) return [] as ModelOption[];
      let config: ZcodeProviderConfig;
      try {
        config = JSON.parse(raw) as ZcodeProviderConfig;
      } catch {
        return [] as ModelOption[];
      }
      const models: ModelOption[] = [];
      for (const [providerId, provider] of Object.entries(config.provider ?? {})) {
        if (!provider || provider.enabled === false) continue;
        for (const [modelId, model] of Object.entries(provider.models ?? {})) {
          if (!model) continue;
          models.push({
            providerId,
            providerName: provider.name ?? providerId,
            modelId,
            modelName: model.name ?? modelId,
            variants: model.reasoning?.variants ?? [],
            attachment: model.modalities?.input?.includes("image") ?? false,
          });
        }
      }
      return models;
    },

    async createSession(directory) {
      const client = await options.client();
      const workspacePath = directory || options.homeDirectory || "";
      if (!workspacePath) throw new Error("zcode 需要一个工作目录才能新建会话");
      const created = await client.request<{ session?: ZcodeSessionRow } | ZcodeSessionRow>(
        "session/create",
        { workspace: { workspaceKey: workspacePath, workspacePath } },
        30_000,
      );
      const row =
        (created as { session?: ZcodeSessionRow })?.session ?? (created as ZcodeSessionRow);
      const summary = mapSessionRow(row ?? {});
      if (!summary.id) throw new Error("zcode session/create 未返回会话 id");
      return summary;
    },

    async fork(sessionId, atMessageId) {
      const parentMessages = await fetchMessages(sessionId);
      const { cutId } = cutMessageIdOf(parentMessages, atMessageId);
      if (!cutId) throw new Error("未找到可用的分叉切点，刷新会话后重试");
      const client = await options.client();
      const forked = await client.request<{
        forkedSessionId?: string;
        parentSessionId?: string | null;
      }>("session/fork", { sessionId, target: { kind: "message", messageId: cutId } }, 60_000);
      const forkedId = forked?.forkedSessionId;
      if (!forkedId) throw new Error("zcode session/fork 未返回新会话 id");
      const summary: SessionSummary = {
        id: forkedId,
        title: "(未命名会话)",
        directory: "",
        parentSessionId: sessionId,
        origin: "fork",
        createdAt: now(),
        updatedAt: now(),
      };
      await recordFork(options.lineagePath, forkedId, {
        parentId: sessionId,
        atMessageId,
        createdAt: summary.createdAt,
      });
      return summary;
    },

    // Fork linkage lives in zcode's own store (forkedSessionId +
    // parentSessionId), so a detached copy cannot be produced — the renderer
    // hides the export affordance (capabilities.exportBranch === false).
    async exportSession() {
      throw new Error("zcode 不支持导出独立会话");
    },

    // The app-server protocol has no delete primitives; the renderer hides
    // the affordances (capabilities.deleteSession/deleteMessage === false).
    async deleteSession() {
      throw new Error("zcode 暂不支持删除会话");
    },

    async deleteMessage() {
      throw new Error("zcode 暂不支持删除单条消息");
    },

    async renameSession() {
      throw new Error("zcode 暂不支持重命名会话");
    },

    async prompt(sessionId, text, model) {
      const client = await options.client();
      try {
        if (model?.modelId) {
          await client.request(
            "session/setModel",
            {
              sessionId,
              model: {
                providerId: model.providerId,
                modelId: model.modelId,
                ...(model.variant ? { variant: model.variant } : {}),
              },
            },
            15_000,
          );
        }
        await ensureSubscribed(sessionId);
        await client.request(
          "session/send",
          { sessionId, content: text, inputId: `awefork-${now()}` },
          20_000,
        );
      } catch (error) {
        // Request-level failures have no event; surface them with the session
        // id so the renderer settles the run — then rethrow: the renderer
        // arms its completion watchdog only after prompt() resolves, so a
        // swallowed error would leave a phantom run polling for a turn that
        // never started.
        const detail = error instanceof Error ? error.message : String(error);
        emit({
          type: "server.error",
          sessionId,
          message: detail.includes("already running")
            ? "该会话已有正在运行的回合"
            : `zcode prompt failed: ${detail}`,
        });
        throw error instanceof Error ? error : new Error(detail);
      }
    },

    async respondInteraction() {
      throw new Error("zcode 没有等待答复的交互");
    },

    async abort(sessionId) {
      const client = await options.client();
      // session/stop is the one request the server takes out-of-band while a
      // prompt runs (the protocol queues everything else).
      await client.request("session/stop", { sessionId }, 15_000);
    },

    async subscribe(handler) {
      emitEvent = handler;
      attachHandlers(await options.client());
      options.onClientReplaced((fresh) => {
        // The replaced process holds no subscriptions (it restarted), so the
        // set is stale — clear it so the next prompt re-subscribes on the
        // fresh process and session/event frames resume streaming.
        subscribedSessions.clear();
        attachHandlers(fresh);
        emit({ type: "server.reconnected" });
      });
      return () => {
        emitEvent = null;
      };
    },

    dispose() {
      emitEvent = null;
      subscribedSessions.clear();
    },
  };
}
