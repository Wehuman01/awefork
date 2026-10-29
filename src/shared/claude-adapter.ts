import { canonicalizeSessionDirectories } from "./canonical-paths.js";
import { displayName } from "./file-paths.js";
import { withInlineFiles } from "./inline-attachments.js";
import { readDetachedExportIds, readLineage, recordFork } from "./lineage-store.js";
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
 * permission asks, rename the session and drive interrupt). The child is
 * pooled per session and reaped after a quiet window, exactly like the pi
 * backend's RPC children. Session history is NOT read from the child — it is
 * parsed from the append-only JSONL transcripts under
 * `$CLAUDE_CONFIG_DIR/projects/<encoded cwd>/<sessionId>.jsonl`, so browsing
 * never starts a process.
 *
 * Continuation: the CLI only continues a transcript on a child that STARTS
 * with `--resume <id>`, and it finds the file by the cwd's encoded name — so
 * the cwd must be the transcript's own. A child named with a bare
 * `--session-id` for a session that already has a transcript starts a NEW
 * chain: the model sees no history, and the new rows land in a second project
 * directory beside the real one. Every spawn for an existing session
 * therefore resumes; `--session-id` is only for a brand-new one.
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
 *  - `result` carries `is_error` and an `errors[]` list; a run that never
 *    reached the model (no such session, bad cwd) reports only there, with
 *    nothing written to the transcript. Treating it as a normal settle made
 *    the failure invisible, so it is surfaced as a session-scoped error.
 *  - `rename_session` and `set_model` are control requests the CLI answers
 *    with `control_response`; a rename persists as a `custom-title` row, so
 *    the title survives restarts and is read back with the transcript.
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

/**
 * How long a memoized store file list stays valid. The walk is readdir-only,
 * but `findTranscriptFile` (and with it every prompt's spawn planning) pays
 * for it, so the answer is reused for a moment — and dropped the instant a
 * run can have written a file, which is the only thing that changes it.
 */
const TRANSCRIPT_LIST_TTL_MS = 1_000;

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
  /** uuid-less rows that carry a title: claude's summary and rename_session's custom-title. */
  meta: ClaudeMetaRow[];
}

/** One title-bearing row that is not part of the message chain. */
interface ClaudeMetaRow {
  kind: "summary" | "custom-title";
  title: string;
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
   * Spawn one prompt child. `plan` decides what the argv means:
   *  - `create`: a brand-new session named by `--session-id`;
   *  - `resume`: continue an existing transcript (`--resume <id>`);
   *  - `fork`: copy a parent's history through `cutUuid` into a new id.
   * `cwd` is the directory the child runs in — for resume/fork it must be the
   * transcript's own cwd, or the CLI cannot find the file to resume.
   */
  spawnChild(cwd: string, plan: ClaudeSpawnPlan): Promise<ClaudeChild>;
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
  /**
   * Optional mtime+size of one transcript file, for the parse cache. Absent
   * (tests, fakes) means every read re-parses — correct, just not memoized.
   */
  statTranscript?(path: string): Promise<{ mtimeMs: number; size: number } | null>;
  /** The store root's project directories, best-effort (missing = empty). */
  projectDirs(): Promise<string[]>;
}

/**
 * How one spawn relates to the store. A new session is named; an existing one
 * is resumed; a fork resumes a parent and materializes the copy under a new
 * id. `cutUuid` is the last chain entry to keep (see `--resume-session-at`).
 */
