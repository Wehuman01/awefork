import { canonicalizeSessionDirectories } from "./canonical-paths.js";
import { readLineage, recordFork } from "./lineage-store.js";
import type {
  AgentAdapter,
  AgentEvent,
  ChatMessage,
  ModelOption,
  PromptAttachment,
  SessionSummary,
} from "./types.js";

/**
 * pi implementation of AgentAdapter.
 *
 * Background: the `@mariozechner/pi-coding-agent` CLI ("pi") stores each
 * conversation as an append-only JSONL file under
 * `$PI_CODING_AGENT_DIR/sessions/<encoded-cwd>/`. Executing a prompt taps a
 * separate `pi --mode rpc` child over newline JSON, whose lifecycle this
 * adapter manages and pools. Fork/rename/create run through the SDK's
 * SessionManager once, driven by a short ESM script main executes on-node (a
 * long-lived SDK process would duplicate the RPC child). This shared module
 * imports no node built-ins: the seams below are what main wires to real
 * processes, so tests inject fakes that neither spawn a child nor touch the
 * filesystem.
 *
 * Session identity: awefork treats each session FILE as one tree node. The
 * header carries a uuid `id` that listSessions and the per-session methods
 * speak. pi addresses sessions by file path, so this adapter resolves an id
 * back to its file by scanning `listSessionFiles()` headers and caches the
 * mapping, invalidating on every mutation.
 *
 * Tree reading: entries thread by `id`/`parentId`. The active branch is the
 * chain from root to the LAST entry in the file (append order); sibling
 * branches and orphans (parentId naming a missing id) are other
 * conversations and stay out of `messages()`. model_change and
 * thinking_level_change ride the same branch, so a message's model/variant
 * come from the newest change entry before it on the path.
 *
 * Lineage: pi's own `parentSession` header points at a *path* only after a
 * branch copy. awefork's fork identity lives in its own sidecar (the lineage
 * store), keyed by the forked session id — exactly how opencode/codex work.
 */

/** Main substitutes this placeholder with the real package root inside SDK scripts. */
export const PI_SDK_IMPORT = "__PI_PACKAGE_ROOT__";

/**
 * A pure shared module has no home directory. cwd-agnostic probes (the global
 * model list) spawn their RPC child with this sentinel; main's `spawnRpc`
 * maps it to the user's home so the child lands on a real directory.
 */
export const PI_SPAWN_DEFAULT_CWD = "";

const THINKING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const STOP_REASON_TO_FINISH: Record<string, string> = {
  toolUse: "tool-calls",
  stop: "stop",
  length: "length",
};

/** A persisted entry's `message` field — the pi-ai Message union, read-only. */
interface PiMessage {
  role?: string;
  content?: unknown;
  timestamp?: number;
  model?: string;
  provider?: string;
  usage?: { output?: number };
  stopReason?: string;
  errorMessage?: string;
}

/** Any content block of a pi message once JSON-decoded. */
type PiBlock = { type?: unknown; text?: unknown; name?: unknown; thinking?: unknown };

interface PiEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: PiMessage;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  name?: string;
}

interface PiHeader {
  id?: string;
  cwd?: string;
  timestamp?: string;
}

interface ParsedSession {
  file: string;
  header: PiHeader | null;
  entries: PiEntry[];
}

/** RPC `get_available_models` data, flattened from rpc-types. */
interface PiModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  input: ("text" | "image")[];
}

