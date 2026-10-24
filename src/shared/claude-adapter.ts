import { canonicalizeSessionDirectories } from "./canonical-paths.js";
import { withInlineFiles } from "./inline-attachments.js";
import { readDetachedExportIds, recordFork, removeFork } from "./lineage-store.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentInteractionRequest,
  ChatMessage,
  ModelOption,
  PromptAttachment,
  SessionSummary,
} from "./types.js";

/**
 * Claude Code implementation of AgentAdapter.
 *
 * Transport: each prompt spawns a `claude -p --input-format stream-json
 * --output-format stream-json --include-partial-messages` child and speaks
 * newline JSON on its stdin/stdout (bidirectional control frames answer
 * permission asks and drive interrupt). The child is pooled per session and
 * reaped after a quiet window, exactly like the pi backend's RPC children.
 * Session history is NOT read from the child — it is parsed from the
 * append-only JSONL transcripts under `$CLAUDE_CONFIG_DIR/projects/<encoded
 * cwd>/<sessionId>.jsonl`, so browsing never starts a process.
 *
 * Entry grammar (verified against 2.1.236):
 *  - user/assistant rows thread by `uuid`/`parentUuid`; `isSidechain: true`
 *    marks subagent work and stays out of the visible branch. The active
 *    branch is the parent chain of the LAST non-sidechain row.
 *  - `type:"summary"` rows name a compacted session (`leafUuid` → title).
 *  - a compact boundary is a user row whose content is the string
 *    `"This session is being continued from a previous conversation…"`
 *  - tool activity rides assistant `tool_use` blocks and user `tool_result`
 *    blocks; file writes carry `file_path` on the tool_use input.
 *
 * Wire frames (child stdout):
 *  - `system/init` names the session id; `assistant` carries a complete
 *    message; `stream_event/content_block_delta` carries token deltas;
 *  - `control_request` asks back: `can_use_tool` (permissions), `interrupt`
 *    is the reverse direction; `result` settles the run.
 *  - `--permission-prompt-tool stdio` is what makes permission asks surface
 *    as `can_use_tool` frames instead of silently denying (the standalone
 *    CLI has no SDK canUseTool callback, this flag is its equivalent).
 *
 * Sessions are file-backed: awefork assigns the UUID for createSession/fork
 * (`--session-id`), and the transcript file only appears once the first
 * prompt ran. Until then the session is awefork-side state (the pending map
 * below), which listSessions merges over the store scan.
 */

/** Main substitutes this placeholder with the resolved spawn command. */
export const CLAUDE_SPAWN_SENTINEL = "__CLAUDE_SPAWN__";

/** An idle prompt child (no run in flight) is reaped after this quiet window. */
export const CLAUDE_IDLE_MS = 120_000;

const COMPACT_BOUNDARY_PREFIX = "This session is being continued from a previous conversation";

const MODEL_CATALOG: readonly ModelOption[] = [
  {
    providerId: "claude",
    providerName: "Claude",
    modelId: "default",
    modelName: "Default model",
    variants: [],
    attachment: true,
  },
  {
    providerId: "claude",
    providerName: "Claude",
    modelId: "opus",
    modelName: "Opus (latest)",
    variants: [],
    attachment: true,
  },
  {
    providerId: "claude",
    providerName: "Claude",
    modelId: "sonnet",
    modelName: "Sonnet (latest)",
    variants: [],
    attachment: true,
  },
  {
    providerId: "claude",
    providerName: "Claude",
    modelId: "haiku",
    modelName: "Haiku (latest)",
    variants: [],
    attachment: true,
  },
];

/** One content block of a transcript message, JSON-decoded. */
interface ClaudeBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  tool_use_id?: unknown;
  file_path?: unknown;
  path?: unknown;
  notebook_path?: unknown;
  command?: unknown;
  description?: unknown;
  usage?: unknown;
}

/** A user/assistant transcript row. */
interface ClaudeRow {
  type: string;
  uuid?: unknown;
  parentUuid?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  sessionId?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
    model?: unknown;
    usage?: Record<string, unknown> | null;
    stop_reason?: unknown;
  } | null;
}

interface ParsedTranscript {
  file: string;
  rows: ClaudeRow[];
  cwd: string | null;
}

/** A live control request awaiting the host's answer. */
interface PendingAsk {
  kind: "permission";
  requestId: string;
  sessionId: string | null;
  toolName: string;
  input: Record<string, unknown>;
}

/** The child-process seam main wires in; shared/ stays free of node imports. */
export interface ClaudeChild {
  /** Send one frame to the child's stdin. */
  send(frame: Record<string, unknown>): void;
  setEventHandler(handler: (frame: Record<string, unknown>) => void): void;
  onExit(handler: (detail: string) => void): void;
  kill(): void;
}