export type ClaudeSpawnPlan =
  | { kind: "create"; sessionId: string }
  | { kind: "resume"; sessionId: string }
  | { kind: "fork"; sessionId: string; resumeParent: string; cutUuid: string | null };

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
   * Sessions with a run in flight: set at prompt acceptance, cleared on the
   * child's `result` frame. message.started/idle bookkeeping rides it.
   */
  const running = new Set<string>();
  /**
   * Sessions whose user pressed stop: the CLI answers an interrupt with
   * `is_error` + `error_during_execution` (a diagnostic string, not a failure
   * the user should see), so that result settles as a clean stop instead.
   */
  const interruptRequested = new Set<string>();
  /** Cached detached-export ids so mapSession can scrub their fork links. */
  let detached: ReadonlySet<string> = new Set();
  /**
   * The id the run's live deltas carry. The real CLI streams a message as
   * `message_start → content_block_delta… → assistant`, so every delta arrives
   * BEFORE the frame that names the transcript row id — the id is taken from
   * `message_start` (unique per message, present before the first delta) and
   * re-aligned to the transcript uuid when the `assistant` frame lands.
   * Cleared when the run settles so a later turn can never inherit the
   * previous message's id (a completed row under a stale id silently drops
   * every delta the renderer receives for it).
   */
  const liveMessageIds = new Map<string, string>();
  /** Sessions whose current message announced itself with a `message_start`. */
  const sawMessageStart = new Set<string>();
  /** Fallback id counter for CLIs that stream no `message_start`. */
  let liveFallbackSeq = 0;
  /** Parsed transcripts keyed by file, valid while mtime+size hold. */
  const parseCache = new Map<string, { mtimeMs: number; size: number; parsed: ParsedTranscript }>();
  /** Cached store file list; dropped whenever a run can have written a file. */
  let transcriptFilesCache: { at: number; files: string[] } | null = null;
  /** Set by dispose: an in-flight spawn resolves into a killed child, not the pool. */
  let disposed = false;

  const emit = (event: AgentEvent) => emitEvent?.(event);

  /** Fork/export targets whose copy args ride the spawn: id → parent id. */
  const pendingResume = new Map<string, string>();
  /**
   * Fork targets whose copy is cut at a chain entry: id → the last uuid to
   * keep. Claude's `--resume-session-at` is the cut primitive; absent means
   * "copy the whole history".
   */
  const pendingForkCut = new Map<string, string>();

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
   * The rows that carry no uuid but do carry metadata — `summary` (claude's
   * own title after a compaction) and `custom-title` (what rename_session
   * wrote) — are kept in `meta` so a single read answers both history and
   * title.
   *
   * The parse is cached per file while its mtime+size hold: a session listing
   * walks the whole store (the overview panel re-lists every agent on a slow
   * tick), and re-reading plus re-parsing every transcript each time made
   * that O(total store bytes) per sweep. `listSessions` also merges the
   * pending (not yet materialized) sessions in, so a session whose transcript
   * does not exist yet still lists.
   */
  const parseTranscript = async (file: string): Promise<ParsedTranscript> => {
    // A cheap stat before the read: when the file has not changed since the
    // last parse, the cached parse is still the truth.
    const stamp = options.statTranscript ? await options.statTranscript(file) : null;
    if (stamp) {
      const cached = parseCache.get(file);
      if (cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) {
        return cached.parsed;
      }
    }
    let text: string;
    try {
      text = await options.readTranscript(file);
    } catch {
      return { file, rows: [], cwd: null, meta: [] };
    }
    const rows: ClaudeRow[] = [];
    const meta: ClaudeMetaRow[] = [];
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
      else {
        const extras = row as unknown as {
          type?: unknown;
          summary?: unknown;
          customTitle?: unknown;
        };
        if (extras.type === "summary" && typeof extras.summary === "string") {
          meta.push({ kind: "summary", title: extras.summary });
        } else if (extras.type === "custom-title" && typeof extras.customTitle === "string") {
          meta.push({ kind: "custom-title", title: extras.customTitle });
        }
      }
    }
    const parsed: ParsedTranscript = { file, rows, cwd, meta };
    if (stamp) parseCache.set(file, { mtimeMs: stamp.mtimeMs, size: stamp.size, parsed });
    return parsed;
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

  /**
   * True on a row that STARTS a new turn: a user row carrying actual user
   * content. A pure tool_result row is also `role: "user"` but it is the
   * second half of the previous assistant step, so it belongs to the turn in
   * flight — the same distinction mapRows draws when it drops the pairing row.
   */
  const startsTurn = (row: ClaudeRow): boolean => {
    if (row.message?.role !== "user") return false;
    if (isBoundaryRow(row)) return false;
    const blocks = contentBlocks(row);
    if (blocks.some((block) => block.type === "tool_result") && blockText(blocks, "text") === "") {
      return false;
    }
    return true;
  };

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

  /**
   * The store's transcript files, walked once per logical pass. The walk
   * itself is cheap (readdir only) but it is called from `findTranscriptFile`,
   * which every prompt pays twice — so the result is memoized for a short
   * window and dropped whenever a run can have written a file, which is the
   * only thing that changes the answer.
   */
  const listTranscriptFiles = async (): Promise<string[]> => {
    const at = Date.now();
    if (transcriptFilesCache && at - transcriptFilesCache.at < TRANSCRIPT_LIST_TTL_MS) {
      return transcriptFilesCache.files;
    }
    const files = await options.listTranscriptFiles();
    transcriptFilesCache = { at, files };
    return files;
  };

  /** Drop the memoized file list: a run may have materialized a transcript. */
  const invalidateTranscriptFiles = (): void => {
    transcriptFilesCache = null;
  };

  /** The encoded-cwd project dir currently holding the given session id, or null. */
  const findTranscriptFile = async (sessionId: string): Promise<string | null> => {
    // Session ids are UUIDs, so the file name is exact and unique across the
    // store; matching the suffix avoids re-deriving the encoded-cwd dir.
    const needle = `${sessionId}.jsonl`;
    const files = await listTranscriptFiles();
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
      title: titleOf(parsed),
      directory: parsed.cwd ?? "",
      parentSessionId: record?.parentId ?? null,
      origin: record ? "fork" : "root",
      createdAt,
      updatedAt,
      // The parse is already in hand, so the last turn's model is free: the
      // overview names a model without a second read of the transcript.
      modelId: lastModelIdOf(branch),
      variant: null,
      ...overrides,
    };
    return summary;
  };

  /** The model the branch's newest turn ran on, walking back from its tip. */
  const lastModelIdOf = (branch: readonly ClaudeRow[]): string | null => {
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const model = branch[index]?.message?.model;
      if (typeof model === "string" && model) return model;
    }
    return null;
  };

  /**
   * The session's display title. A rename the user performed wins, then
   * claude's own post-compaction summary, then the first real user line. All
   * of it comes from the parse already in hand — this used to re-read the
   * whole file just to see the uuid-less title rows.
   */
  const titleOf = (parsed: ParsedTranscript): string => {
    const custom = parsed.meta.find((row) => row.kind === "custom-title");
    if (custom) return custom.title;
    const summary = parsed.meta.find((row) => row.kind === "summary");
    if (summary) return summary.title;
    const branch = activeBranch(parsed.rows);
    for (const row of branch) {
      const text = blockText(contentBlocks(row), "text");
      if (row.message?.role === "user" && text && !text.startsWith(COMPACT_BOUNDARY_PREFIX)) {
        return text.length > 60 ? `${text.slice(0, 60)}…` : text;
      }
    }
    return "(untitled session)";
  };

  const readLineageEntry = async (sessionId: string): Promise<{ parentId: string } | null> => {
    // Cheap per-call read: the lineage file is tiny and writes are rare.
    const map = await readLineage(lineagePath);
    const record = map[sessionId];
    return record ? { parentId: record.parentId } : null;
  };

  const listStoreSessions = async (): Promise<SessionSummary[]> => {
    detached = await readDetachedExportIds(lineagePath);
    const files = await listTranscriptFiles();
    const summaries: SessionSummary[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      // Either separator: the real walk builds these with node's join, so a
      // Windows store hands back "C:\…\<uuid>.jsonl" — splitting on "/" alone
      // would take the whole path for the file name and mint sessions whose
      // id is a path, which no resume or rename could address.
      const base = displayName(file);
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

  /**
   * The cwd a child for this session must run in. A session awefork created
   * carries it in `pending`; a stored one gets it from its own transcript,
   * because that is what the CLI encodes into the project directory name it
   * resolves `--resume` through.
   */
  const cwdFor = async (sessionId: string): Promise<string> => {
    const claimed = pending.get(sessionId);
    if (claimed !== undefined) return claimed;
    const file = await findTranscriptFile(sessionId);
    if (!file) return "";
    const parsed = await parseTranscript(file);
    return parsed.cwd ?? "";
  };

  /** How this spawn relates to the store: fork copy, resume, or brand new. */
  const spawnPlanFor = async (sessionId: string): Promise<ClaudeSpawnPlan> => {
    const resumeParent = pendingResume.get(sessionId);
    if (resumeParent !== undefined) {
      return {
        kind: "fork",
        sessionId,
        resumeParent,
        cutUuid: pendingForkCut.get(sessionId) ?? null,
      };
    }
    // A session with a transcript must be resumed, not re-named: naming it
    // starts a fresh chain that cannot see the history.
    if (await findTranscriptFile(sessionId)) return { kind: "resume", sessionId };
    return { kind: "create", sessionId };
  };

  const ensureChild = async (sessionId: string): Promise<ClaudeChild> => {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const inFlight = spawning.get(sessionId);
    if (inFlight) return inFlight;
    const promise = (async () => {
      const plan = await spawnPlanFor(sessionId);
      const cwd = await cwdFor(sessionId);
      const child = await options.spawnChild(cwd, plan);
      // The copy has been materialized (or named): neither claim is needed.
      pendingResume.delete(sessionId);
      pendingForkCut.delete(sessionId);
      if (disposed) {
        // dispose() ran while this spawn was in flight: the child is not
        // pooled, so nothing will ever kill it. Do it here, or a detached
        // process group outlives the app that spawned it.
        child.kill();
        throw new Error("claude adapter was disposed");
      }
      sessions.set(sessionId, child);
      child.setEventHandler((frame) => handleFrame(sessionId, frame));
      child.onExit((detail) => {
        sessions.delete(sessionId);
        liveMessageIds.delete(sessionId);
        sawMessageStart.delete(sessionId);
        interruptRequested.delete(sessionId);
        if (running.has(sessionId)) {
          running.delete(sessionId);
          emit({ type: "server.error", sessionId, message: `claude exited: ${detail}` });
          emit({ type: "session.idle", sessionId });
        }
      });
      return child;
    })().finally(() => spawning.delete(sessionId));
    spawning.set(sessionId, promise);
    return promise;
  };

  const settleRun = (sessionId: string): void => {
    running.delete(sessionId);
    scheduleReap(sessionId);
    emit({ type: "session.idle", sessionId });
    // A settled run may have materialized a transcript (a fork's copy, a
    // rename's custom-title row), so the memoized file list is stale.
    invalidateTranscriptFiles();
  };

  const handleFrame = (sessionId: string, frame: Record<string, unknown>): void => {
    const type = frame.type;
    if (type === "system" && frame.subtype === "init") {
      // The child confirms the session id; nothing to reconcile — awefork
      // picked it (--session-id) or resumed it (--resume).
      return;
    }
    if (type === "control_request") {
      handleControlRequest(sessionId, frame);
      return;
    }
    if (type === "stream_event") {
      const event = (isBlock(frame.event) ? frame.event : {}) as Record<string, unknown>;
      if (event.type === "message_start") {
        // The real CLI streams one message as
        // message_start → content_block_delta… → assistant, so every delta
        // arrives BEFORE the frame that names the transcript row id. The
        // streamed id therefore comes from here — the API message id, unique
        // per message and present before the first delta — and the assistant
        // frame below re-tags what was collected under it.
        const message = (isBlock(event.message) ? event.message : {}) as Record<string, unknown>;
        let messageId = typeof message.id === "string" ? message.id : "";
        if (messageId === "") {
          liveFallbackSeq += 1;
          messageId = `live-${liveFallbackSeq}`;
        }
        liveMessageIds.set(sessionId, messageId);
        sawMessageStart.add(sessionId);
        emit({ type: "message.started", sessionId, messageId });
        return;
      }
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
      // Part ids are per message: a multi-step run restarts block indexes at
      // 0, and a bare `block-0` would append step two's text onto step one's
      // part.
      const messageId = currentMessageId(sessionId);
      const blockIndex = typeof event.index === "number" ? event.index : 0;
      emit({
        type: "message.delta",
        sessionId,
        messageId,
        partId: `${messageId}:${blockIndex}`,
        kind,
        delta: text,
      });
      return;
    }
    if (type === "assistant") {
      // The frame's uuid is the id the transcript row carries, and its
      // message.id is the id this message's deltas went out under — the two
      // id spaces only meet here. Re-tag the collected parts so the live
      // bubble and the reloaded history agree on one message.
      const uuid =
        typeof (frame as { uuid?: unknown }).uuid === "string"
          ? (frame as { uuid: string }).uuid
          : null;
      const streamId = liveMessageIds.get(sessionId);
      if (uuid !== null && streamId !== undefined && streamId !== uuid) {
        emit({ type: "message.identified", sessionId, streamId, messageId: uuid });
      }
      if (uuid !== null) liveMessageIds.set(sessionId, uuid);
      if (!sawMessageStart.delete(sessionId)) {
        // A CLI that streams no message_start: the run's first step is only
        // announced here, so the renderer still sees it start.
        let messageId = uuid ?? "";
        if (messageId === "") {
          liveFallbackSeq += 1;
          messageId = `live-${liveFallbackSeq}`;
        }
        emit({ type: "message.started", sessionId, messageId });
      }
      return;
    }
    if (type === "result") {
      // A failed run reports ONLY here: no transcript row is written, and the
      // CLI's stderr never reaches the renderer. Surfacing it as a
      // session-scoped error is what makes "the model never answered" visible
      // instead of a silently successful empty turn. An interrupt answers
      // with is_error too (a diagnostic string, not a failure the user asked
      // about), so a requested stop settles clean instead.
      liveMessageIds.delete(sessionId);
      sawMessageStart.delete(sessionId);
      if (frame.is_error === true) {
        if (interruptRequested.delete(sessionId)) {
          settleRun(sessionId);
          return;
        }
        const detail = errorDetailOf(frame);
        running.delete(sessionId);
        scheduleReap(sessionId);
        emit({ type: "server.error", sessionId, message: detail });
        emit({ type: "session.idle", sessionId });
        return;
      }
      interruptRequested.delete(sessionId);
      settleRun(sessionId);
    }
  };

  const currentMessageId = (sessionId: string): string => liveMessageIds.get(sessionId) ?? "live";

  const handleControlRequest = (sessionId: string, frame: Record<string, unknown>): void => {
    const request = (isBlock(frame.request) ? frame.request : {}) as Record<string, unknown>;
    if (request.subtype !== "can_use_tool") return;
    const requestId = typeof frame.request_id === "string" ? frame.request_id : null;
    if (!requestId) return;
    const toolName = typeof request.tool_name === "string" ? request.tool_name : "tool";
    const input = (isBlock(request.input) ? request.input : {}) as Record<string, unknown>;
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

  /**
   * Translate one permission decision into the CLI's `can_use_tool` reply.
   * `always` needs the full `updatedPermissions` entry: `type`, the rules
   * array, the REQUIRED `behavior` of the rule set, and a destination. A
   * missing `behavior` fails the CLI's schema check and the whole entry is
   * dropped with a warning, which silently degraded "always" to a one-time
   * allow; the rule must also name the tool that was actually asked about,
   * not a hardcoded one.
   */
  const permissionBodyOf = (
    response: import("./types.js").AgentInteractionResponse,
    toolName: string,
  ): Record<string, unknown> | null => {
    if (response.decision === "allow") return { behavior: "allow" };
    if (response.decision === "always") {
      return {
        behavior: "allow",
        updatedPermissions: [
          {
            type: "addRules",
            rules: [{ toolName, ruleContent: "*" }],
            behavior: "allow",
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
   * Where a fork/export copy reads from. A pending session has no transcript
   * yet, so its cwd is the awefork-side claim; a stored one reports its own.
   */
  const sourceOf = async (sessionId: string): Promise<{ cwd: string }> => {
    const claimed = pending.get(sessionId);
    if (claimed !== undefined) return { cwd: claimed };
    const { parsed } = await requireTranscript(sessionId);
    return { cwd: parsed.cwd ?? "" };
  };

  /**
   * The chain entry that ENDS the turn starting at `atMessageId` — the uuid
   * `--resume-session-at` must keep. The contract is "the new session contains
   * that full turn", so the cut is the last row before the next turn begins
   * (tool results and attachment rows included). Falling back to the anchor
   * itself keeps a single-row turn whole.
   */
  const turnEndUuidOf = async (sessionId: string, atMessageId: string): Promise<string | null> => {
    const { parsed } = await requireTranscript(sessionId);
    const branch = activeBranch(parsed.rows);
    const anchor = branch.findIndex((row) => row.uuid === atMessageId);
    if (anchor === -1) return null;
    let last = branch[anchor];
    for (let i = anchor + 1; i < branch.length; i += 1) {
      const row = branch[i];
      if (!row) continue;
      if (startsTurn(row)) break;
      last = row;
    }
    return typeof last?.uuid === "string" ? last.uuid : null;
  };

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
      pendingForkCut.delete(sessionId);
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
      // materializing the copy in one step. The cut rides along as
      // `--resume-session-at <uuid>`, the CLI's "keep the chain up to and
      // including this entry" primitive, so the branch carries exactly the
      // turns through the anchor — the AgentAdapter contract, not a whole-
      // history copy.
      const source = await sourceOf(sessionId);
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
      pendingResume.set(id, sessionId);
      // The cut is the last chain entry of the anchored turn; a null anchor
      // means "at the latest state", i.e. no cut at all.
      const cutUuid = atMessageId === null ? null : await turnEndUuidOf(sessionId, atMessageId);
      if (cutUuid !== null) pendingForkCut.set(id, cutUuid);
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
     * A detached copy is the same resume-and-fork spawn as a branch, with the
     * lineage record marked detached so every view treats the result as a
     * plain root session. The cut applies here too: an export "through this
     * turn" must not carry later turns along.
     */
    async exportSession(sessionId, atMessageId) {
      const source = await sourceOf(sessionId);
      const id = newId();
      pendingResume.set(id, sessionId);
      const cutUuid = atMessageId === null ? null : await turnEndUuidOf(sessionId, atMessageId);
      if (cutUuid !== null) pendingForkCut.set(id, cutUuid);
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

    /**
     * Rename through the CLI's control channel: a `rename_session` request
     * makes the CLI write a `custom-title` row into the transcript (verified
     * against 2.1.236 and 2.1.310), which `titleOf` reads back — so the title
     * survives a restart instead of living only in awefork's state. It needs a
     * live child, so one is spawned for the session when none is pooled — and
     * that child is reaped on the normal idle clock, because a rename is the
     * only thing this spawn ever does.
     */
    async renameSession(sessionId, title) {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (!(await findTranscriptFile(sessionId))) {
        throw new Error("this session has no transcript yet — send a prompt before renaming it");
      }
      const child = await ensureChild(sessionId);
      child.send({
        type: "control_request",
        request_id: `awefork-rename-${now()}`,
        request: { subtype: "rename_session", title: trimmed },
      });
      // The rename may have just spawned the child: without a reap timer it
      // would sit pooled for the rest of the app's life when no prompt follows.
      scheduleReap(sessionId);
    },

    async prompt(sessionId, text, model, attachments) {
      const child = await ensureChild(sessionId);
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
      // The model choice rides the CLI's own control channel: a user frame has
      // no `model` field (the schema accepts unknown keys and ignores them),
      // so writing one there did nothing at all. `set_model` switches the
      // session and is what the CLI itself uses for /model.
      const modelId = model?.modelId && model.modelId !== "default" ? model.modelId : null;
      try {
        if (modelId !== null) {
          child.send({
            type: "control_request",
            request_id: `awefork-model-${now()}`,
            request: { subtype: "set_model", model: modelId },
          });
        }
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
      const body = permissionBodyOf(response, ask.toolName);
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
      const cwd = await cwdFor(sessionId);
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
      // The CLI answers an interrupt with `is_error` + a diagnostic string
      // rather than a clean result; the flag makes the settle below treat it
      // as the stop the user asked for instead of a failed run.
      interruptRequested.add(sessionId);
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
      disposed = true;
      emitEvent = null;
      // awefork's process exits on quit, which also kills the adapter's event
      // sink and reap timers. Claude Code has no detached server that could
      // finish the turn on its own, so keep-alive cannot preserve its work —
      // same contract as the pi backend. Always tear the children down.
      for (const timer of idleTimers.values()) clearTimeout(timer);
      idleTimers.clear();
      for (const child of sessions.values()) child.kill();
      sessions.clear();
      spawning.clear();
      pendingAsks.clear();
      pending.clear();
      pendingResume.clear();
      pendingForkCut.clear();
      liveMessageIds.clear();
      sawMessageStart.clear();
      interruptRequested.clear();
      running.clear();
      parseCache.clear();
      transcriptFilesCache = null;
    },
  };
  return adapter;
}
/**
 * The human-readable reason a `result` frame reports failure. The CLI puts the
 * cause in `errors[]` (and repeats the first one in `result`); a bare
 * `is_error` with neither still needs a non-empty message, or the renderer
 * would show an empty error row.
 */
function errorDetailOf(frame: Record<string, unknown>): string {
  const errors = Array.isArray(frame.errors)
    ? frame.errors.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : [];
  if (errors.length > 0) return errors.join("; ");
  if (typeof frame.result === "string" && frame.result !== "") return frame.result;
  const subtype = typeof frame.subtype === "string" ? frame.subtype : null;
  // An interrupt's diagnostic string names an internal frame type and reads
  // as a failure to the user who asked for the stop; say what happened.
  if (subtype === "error_during_execution") return "the run stopped unexpectedly";
  return subtype === null ? "claude reported a failed run" : `claude run failed (${subtype})`;
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
 * The spawn argv for one plan. A fork resumes the parent, copies under a new
 * id, and — when a cut is given — keeps only the chain through that entry.
 * `--session-id` alone is for a session with no transcript yet; passing it for
 * an existing one starts a fresh chain that cannot see the history.
 * Exposed for main and tests.
 */
export function claudeSpawnArgsFor(plan: ClaudeSpawnPlan): string[] {
  if (plan.kind === "create") return ["--session-id", plan.sessionId];
  if (plan.kind === "resume") return ["--resume", plan.sessionId];
  return [
    "--resume",
    plan.resumeParent,
    "--fork-session",
    "--session-id",
    plan.sessionId,
    ...(plan.cutUuid === null ? [] : ["--resume-session-at", plan.cutUuid]),
  ];
}