export interface PiRpcProcess {
  request<T = unknown>(command: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  setEventHandler(handler: (event: unknown) => void): void;
  onExit(handler: () => void): void;
  kill(): void;
}

export interface PiAdapterNodeSeams {
  /** Absolute paths of every session jsonl under the walkable store. */
  listSessionFiles(): Promise<string[]> | string[];
  /** Raw UTF-8 text of one session file. */
  readSessionFile(path: string): Promise<string> | string;
  /** Run one ESM script on the production node, resolving its stdout. */
  runNodeScript(code: string): Promise<string>;
  /** Spawn a `pi --mode rpc` child; args exclude `--mode rpc`, cwd set by main. */
  spawnRpc(args: string[], cwd: string): Promise<PiRpcProcess>;
}

export interface PiAdapterOptions extends PiAdapterNodeSeams {
  lineagePath: string;
  now?: () => number;
}

export function createPiAdapter(options: PiAdapterOptions): AgentAdapter {
  const { lineagePath, now = () => Date.now() } = options;
  /** Installed by subscribe; prompt failures and events stream through it. */
  let emitEvent: ((event: AgentEvent) => void) | null = null;
  /** sessionId → its pooled live RPC child. */
  const sessions = new Map<string, PiRpcProcess>();

  const emit = (event: AgentEvent) => emitEvent?.(event);
  const str = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  /** Parse one file into {file, header, entries}; unreadable/malformed → empty. */
  const parseSession = async (file: string): Promise<ParsedSession> => {
    let text: string;
    try {
      text = await options.readSessionFile(file);
    } catch {
      return { file, header: null, entries: [] };
    }
    const entries: PiEntry[] = [];
    let header: PiHeader | null = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type === "session") {
        header = { id: str(parsed.id), cwd: str(parsed.cwd), timestamp: str(parsed.timestamp) };
      } else if (typeof parsed.id === "string") {
        entries.push(parsed as unknown as PiEntry);
      }
    }
    return { file, header, entries };
  };

  /** Ordered entries root → leaf; sibling branches and orphans are excluded. */
  const activeBranch = (entries: PiEntry[]): PiEntry[] => {
    if (entries.length === 0) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    // The leaf is the last entry of the file (append order). A parentId that
    // names no entry marks an orphan boundary and stops the climb as a root.
    const leaf = entries[entries.length - 1];
    if (!leaf) return [];
    const path: PiEntry[] = [];
    const seen = new Set<string>();
    let current: PiEntry | undefined = leaf;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.push(current);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return path.reverse();
  };

  const isBlock = (b: unknown): b is PiBlock =>
    typeof b === "object" && b !== null && !Array.isArray(b);

  const userTextOf = (message: PiMessage): string => {
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter(isBlock)
      .filter((b) => b.type === "text")
      .map((b) => (typeof b.text === "string" ? b.text : ""))
      .join("\n\n")
      .trim();
  };

  const blockText = (content: unknown, kind: "text" | "thinking"): string =>
    (Array.isArray(content) ? content.filter(isBlock).filter((b) => b.type === kind) : [])
      .map((b) => (kind === "text" ? b.text : b.thinking))
      .filter((v): v is string => typeof v === "string")
      .join("\n\n")
      .trim();

  const toolNamesOf = (content: unknown): string[] =>
    (Array.isArray(content) ? content.filter(isBlock).filter((b) => b.type === "toolCall") : [])
      .map((b) => (typeof b.name === "string" ? b.name : ""))
      .filter(Boolean);

  /** Map an ordered branch to ChatMessage rows, inheriting model/variant. */
  const mapBranch = (branch: PiEntry[]): ChatMessage[] => {
    const rows: ChatMessage[] = [];
    let providerId: string | null = null;
    let modelId: string | null = null;
    let variant: string | null = null;
    for (const entry of branch) {
      switch (entry.type) {
        case "model_change":
          providerId = entry.provider ?? null;
          modelId = entry.modelId ?? null;
          break;
        case "thinking_level_change":
          variant = entry.thinkingLevel ?? null;
          break;
        case "message": {
          const message = entry.message;
          if (!message || typeof message.role !== "string") break;
          // A message always sets timestamp on the wire, but a hand-written or
          // truncated file can carry none; fall back to the envelope time so
          // sort order and renderer clocks stay sane instead of collapsing to 0.
          const createdAt =
            typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
              ? message.timestamp
              : (entry.timestamp ? Date.parse(entry.timestamp) : NaN) || 0;
          if (message.role === "user") {
            rows.push({
              id: entry.id,
              role: "user",
              text: userTextOf(message),
              thinking: "",
              toolNames: [],
              modelId,
              providerId,
              variant,
              attachmentNames: [],
              createdAt,
              completedAt: null,
              finish: null,
              outputTokens: null,
              error: null,
            });
          } else if (message.role === "assistant") {
            rows.push({
              id: entry.id,
              role: "assistant",
              text: blockText(message.content, "text"),
              thinking: blockText(message.content, "thinking"),
              toolNames: toolNamesOf(message.content),
              modelId: message.model ?? modelId,
              providerId: message.provider ?? providerId,
              variant,
              attachmentNames: [],
              createdAt,
              completedAt: createdAt,
              finish: STOP_REASON_TO_FINISH[message.stopReason ?? ""] ?? null,
              outputTokens: typeof message.usage?.output === "number" ? message.usage.output : null,
              error: message.errorMessage ?? null,
            });
          }
          break;
        }
        default:
          break;
      }
    }
    return rows;
  };

  /** Summary from a parsed file, before lineage overrides. */
  const mapSession = (parsed: ParsedSession): SessionSummary => {
    let title = "(未命名会话)";
    const createdAt = parsed.header?.timestamp ? Date.parse(parsed.header.timestamp) : 0;
    let updatedAt = createdAt;
    for (const entry of parsed.entries) {
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isNaN(ts) && ts > updatedAt) updatedAt = ts;
      if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) {
        title = entry.name.trim();
      }
      if (title === "(未命名会话)" && entry.type === "message" && entry.message?.role === "user") {
        const text = userTextOf(entry.message);
        if (text) title = text.slice(0, 80);
      }
    }
    const date = createdAt || now();
    return {
      id: parsed.header?.id ?? "",
      title,
      directory: parsed.header?.cwd ?? "",
      parentSessionId: null,
      origin: "root",
      createdAt: date,
      updatedAt: updatedAt || date,
    };
  };

  /**
   * The id→file table, rebuilt lazily. `listSessionFiles` is the cheapest
   * discovery this adapter has; a store mutation flips the dirty flag.
   */
  let index = new Map<string, ParsedSession>();
  let indexed = false;
  const refreshIndex = async (): Promise<Map<string, ParsedSession>> => {
    if (indexed) return index;
    index = new Map();
    for (const file of await options.listSessionFiles()) {
      const parsed = await parseSession(file);
      const id = parsed.header?.id;
      if (id) index.set(id, parsed);
    }
    indexed = true;
    return index;
  };
  const requireSession = async (sessionId: string): Promise<ParsedSession> => {
    const found = (await refreshIndex()).get(sessionId);
    if (!found || !found.header?.id) throw new Error(`pi 会话 ${sessionId} 不存在`);
    return found;
  };

  /** Parse the JSON a one-shot SDK script prints on stdout. */
  const scriptResult = (out: string): { sessionFile: string; sessionId: string } => {
    let parsed: { sessionFile?: unknown; sessionId?: unknown };
    try {
      parsed = JSON.parse(out.trim());
    } catch {
      throw new Error(`无法解析 pi SDK 脚本输出：${out}`);
    }
    if (typeof parsed.sessionFile !== "string" || typeof parsed.sessionId !== "string") {
      throw new Error(`pi SDK 脚本未返回会话信息：${out}`);
    }
    return { sessionFile: parsed.sessionFile, sessionId: parsed.sessionId };
  };

  /**
   * Pool guard: one live RPC child per session, pruned on exit. Cwd is the
   * session's project dir so pi resolves project config. The child is handed
   * the exact session on spawn (`--session file`) — a bare `pi --mode rpc`
   * would CREATE a fresh empty session file on startup, so letting it fall
   * back to "recent session under cwd" would leak one junk file per prompt.
   */
  const ensureRpc = async (sessionId: string, file: string, cwd: string): Promise<PiRpcProcess> => {
    const proc = await options.spawnRpc(["--session", file], cwd);
    proc.onExit(() => sessions.delete(sessionId));
    proc.setEventHandler((event) => emitPiEvent(sessionId, event, emit));
    return proc;
  };

  return {
    kind: "pi",

    async listSessions() {
      const lineage = await readLineage(lineagePath);
      const table = await refreshIndex();
      const summaries: SessionSummary[] = [];
      for (const parsed of table.values()) {
        const summary = mapSession(parsed);
        const fork = lineage[summary.id];
        if (fork) {
          summary.origin = "fork";
          summary.parentSessionId = fork.parentId;
        }
        summaries.push(summary);
      }
      return canonicalizeSessionDirectories(summaries.sort((a, b) => b.updatedAt - a.updatedAt));
    },

    async messages(sessionId) {
      const found = await requireSession(sessionId);
      const content = await parseSession(found.file);
      return mapBranch(activeBranch(content.entries));
    },

    // pi stores references, not bytes, of attached images; retry prefill is
    // text-only, so the adapter hands back nothing here.
    async messageAttachments() {
      return [] as PromptAttachment[];
    },

    async listModels() {
      // The model set is global (auth/config-keyed), so any directory works;
      // a fresh child per listing keeps the pool free of stale models. `--no-
      // session` keeps the child in-memory so the probe creates no session
      // file in the store.
      const proc = await options.spawnRpc(["--no-session"], PI_SPAWN_DEFAULT_CWD);
      try {
        const data = await proc.request<{ models: PiModel[] }>({ type: "get_available_models" });
        return (data?.models ?? []).map((model) => ({
          providerId: model.provider,
          providerName: model.provider,
          modelId: model.id,
          modelName: model.name || model.id,
          variants: model.reasoning ? THINKING_LEVELS : [],
          attachment: model.input.includes("image"),
        }));
      } finally {
        proc.kill();
      }
    },

    async createSession(directory) {
      const cwd = directory ?? "";
      const out = await options.runNodeScript(createScript(PI_SDK_IMPORT, cwd));
      const { sessionId } = scriptResult(out);
      indexed = false;
      const createdAt = now();
      return {
        id: sessionId,
        title: "(未命名会话)",
        directory: cwd,
        parentSessionId: null,
        origin: "root",
        createdAt,
        updatedAt: createdAt,
      };
    },

    async fork(sessionId, atMessageId) {
      const source = await requireSession(sessionId);
      const { entries } = await parseSession(source.file);
      const leafId = forkCutLeafId(activeBranch(entries), atMessageId ?? null);
      const out = await options.runNodeScript(forkScript(PI_SDK_IMPORT, source.file, leafId));
      const { sessionId: forkedId } = scriptResult(out);
      await recordFork(lineagePath, forkedId, {
        parentId: sessionId,
        atMessageId,
        createdAt: now(),
      });
      indexed = false;
      const createdAt = now();
      const title = mapSession(await parseSession(source.file)).title;
      return {
        id: forkedId,
        title,
        directory: source.header?.cwd ?? "",
        parentSessionId: sessionId,
        origin: "fork",
        createdAt,
        updatedAt: createdAt,
      };
    },

    // A pi branch copy writes its own header with a `parentSession` path, so
    // the linkage is baked into the file and cannot be detached by awefork.
    // Per the contract a detached copy records no lineage — and since none
    // can be produced here, refuse. The renderer hides the surface anyway.
    async exportSession() {
      throw new Error("pi 不支持导出为去关联的原生会话");
    },

    async deleteSession() {
      throw new Error("pi 没有原生的整会话删除原语，请手动删除会话文件");
    },

    async deleteMessage() {
      throw new Error("pi 没有原生的单条消息删除原语");
    },

    async renameSession(sessionId, title) {
      const found = await requireSession(sessionId);
      await options.runNodeScript(renameScript(PI_SDK_IMPORT, found.file, title));
    },

    async prompt(sessionId, text, model) {
      const found = await requireSession(sessionId);
      let proc = sessions.get(sessionId);
      if (!proc) proc = await ensureRpc(sessionId, found.file, found.header?.cwd ?? "");
      sessions.set(sessionId, proc);
      try {
        if (model) {
          await proc.request({
            type: "set_model",
            provider: model.providerId,
            modelId: model.modelId,
          });
          const level = model.variant ?? null;
          if (level) await proc.request({ type: "set_thinking_level", level });
        }
        await proc.request({ type: "prompt", message: text });
      } catch (error) {
        // A request-level failure (auth, dead child) has no frame to settle
        // the run by itself; surface it with the session id so the renderer
        // settles this session — then rethrow, because the renderer arms its
        // completion watchdog only after prompt() resolves. A swallowed error
        // would leave a phantom run polling forever.
        const detail = error instanceof Error ? error.message : String(error);
        emit({ type: "server.error", sessionId, message: `pi prompt failed: ${detail}` });
        throw error instanceof Error ? error : new Error(detail);
      }
    },

    async respondInteraction() {
      throw new Error("pi 没有服务端发起的交互请求");
    },

    async abort(sessionId) {
      const proc = sessions.get(sessionId);
      // Nothing running means the idle UI's stop button has nothing to stop.
      if (!proc) throw new Error("该会话当前没有正在运行的回合");
      await proc.request({ type: "abort" });
    },

    async subscribe(handler) {
      const stopped = { flag: false };
      emitEvent = (event) => {
        if (!stopped.flag) handler(event);
      };
      return () => {
        stopped.flag = true;
        emitEvent = null;
      };
    },

    dispose() {
      emitEvent = null;
      for (const proc of sessions.values()) proc.kill();
      sessions.clear();
    },
  };
}