export interface ClaudeAdapterNodeSeams {
  /**
   * Spawn one prompt child for a session: `sessionId` names the transcript,
   * `cwd` the working directory, and `resumeParent` — set for a pending
   * fork/export copy — makes the child materialize that copy in one step
   * (`--resume <parent> --fork-session`). argv/env are main's business.
   */
  spawnChild(sessionId: string, cwd: string, resumeParent?: string): Promise<ClaudeChild>;
  /**
   * Spawn a child that RESUMES an existing session (no new id) — the only
   * shape in which the CLI executes the /compact slash command. Returns the
   * child plus the CLI's own verdict once it settles.
   */
  spawnCompactChild?(sessionId: string, cwd: string): Promise<ClaudeChild>;
  /** Absolute paths of every session transcript under the store. */
  listTranscriptFiles(): Promise<string[]>;
  /** Raw UTF-8 text of one transcript file. */
  readTranscript(path: string): Promise<string>;
  /** The store root's project directories, best-effort (missing = empty). */
  projectDirs(): Promise<string[]>;
}

export interface ClaudeAdapterOptions extends ClaudeAdapterNodeSeams {
  lineagePath: string;
  now?: () => number;
}

export function createClaudeAdapter(options: ClaudeAdapterOptions): AgentAdapter {
  const { lineagePath, now = () => Date.now() } = options;
  let emitEvent: ((event: AgentEvent) => void) | null = null;
  /** sessionId → its pooled live prompt child. */
  const sessions = new Map<string, ClaudeChild>();
  /** sessionId → a spawn still in flight, so racing prompts share one child. */
  const spawning = new Map<string, Promise<ClaudeChild>>();
  /** sessionId → pending idle-reap timer. */
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** awefork-assigned ids whose transcript does not exist yet: id → cwd. */
  const pending = new Map<string, string>();
  /** In-flight permission asks awaiting respondInteraction. */
  const pendingAsks = new Map<string, PendingAsk>();
  /**
   * Latest tool_use per session for can_use_tool correlation: the ask frame
   * names the tool but the dialog's command line comes from the input the
   * matching tool call carried.
   */
  const lastToolBySession = new Map<string, { tool: string; input: Record<string, unknown> }>();
  /**
   * Sessions with a run in flight: set at prompt acceptance, cleared on the
   * child's `result` frame. message.started/idle bookkeeping rides it.
   */
  const running = new Set<string>();
  /** Transcript cache: path → {mtimeMs, parsed}; invalidated on mutations. */
  const transcriptCache = new Map<string, { parsed: ParsedTranscript }>();
  /** Cached detached-export ids so mapSession can scrub their fork links. */
  let detached: ReadonlySet<string> = new Set();

  const emit = (event: AgentEvent) => emitEvent?.(event);

  /** Fork/export targets whose copy args ride the spawn: id → parent id. */
  const pendingResume = new Map<string, string>();

  const cancelReap = (sessionId: string): void => {
    const timer = idleTimers.get(sessionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    idleTimers.delete(sessionId);
  };

  const scheduleReap = (sessionId: string): void => {
    cancelReap(sessionId);
    const timer = setTimeout(() => {
      idleTimers.delete(sessionId);
      const child = sessions.get(sessionId);
      if (!child) return;
      sessions.delete(sessionId);
      child.kill();
    }, CLAUDE_IDLE_MS);
    (timer as { unref?: () => void }).unref?.();
    idleTimers.set(sessionId, timer);
  };

  // ── transcript reading ────────────────────────────────────────────────

  const isBlock = (b: unknown): b is ClaudeBlock =>
    typeof b === "object" && b !== null && !Array.isArray(b);

  const rowOf = (value: unknown): ClaudeRow | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as ClaudeRow)
      : null;

  /**
   * Parse one transcript. EVERY uuid-bearing row joins the chain map — claude
   * inserts `attachment`/`system` rows into the parent chain, so keeping only
   * user/assistant rows would break the walk at the first attachment (an
   * assistant row's parentUuid points at it). Rendering still filters.
   */
  const parseTranscript = async (file: string): Promise<ParsedTranscript> => {
    let text: string;
    try {
      text = await options.readTranscript(file);
    } catch {
      return { file, rows: [], cwd: null };
    }
    const rows: ClaudeRow[] = [];
    let cwd: string | null = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const row = rowOf(parsed);
      if (!row) continue;
      if (typeof row.cwd === "string" && cwd === null) cwd = row.cwd;
      // The chain map needs every linked row; only message rows render.
      if (typeof row.uuid === "string") rows.push(row);
    }
    return { file, rows, cwd };
  };

  /** True for the rows the conversation renders (attachment rows chain but don't show). */
  /** True on claude's post-compaction continuation row (the fold marker). */
  const isBoundaryRow = (row: ClaudeRow): boolean =>
    row.type === "user" &&
    typeof row.message?.content === "string" &&
    (row.message.content as string).startsWith(COMPACT_BOUNDARY_PREFIX);

  /**
   * True for the rows the conversation renders. Attachment rows chain but
   * don't show, and neither does the /compact slash-command plumbing (a
   * command line plus its stdout) — those carry no user intent.
   */
  const isMessageRow = (row: ClaudeRow): boolean => {
    if (row.type !== "user" && row.type !== "assistant") return false;
    const content = row.message?.content;
    if (typeof content !== "string") return true;
    return (
      !content.startsWith("<command-name>/compact") &&
      !content.startsWith("<local-command-stdout>") &&
      !content.startsWith("<local-command-caveat")
    );
  };

  /**
   * The visible branch: the parent chain of the LAST non-sidechain message
   * row. Sibling chains (earlier turns cut off by edits, other subagents)
   * stay out, same rule as the pi adapter's active-branch walk. Chain-only
   * rows (attachments, system notes) are walked through, never rendered.
   */
  const activeBranch = (rows: ClaudeRow[]): ClaudeRow[] => {
    const byUuid = new Map<string, ClaudeRow>();
    const indexOf = new Map<ClaudeRow, number>();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      indexOf.set(row, i);
      const uuid = typeof row.uuid === "string" ? row.uuid : null;
      if (uuid) byUuid.set(uuid, row);
    }
    let leaf: ClaudeRow | null = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row === undefined || row.isSidechain === true) continue;
      if (!isMessageRow(row)) continue;
      leaf = row;
      break;
    }
    if (!leaf) return [];
    const path: ClaudeRow[] = [];
    const seen = new Set<string>();
    let sawBoundary = false;
    let current: ClaudeRow | null = leaf;
    while (current) {
      if (isMessageRow(current)) path.push(current);
      if (isBoundaryRow(current)) sawBoundary = true;
      const parentUuid: string | null =
        typeof current.parentUuid === "string" ? current.parentUuid : null;
      const parent: ClaudeRow | undefined = parentUuid ? byUuid.get(parentUuid) : undefined;
      if (parent && parentUuid && !seen.has(parentUuid)) {
        seen.add(parentUuid);
        current = parent;
        continue;
      }
      // Chain end. A compaction boundary is the CLI's stitch point: /compact
      // folds the history and starts a fresh chain (boundary → summary),
      // leaving the pre-fold conversation as a separate chain EARLIER in the
      // file. Splice that chain in as the prefix so history stays visible —
      // the same keep-the-transcript contract opencode's compaction has. A
      // plain `--resume` never lands here (its chain above the boundary row
      // is intact), so the splice cannot double-count.
      if (sawBoundary) {
        const breakIndex: number = indexOf.get(current) ?? 0;
        let stitch: ClaudeRow | null = null;
        for (let i: number = breakIndex - 1; i >= 0; i -= 1) {
          const row: ClaudeRow | undefined = rows[i];
          if (row === undefined || row.isSidechain === true) continue;
          if (!isMessageRow(row)) continue;
          const uuid = typeof row.uuid === "string" ? row.uuid : null;
          if (uuid && seen.has(uuid)) continue;
          stitch = row;
          break;
        }
        if (stitch) {
          const uuid = typeof stitch.uuid === "string" ? stitch.uuid : null;
          if (uuid) seen.add(uuid);
          current = stitch;
          continue;
        }
      }
      break;
    }
    return path.reverse();
  };

  const contentBlocks = (row: ClaudeRow): ClaudeBlock[] => {
    const content = row.message?.content;
    if (typeof content === "string") return [{ type: "text", text: content }];
    if (!Array.isArray(content)) return [];
    return content.filter(isBlock);
  };

  const blockText = (blocks: ClaudeBlock[], kind: "text" | "thinking"): string =>
    blocks
      .filter((b) => b.type === kind)
      .map((b) => (kind === "thinking" ? b.thinking : b.text))
      .filter((value): value is string => typeof value === "string")
      .join("\n\n")
      .trim();

  const filePathOfTool = (input: Record<string, unknown> | undefined | null): string | null => {
    if (!input) return null;
    for (const key of ["file_path", "path", "notebook_path"]) {
      const value = input[key];
      if (typeof value === "string" && value !== "") return value;
    }
    return null;
  };

  const msOf = (value: unknown): number | null => {
    if (typeof value !== "string" || value === "") return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  };

  const contextTokensOf = (usage: Record<string, unknown> | null | undefined): number | null => {
    if (!usage) return null;
    let sum = 0;
    let seen = false;
    for (const key of [
      "input_tokens",
      "output_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ]) {
      const value = usage[key];
      if (typeof value === "number" && value >= 0) {
        sum += value;
        seen = true;
      }
    }
    return seen ? sum : null;
  };

  const outputTokensOf = (usage: Record<string, unknown> | null | undefined): number | null => {
    const value = usage?.output_tokens;
    return typeof value === "number" ? value : null;
  };

  const mapRows = (rows: ClaudeRow[]): ChatMessage[] => {
    const branch = activeBranch(rows);
    const messages: ChatMessage[] = [];
    for (let i = 0; i < branch.length; i += 1) {
      const row = branch[i];
      if (!row) continue;
      if (row.isMeta === true) continue;
      const blocks = contentBlocks(row);
      const role = row.message?.role === "assistant" ? "assistant" : "user";
      const text = blockText(blocks, "text");
      const stringContent =
        typeof row.message?.content === "string" ? (row.message.content as string) : null;
      const compactBoundary = isBoundaryRow(row);
      // The /compact slash command and its stdout are awefork's own plumbing:
      // they carry no user intent, so they never render as turns.
      const slashPlumbing =
        role === "user" &&
        stringContent !== null &&
        (stringContent.startsWith("<command-name>/compact") ||
          stringContent.startsWith("<local-command-stdout>") ||
          stringContent.startsWith("<local-command-caveat>"));
      if (slashPlumbing) continue;
      const createdAt = msOf(row.timestamp) ?? 0;
      if (role === "user") {
        const toolResults = blocks.filter((b) => b.type === "tool_result");
        if (toolResults.length > 0 && text === "" && !compactBoundary) {
          // A pure tool_result row is the second half of an assistant tool
          // call; its content already showed on the assistant row. Keep the
          // assistant's tool names, drop the pairing row.
          continue;
        }
        messages.push({
          id: typeof row.uuid === "string" ? row.uuid : `${i}-user`,
          role: "user",
          // The boundary's body is claude's continuation boilerplate, not
          // something the user wrote; the marker itself is the information.
          text: compactBoundary ? "" : text,
          thinking: "",
          toolNames: [],
          modelId: null,
          providerId: null,
          variant: null,
          attachmentNames: [],
          createdAt,
          completedAt: null,
          finish: null,
          outputTokens: null,
          error: null,
          ...(compactBoundary ? { compaction: true } : {}),
        });
        continue;
      }
      const toolNames: string[] = [];
      for (const block of blocks) {
        if (block.type !== "tool_use" || typeof block.name !== "string") continue;
        if (!toolNames.includes(block.name)) toolNames.push(block.name);
      }
      const usage = row.message?.usage ?? undefined;
      const contextTokens = contextTokensOf(usage);
      const modelId = typeof row.message?.model === "string" ? row.message.model : null;
      const finish =
        row.message?.stop_reason === "end_turn"
          ? "stop"
          : typeof row.message?.stop_reason === "string"
            ? row.message.stop_reason
            : null;
      const isEmptyAssistant =
        text === "" && blockText(blocks, "thinking") === "" && toolNames.length === 0;
      if (isEmptyAssistant) continue;
      messages.push({
        id: typeof row.uuid === "string" ? row.uuid : `${i}-assistant`,
        role: "assistant",
        text,
        thinking: blockText(blocks, "thinking"),
        toolNames,
        modelId,
        providerId: modelId !== null ? "claude" : null,
        variant: null,
        attachmentNames: [],
        createdAt,
        completedAt: createdAt,
        finish,
        outputTokens: outputTokensOf(usage),
        ...(contextTokens !== null ? { contextTokens } : {}),
        error: null,
      });
    }
    return messages;
  };

  /** The encoded-cwd project dir currently holding the given session id, or null. */
  const findTranscriptFile = async (sessionId: string): Promise<string | null> => {
    // Session ids are UUIDs, so the file name is exact and unique across the
    // store; matching the suffix avoids re-deriving the encoded-cwd dir.
    const needle = `${sessionId}.jsonl`;
    const files = await options.listTranscriptFiles();
    return files.find((file) => file.endsWith(needle)) ?? null;
  };

  const requireTranscript = async (
    sessionId: string,
  ): Promise<{ file: string; parsed: ParsedTranscript }> => {
    const file = await findTranscriptFile(sessionId);
    if (!file) {
      throw new Error(
        `claude session ${sessionId} has no transcript yet — send a prompt first, or the session was deleted`,
      );
    }
    const parsed = await parseTranscript(file);
    return { file, parsed };
  };

  const summaryOf = async (
    sessionId: string,
    parsed: ParsedTranscript,
    overrides?: Partial<SessionSummary>,
  ): Promise<SessionSummary> => {
    const branch = activeBranch(parsed.rows);
    const last = branch[branch.length - 1];
    const updatedAt = msOf(last?.timestamp) ?? now();
    const first = branch[0];
    const createdAt = msOf(first?.timestamp) ?? updatedAt;
    const record = (await readLineageEntry(sessionId)) ?? undefined;
    const summary: SessionSummary = {
      id: sessionId,
      title: await titleOf(sessionId, parsed),
      directory: parsed.cwd ?? "",
      parentSessionId: record?.parentId ?? null,
      origin: record ? "fork" : "root",
      createdAt,
      updatedAt,
      ...overrides,
    };
    return summary;
  };

  const titleOf = async (sessionId: string, parsed: ParsedTranscript): Promise<string> => {
    void sessionId;
    // A summary row naming this session's leaf is claude's own title.
    for (const line of (await options.readTranscript(parsed.file)).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsedLine: unknown;
      try {
        parsedLine = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const row = rowOf(parsedLine);
      if (row?.type !== "summary") continue;
      const extras = row as unknown as { summary?: unknown; leafUuid?: unknown };
      const title = typeof extras.summary === "string" ? extras.summary : null;
      const leafUuid = typeof extras.leafUuid === "string" ? extras.leafUuid : null;
      if (title) return title;
    }
    const branch = activeBranch(parsed.rows);
    for (const row of branch) {
      const blocks = contentBlocks(row);
      const text = blockText(blocks, "text");
      if (row.message?.role === "user" && text && !text.startsWith(COMPACT_BOUNDARY_PREFIX)) {
        return text.length > 60 ? `${text.slice(0, 60)}…` : text;
      }
    }
    return "(untitled session)";
  };

  const readLineageEntry = async (sessionId: string): Promise<{ parentId: string } | null> => {
    // Cheap per-call read: the lineage file is tiny and writes are rare.
    const { readLineage } = await import("./lineage-store.js");
    const map = await readLineage(lineagePath);
    const record = map[sessionId];
    return record ? { parentId: record.parentId } : null;
  };

  const listStoreSessions = async (): Promise<SessionSummary[]> => {
    detached = await readDetachedExportIds(lineagePath);
    const files = await options.listTranscriptFiles();
    const summaries: SessionSummary[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const base = file.split("/").pop() ?? "";
      if (!base.endsWith(".jsonl")) continue;
      const id = base.slice(0, -".jsonl".length);
      if (seen.has(id)) continue;
      seen.add(id);
      const parsed = await parseTranscript(file);
      if (parsed.rows.length === 0) continue;
      const summary = await summaryOf(id, parsed);
      if (detached.has(id)) {
        summaries.push({ ...summary, origin: "root", parentSessionId: null });
        continue;
      }
      summaries.push(summary);
    }
    return summaries;
  };

  // ── child plumbing ────────────────────────────────────────────────────

  const ensureChild = async (sessionId: string, cwd: string): Promise<ClaudeChild> => {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const inFlight = spawning.get(sessionId);
    if (inFlight) return inFlight;
    const promise = options
      .spawnChild(sessionId, cwd, pendingResume.get(sessionId))
      .then((child) => {
        sessions.set(sessionId, child);
        child.setEventHandler((frame) => handleFrame(sessionId, frame));
        child.onExit((detail) => {
          sessions.delete(sessionId);
          if (running.has(sessionId)) {
            running.delete(sessionId);
            emit({ type: "server.error", sessionId, message: `claude exited: ${detail}` });
            emit({ type: "session.idle", sessionId });
          }
        });
        return child;
      })
      .finally(() => spawning.delete(sessionId));
    spawning.set(sessionId, promise);
    return promise;
  };

  const settleRun = (sessionId: string): void => {
    running.delete(sessionId);
    scheduleReap(sessionId);
    emit({ type: "session.idle", sessionId });
  };

  const handleFrame = (sessionId: string, frame: Record<string, unknown>): void => {
    const type = frame.type;
    if (type === "system" && frame.subtype === "init") {
      // The child confirms the session id; nothing to reconcile — awefork
      // picked it via --session-id.
      return;
    }
    if (type === "control_request") {
      handleControlRequest(sessionId, frame);
      return;
    }
    if (type === "assistant") {
      const messageId =
        typeof (frame as { uuid?: unknown }).uuid === "string"
          ? (frame as { uuid: string }).uuid
          : `live-${now()}`;
      emit({ type: "message.started", sessionId, messageId });
      return;
    }
    if (type === "stream_event") {
      const event = (isBlock(frame.event) ? frame.event : {}) as Record<string, unknown>;
      if (event.type !== "content_block_delta") return;
      const delta = (isBlock(event.delta) ? event.delta : {}) as Record<string, unknown>;
      const text =
        typeof delta.text === "string"
          ? delta.text
          : typeof delta.thinking === "string"
            ? delta.thinking
            : null;
      if (!text) return;
      const kind = delta.type === "thinking_delta" ? "thinking" : "text";
      emit({
        type: "message.delta",
        sessionId,
        messageId: currentMessageId(sessionId),
        partId: typeof event.index === "number" ? `block-${event.index}` : "block-0",
        kind,
        delta: text,
      });
      return;
    }
    if (type === "result") {
      // is_error runs settle the same way (the renderer shows the error row
      // on the next reload); the run is over either way.
      settleRun(sessionId);
    }
  };

  /** The most recent live assistant uuid per session, for delta routing. */
  const liveMessageIds = new Map<string, string>();
  const currentMessageId = (sessionId: string): string => liveMessageIds.get(sessionId) ?? "live";

  const handleControlRequest = (sessionId: string, frame: Record<string, unknown>): void => {
    const request = (isBlock(frame.request) ? frame.request : {}) as Record<string, unknown>;
    if (request.subtype !== "can_use_tool") return;
    const requestId = typeof frame.request_id === "string" ? frame.request_id : null;
    if (!requestId) return;
    const toolName = typeof request.tool_name === "string" ? request.tool_name : "tool";
    const input = (isBlock(request.input) ? request.input : {}) as Record<string, unknown>;
    lastToolBySession.set(sessionId, { tool: toolName, input });
    pendingAsks.set(requestId, {
      kind: "permission",
      requestId,
      sessionId,
      toolName,
      input,
    });
    const ask: AgentInteractionRequest = {
      requestId,
      sessionId,
      kind: "command-approval",
      title: "claude.permissionTitle",
      detail: "claude.permissionDetail",
      vars: { tool: toolName },
      command: commandPreviewOf(toolName, input),
    };
    emit({ type: "interaction.requested", request: ask });
  };

  const commandPreviewOf = (tool: string, input: Record<string, unknown>): string => {
    if (tool === "Bash" && typeof input.command === "string") return input.command;
    const filePath = filePathOfTool(input);
    if (filePath) return `${tool}: ${filePath}`;
    return tool;
  };

  const permissionBodyOf = (
    response: import("./types.js").AgentInteractionResponse,
  ): Record<string, unknown> | null => {
    if (response.decision === "allow") return { behavior: "allow" };
    if (response.decision === "always") {
      // "Always" maps to a session-scoped allow rule for the tool. Claude's
      // can_use_tool reply accepts updatedPermissions with addRules; a bare
      // tool name rule covers every future call in this session.
      return {
        behavior: "allow",
        updatedPermissions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash", ruleContent: "*" }],
            destination: "session",
          },
        ],
      };
    }
    if (response.decision === "deny") {
      return { behavior: "deny", message: "awefork: denied by the user" };
    }
    return null;
  };

  // ── adapter surface ───────────────────────────────────────────────────

  /**
   * Run one `/compact` on a dedicated child that resumes the session. The CLI
   * only executes the slash command on a child that STARTED with `--resume`
   * (a pooled mid-conversation child just records the literal text), and it
   * refuses a short session with "Not enough messages to compact." — a
   * verdict that must reach the user instead of a silent no-op.
   */
  const runCompactChild = async (
    sessionId: string,
    cwd: string,
  ): Promise<{ ok: true } | { ok: false; detail: string }> => {
    if (!options.spawnCompactChild) {
      return { ok: false, detail: "this build cannot spawn a compact child" };
    }
    const child = await options.spawnCompactChild(sessionId, cwd);
    const verdict = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      let settled = false;
      const finish = (result: { ok: boolean; detail: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      child.setEventHandler((frame) => {
        if (frame.type === "result") {
          const text = typeof frame.result === "string" ? frame.result : "";
          const isError = frame.is_error === true;
          finish({
            ok: !isError && !/not enough messages/i.test(text),
            detail: text || (isError ? "compaction failed" : ""),
          });
        }
        // The compact status frame carries the CLI's own outcome code.
        if (frame.type === "system" && frame.compact_result === "failed") {
          finish({ ok: false, detail: "compaction failed" });
        }
      });
      child.onExit((detail) => finish({ ok: false, detail }));
      // Kick the slash command as the child's first frame.
      child.send({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "/compact" }] },
      });
    });
    // Let the child exit on its own: the transcript's final lines (the
    // boundary + command plumbing) are flushed on exit, and killing first
    // would race that write.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.onExit(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return verdict.ok ? { ok: true } : { ok: false, detail: verdict.detail };
  };

  const adapter: AgentAdapter = {
    kind: "claudecode",

    async listSessions() {
      const stored = await listStoreSessions();
      // Merge pending (created/forked, not yet materialized) sessions in; one
      // whose transcript now exists is already covered by `stored`.
      const merged = [...stored];
      for (const [id, cwd] of [...pending]) {
        if (stored.some((session) => session.id === id)) {
          pending.delete(id);
          continue;
        }
        merged.push({
          id,
          title: "(untitled session)",
          directory: cwd,
          parentSessionId: null,
          origin: "root",
          createdAt: now(),
          updatedAt: now(),
        });
      }
      return canonicalizeSessionDirectories(merged.sort((a, b) => b.updatedAt - a.updatedAt));
    },

    async messages(sessionId) {
      // A created/forked session has no transcript until its first prompt
      // ran; once the file lands the store is authoritative, so the pending
      // claim is resolved here instead of shadowing the real rows forever.
      const file = await findTranscriptFile(sessionId);
      if (!file) {
        if (pending.has(sessionId)) return [];
        throw new Error(
          `claude session ${sessionId} has no transcript yet — send a prompt first, or the session was deleted`,
        );
      }
      pending.delete(sessionId);
      pendingResume.delete(sessionId);
      const parsed = await parseTranscript(file);
      const rows = mapRows(parsed.rows);
      // The child appends its final assistant row on its way out; a read
      // racing that write sees the user row alone. One short re-read closes
      // the gap without a polling loop in every caller.
      if (rows.length > 0 && rows[rows.length - 1]?.role === "user") {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const again = await parseTranscript(file);
        return mapRows(again.rows);
      }
      return rows;
    },

    async messageAttachments(sessionId, messageId) {
      const { parsed } = await requireTranscript(sessionId);
      const row = parsed.rows.find((entry) => entry.uuid === messageId);
      if (!row) return [];
      const dataUrls: PromptAttachment[] = [];
      for (const block of contentBlocks(row)) {
        if (block.type !== "image") continue;
        const source = isBlock((block as { source?: unknown }).source)
          ? (block as { source: Record<string, unknown> }).source
          : null;
        const mediaType = typeof source?.media_type === "string" ? source.media_type : null;
        const data = typeof source?.data === "string" ? source.data : null;
        if (!mediaType || !data || !mediaType.startsWith("image/")) continue;
        dataUrls.push({
          mime: mediaType,
          filename: `image-${dataUrls.length + 1}.${mediaType.split("/")[1] ?? "png"}`,
          dataUrl: `data:${mediaType};base64,${data}`,
        });
      }
      return dataUrls;
    },

    async listModels() {
      return [...MODEL_CATALOG];
    },

    async createSession(directory) {
      const cwd = directory ?? "";
      const id = newId();
      pending.set(id, cwd);
      return {
        id,
        title: "(untitled session)",
        directory: cwd,
        parentSessionId: null,
        origin: "root",
        createdAt: now(),
        updatedAt: now(),
      };
    },

    async fork(sessionId, atMessageId, forkOptions) {
      // Fork is lazy: awefork assigns the new id now and the first prompt on
      // the branch runs `--resume <parent> --fork-session --session-id <id>`,
      // which materializes the copy in one step. Claude's copy is whole-
      // history (no cut-point primitive): a mid-turn fork carries the turns
      // AFTER the anchor too. The lineage record still pins the anchor so
      // the canvas places the branch correctly; the limitation is the
      // backend's, not the tree's.
      void atMessageId;
      const source = pending.has(sessionId)
        ? { cwd: pending.get(sessionId) ?? "" }
        : await (async () => {
            const { parsed } = await requireTranscript(sessionId);
            return { cwd: parsed.cwd ?? "" };
          })();
      if (forkOptions?.context === "none") {
        // Empty-context fork: a plain new session in the parent's cwd.
        const id = newId();
        pending.set(id, source.cwd);
        await recordFork(lineagePath, id, {
          parentId: sessionId,
          atMessageId,
          createdAt: now(),
          context: "none",
        });
        return {
          id,
          title: "(untitled session)",
          directory: source.cwd,
          parentSessionId: sessionId,
          origin: "fork",
          createdAt: now(),
          updatedAt: now(),
        };
      }
      const id = newId();
      // The copy inherits the parent's cwd; the resume args ride the pending
      // map through the first prompt (see prompt()).
      pendingResume.set(id, sessionId);
      pending.set(id, source.cwd);
      await recordFork(lineagePath, id, {
        parentId: sessionId,
        atMessageId,
        createdAt: now(),
      });
      return {
        id,
        title: "(untitled session)",
        directory: source.cwd,
        parentSessionId: sessionId,
        origin: "fork",
        createdAt: now(),
        updatedAt: now(),
      };
    },

    /**
     * The copy is whole-history (`--fork-session` has no cut), so a detached
     * export would still be claude-side linked only by its resume args —
     * once materialized it is a plain root session in every view. Offered:
     * opencode parity (the renderer's "copy as native session").
     */
    async exportSession(sessionId, atMessageId) {
      void atMessageId;
      const source = pending.has(sessionId)
        ? { cwd: pending.get(sessionId) ?? "" }
        : await (async () => {
            const { parsed } = await requireTranscript(sessionId);
            return { cwd: parsed.cwd ?? "" };
          })();
      const id = newId();
      pendingResume.set(id, sessionId);
      pending.set(id, source.cwd);
      await recordFork(lineagePath, id, {
        parentId: sessionId,
        atMessageId: null,
        createdAt: now(),
        detached: true,
      });
      return {
        id,
        title: "(untitled session)",
        directory: source.cwd,
        parentSessionId: null,
        origin: "root",
        createdAt: now(),
        updatedAt: now(),
      };
    },

    async deleteSession(_sessionId) {
      throw new Error(
        "claude has no whole-session delete primitive; delete the transcript file by hand",
      );
    },

    async deleteMessage() {
      throw new Error("claude has no single-message delete primitive");
    },

    async renameSession(_sessionId, _title) {
      throw new Error("claude has no rename primitive; titles derive from the first prompt");
    },

    async prompt(sessionId, text, model, attachments) {
      const cwd = pending.get(sessionId) ?? "";
      const child = await ensureChild(sessionId, cwd);
      cancelReap(sessionId);
      running.add(sessionId);
      const images = (attachments ?? []).filter((a) => a.mime.startsWith("image/"));
      const inline = (attachments ?? []).filter((a) => !a.mime.startsWith("image/"));
      const content: Record<string, unknown>[] = [
        { type: "text", text: withInlineFiles(text, inline) },
        ...images.map((image) => {
          const at = image.dataUrl.indexOf(",");
          const payload = at === -1 ? "" : image.dataUrl.slice(at + 1);
          return {
            type: "image",
            source: { type: "base64", media_type: image.mime, data: payload },
          };
        }),
      ];
      const frame: Record<string, unknown> = {
        type: "user",
        message: { role: "user", content },
      };
      if (model?.modelId && model.modelId !== "default") {
        frame.model = model.modelId;
      }
      // The fork materialization args went out with the SPAWN (main reads
      // forkPlanner when building argv); a same-session retry keeps them.
      try {
        child.send(frame);
      } catch (error) {
        running.delete(sessionId);
        const detail = error instanceof Error ? error.message : String(error);
        emit({ type: "server.error", sessionId, message: `claude prompt failed: ${detail}` });
        throw error instanceof Error ? error : new Error(detail);
      }
    },

    async respondInteraction(requestId, response) {
      const ask = pendingAsks.get(requestId);
      if (!ask) return;
      pendingAsks.delete(requestId);
      if (ask.sessionId === null) return;
      const child = sessions.get(ask.sessionId);
      if (!child) return;
      if (response.decision === "cancel" || response.decision === "answers") {
        // A permission ask has no cancel/answers shape; treat as deny.
        child.send({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: { behavior: "deny", message: "awefork: denied by the user" },
          },
        });
        return;
      }
      const body = permissionBodyOf(response);
      if (!body) return;
      // updatedInput is required-ish for allow: echo the asked input back so
      // the tool call runs unchanged.
      if (body.behavior === "allow" && !("updatedInput" in body)) {
        body.updatedInput = ask.input;
      }
      child.send({
        type: "control_response",
        response: { subtype: "success", request_id: requestId, response: body },
      });
    },

    /**
     * Fold the session's history into a summary.
     *
     * /compact is a slash command, and the CLI only executes it on a child
     * that STARTED with `--resume` (verified against 2.1.236): sending it to
     * a pooled child that is mid-conversation just records the literal text.
     * So compaction gets its own short-lived child that resumes the session
     * and sends /compact as its first frame. The boundary row and summary
     * land in the transcript; `session.compressed` announces completion.
     */
    async compress(sessionId) {
      if (!(await findTranscriptFile(sessionId))) {
        throw new Error("this session has no turns to compact yet");
      }
      const cwd = pending.get(sessionId) ?? "";
      running.add(sessionId);
      try {
        const outcome = await runCompactChild(sessionId, cwd);
        if (!outcome.ok) throw new Error(outcome.detail);
      } catch (error) {
        running.delete(sessionId);
        const detail = error instanceof Error ? error.message : String(error);
        emit({ type: "server.error", sessionId, message: `claude compact failed: ${detail}` });
        throw error instanceof Error ? error : new Error(detail);
      }
      running.delete(sessionId);
      emit({ type: "session.compressed", sessionId });
    },

    async abort(sessionId) {
      const child = sessions.get(sessionId);
      if (!child) throw new Error("this session has no turn running right now");
      child.send({
        type: "control_request",
        request_id: `awefork-interrupt-${now()}`,
        request: { subtype: "interrupt" },
      });
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
      for (const timer of idleTimers.values()) clearTimeout(timer);
      idleTimers.clear();
      for (const child of sessions.values()) child.kill();
      sessions.clear();
      spawning.clear();
      pendingAsks.clear();
    },
  };
  return adapter;
}
/** awefork assigns session ids; claude requires UUID shape for --session-id. */
function newId(): string {
  // crypto.randomUUID without node:crypto (renderer-safe).
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The spawn argv for one session: a pending fork/export copy materializes
 * through `--resume <parent> --fork-session`; everything else is a plain
 * named session. Exposed for main and tests.
 */
export function claudeSpawnArgsFor(sessionId: string, resumeParent?: string): string[] {
  if (resumeParent) return ["--resume", resumeParent, "--fork-session", "--session-id", sessionId];
  return ["--session-id", sessionId];
}