/**
 * The entry the clone keeps: the full turn that starts at user message
 * `atMessageId` (everything up to, but not including, the next user message),
 * or the whole session when `atMessageId` is null or is the last user turn.
 */
function forkCutLeafId(branch: PiEntry[], atMessageId: string | null): string {
  const last = branch[branch.length - 1];
  if (!last) throw new Error("会话为空，无法分叉");
  if (atMessageId === null) return last.id;
  const userIds = branch
    .filter((e) => e.type === "message" && e.message?.role === "user")
    .map((e) => e.id);
  const at = userIds.indexOf(atMessageId);
  if (at === -1) throw new Error(`会话中找不到消息 ${atMessageId}`);
  const next = userIds[at + 1];
  if (next === undefined) return last.id;
  // The next user message's parent is the final entry of the cut turn.
  const boundary = branch.find((e) => e.id === next);
  if (boundary?.parentId) return boundary.parentId;
  return last.id;
}

/** One-shot ESM program whose stdout carries {sessionFile, sessionId}. */
function createScript(root: string, cwd: string): string {
  const module = JSON.stringify(`${root}/dist/core/session-manager.js`);
  return [
    `import { SessionManager } from ${module};`,
    `const sm = SessionManager.create(${JSON.stringify(cwd)});`,
    `const sessionFile = sm.newSession();`,
    `console.log(JSON.stringify({ sessionFile, sessionId: sm.getSessionId() }));`,
  ].join("\n");
}

function forkScript(root: string, file: string, leafId: string): string {
  const module = JSON.stringify(`${root}/dist/core/session-manager.js`);
  return [
    `import { SessionManager } from ${module};`,
    `const sm = SessionManager.open(${JSON.stringify(file)});`,
    `const sessionFile = sm.createBranchedSession(${JSON.stringify(leafId)});`,
    `console.log(JSON.stringify({ sessionFile, sessionId: sm.getSessionId() }));`,
  ].join("\n");
}

function renameScript(root: string, file: string, title: string): string {
  const module = JSON.stringify(`${root}/dist/core/session-manager.js`);
  return [
    `import { SessionManager } from ${module};`,
    `const sm = SessionManager.open(${JSON.stringify(file)});`,
    `sm.appendSessionInfo(${JSON.stringify(title)});`,
  ].join("\n");
}

/** Normalize pi's agent stream onto awefork's smaller event surface. */
function emitPiEvent(sessionId: string, event: unknown, emit: (event: AgentEvent) => void): void {
  if (typeof event !== "object" || event === null) return;
  const e = event as Record<string, unknown>;
  switch (e.type) {
    case "message_start": {
      const message = e.message as Record<string, unknown> | undefined;
      if (typeof message?.id === "string") {
        emit({ type: "message.started", sessionId, messageId: message.id });
      }
      break;
    }
    case "message_update": {
      // pi streams by resending the whole assistant message; every content
      // block becomes a full snapshot so the renderer can reconcile dropped
      // frames (the deltas that would have debounced them are absent).
      const message = e.message as Record<string, unknown> | undefined;
      if (typeof message?.id !== "string" || !Array.isArray(message.content)) break;
      message.content.forEach((block, index) => {
        if (typeof block !== "object" || block === null) return;
        const b = block as Record<string, unknown>;
        // Only text/thinking blocks are renderable parts; a toolCall block has
        // no user-visible text and would otherwise emit an empty part.
        if (b.type !== "thinking" && b.type !== "text") return;
        const kind: "text" | "thinking" = b.type === "thinking" ? "thinking" : "text";
        const text =
          kind === "thinking"
            ? typeof b.thinking === "string"
              ? b.thinking
              : ""
            : typeof b.text === "string"
              ? b.text
              : "";
        emit({
          type: "message.part",
          sessionId,
          messageId: message.id as string,
          partId: `${message.id as string}:${index}`,
          kind,
          text,
          startedAt: null,
          endedAt: null,
        });
      });
      break;
    }
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      // Tool chips surface on the idle reload; poke the tree now so the
      // canvas re-walks the session and shows the chip without waiting.
      emit({ type: "session.updated", sessionId });
      break;
    case "agent_end":
      emit({ type: "session.idle", sessionId });
      emit({ type: "session.updated", sessionId });
      break;
    default:
      break;
  }
}
