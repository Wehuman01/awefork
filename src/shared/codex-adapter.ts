import { canonicalizeSessionDirectories } from "./canonical-paths.js";
import { withInlineFiles } from "./inline-attachments.js";
import { recordFork, removeFork } from "./lineage-store.js";
import type {
  AgentAdapter,
  AgentEvent,
  AgentInteractionRequest,
  AgentInteractionResponse,
  ChatMessage,
  ModelOption,
  PromptAttachment,
  SessionSummary,
} from "./types.js";

/**
 * codex implementation of AgentAdapter, talking to a `codex app-server`
 * child over newline JSON-RPC (the client lives in main; this structural
 * interface keeps shared/ free of node imports).
 *
 * Units: codex reports thread/turn timestamps in Unix SECONDS and item
 * lifecycle notifications in MILLISECONDS; awefork is ms everywhere, so the
 * second-based fields are converted at each read.
 *
 * Fork semantics: `thread/fork {lastTurnId}` keeps everything through that
 * turn, inclusive — exactly awefork's "keep through the turn that starts with
 * user message atMessageId". The adapter translates item id → turn id via an
 * index built from `thread/turns/list`.
 */
export interface CodexRpc {
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  setNotificationHandler(handler: (method: string, params: unknown) => void): void;
  setRequestHandler?: (
    handler?: (method: string, params: unknown) => unknown | Promise<unknown>,
  ) => void;
}

/**
 * One turn's model settings as the session's rollout recorded them at the
 * turn's start. `effort` is the reasoning variant shown beside the model.
 */
export interface CodexTurnSettings {
  model: string | null;
  effort: string | null;
}

export interface CodexAdapterOptions {
  client: CodexRpc;
  /** Path to the lineage sidecar file (per-backend). */
  lineagePath: string;
  /** CLI version from the initialize handshake; gates the fork fallback. */
  cliVersion?: string | null;
  /** One-time auth banner (codex installed but not logged in). */
  authMessage?: string | null;
  /**
   * Stage image attachments as files and hand back the paths codex's
   * `localImage` turn input reads. Injected from main — shared/ imports no
   * node built-ins. Absent means images cannot be staged and are skipped.
   */
  stageImages?: (images: readonly PromptAttachment[]) => StagedCodexImages;
  /**
   * Per-turn model settings for a session, keyed by turn id — what each turn
   * actually ran with, which only the rollout records. The app-server exposes
   * the model at thread level alone (`thread/read` carries the CURRENT
   * settings), so without this a mid-session switch relabels every earlier
   * turn of the session with the new model. Turns with no entry fall back to
   * the thread's settings.
   */
  turnContexts?: (sessionId: string) => Promise<Record<string, CodexTurnSettings>>;
  /**
   * A fork this adapter cut on its own (the writer-conflict continuation),
   * reported so the host can list it before codex's `thread/list` projects
   * it. A fork carrying only copied prefix turns is absent from that listing
   * until its first own turn, which would leave the renderer unable to select
   * the branch the run just moved to.
   */
  forkCreated?: (forked: SessionSummary) => void;
}

/** Image attachments written as files for one turn's `localImage` items. */
export interface StagedCodexImages {
  paths: string[];
  /** Removes the staged files; safe to call more than once. */
  cleanup: () => void;
}

interface CodexThread {
  id: string;
  forkedFromId?: string | null;
  parentThreadId?: string | null;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  reasoningEffort?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

interface CodexTurn {
  id: string;
  items?: CodexItem[];
  status?: string | null;
  error?: { message?: string } | null;
  startedAt?: number;
  completedAt?: number | null;
  /**
   * Per-turn token usage. codex 0.163's `thread/turns/list` omits it and its
   * rollout writes it as an untyped `token_count` event, so this stays absent
   * in practice; `thread/tokenUsage/updated` is where the numbers actually
   * arrive and the adapter records them per thread (see usageByThread) for
   * `messages()` to fold back onto the newest turn.
   */
  usage?: CodexTokenUsage | null;
}

/**
 * codex's token accounting (`thread/tokenUsage/updated`): a breakdown per
 * response, with `total` accumulating across the thread and `last` scoped to
 * the turn that just finished. `totalTokens` is the backend's own sum.
 * `modelContextWindow` is the window the backend just measured against —
 * codex's model catalog carries no window of its own, so this frame is the
 * only place the meter can learn it.
 */
interface CodexTokenUsage {
  total?: CodexTokenBreakdown | null;
  last?: CodexTokenBreakdown | null;
  modelContextWindow?: number | null;
}

interface CodexTokenBreakdown {
  totalTokens?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningOutputTokens?: number | null;
}

interface CodexItem {
  type: string;
  id: string;
  text?: string;
  /**
   * Reasoning/userMessage content. Codex 0.154 sends reasoning content as
   * plain string[]; some builds wrap it as {text}[] — both are accepted.
   */
  content?: (string | { text?: string; type?: string; path?: string })[];
  summary?: string[];
  /** Joined command line, or argv words — codex builds differ. */
  command?: string | string[];
  server?: string;
  tool?: string;
}

interface CodexModel {
  id: string;
  displayName?: string | null;
  hidden?: boolean | null;
  supportedReasoningEfforts?: { reasoningEffort: string }[] | null;
  inputModalities?: string[] | null;
}

interface Paginated<T> {
  data?: T[] | null;
  nextCursor?: string | null;
}

interface PendingInteraction {
  method: string;
  resolve: (result: unknown) => void;
}

/**
 * Shared with main's codex-server (its startup banner uses the same line) so
 * a run-time auth failure and the connect-time banner read identically.
 */
export const CODEX_NOT_LOGGED_IN_MESSAGE =
  "codex is not logged in or has no usable account: run codex login in a terminal first";

/** Shown when another codex process owns the thread's writer. */
export const OWNED_ELSEWHERE_MESSAGE =
  "this session is being written by another codex instance (e.g. a session in aweswitch) and cannot continue; close that one and retry";

const PAGE_LIMIT = 100;

export function createCodexAdapter(options: CodexAdapterOptions): AgentAdapter {
  const { client, lineagePath } = options;
  /** Set by subscribe; notification mapping and prompt failures emit through it. */
  let emitEvent: ((event: AgentEvent) => void) | null = null;
  /** threadId → its in-flight turn id (interrupt needs the pair). */
  const activeTurns = new Map<string, string>();
  /**
   * threadId → the newest usage the live `thread/tokenUsage/updated` frame
   * reported, plus the turn it arrived on. codex persists usage only as an
   * untyped `token_count` rollout event and `thread/turns/list` drops it, so
   * the live frame is the only place the meter can read it; keeping the pair
   * lets `messages()` stamp it onto the turn that produced it (and lets a
   * reload keep showing the footprint instead of losing it with the frame).
   */
  const usageByThread = new Map<string, { turnId: string; usage: CodexTokenUsage }>();
  /** threadId → itemId → containing turn id, rebuilt whenever turns load. */
  const turnIndex = new Map<string, Map<string, string>>();
  const pendingInteractions = new Map<string, PendingInteraction>();
  /**
   * threadId → image files staged for the thread's in-flight turn. codex
   * reads them while the turn runs; they are released when it ends. A second
   * prompt on the same thread replaces (and releases) the previous staging.
   */
  const stagedByThread = new Map<string, StagedCodexImages>();
  let nextInteractionId = 1;
  let forkFallbackLogged = false;

  const emit = (event: AgentEvent) => emitEvent?.(event);

  const releaseStaging = (threadId: string): void => {
    const staged = stagedByThread.get(threadId);
    if (!staged) return;
    stagedByThread.delete(threadId);
    staged.cleanup();
  };

  /** Replace any staging this thread still holds, then take the new one. */
  const registerStaging = (threadId: string, staged: StagedCodexImages): void => {
    releaseStaging(threadId);
    stagedByThread.set(threadId, staged);
  };

  /**
   * turn/start's input items: staged images first as `localImage` paths, the
   * prompt text last with non-image attachments inlined — codex has no file
   * part to hang them on, the same trade pi makes.
   */
  const buildTurnInput = (
    text: string,
    attachments: readonly PromptAttachment[] | undefined,
  ): { input: Record<string, unknown>[]; staged: StagedCodexImages | null } => {
    const images = (attachments ?? []).filter((a) => a.mime.startsWith("image/"));
    const staged = images.length > 0 ? (options.stageImages?.(images) ?? null) : null;
    const imageItems = (staged?.paths ?? []).map((path) => ({ type: "localImage", path }));
    const textItem = {
      type: "text",
      text: withInlineFiles(
        text,
        (attachments ?? []).filter((a) => !a.mime.startsWith("image/")),
      ),
    };
    return { input: [...imageItems, textItem], staged };
  };

  /**
   * A failed turn/start may be auth, but the RPC error text can't say which.
   * Re-read the account: only a null account counts as logged out — codex
   * 0.154 reports requiresOpenaiAuth: true alongside a valid account (it is
   * the provider's "uses OpenAI auth" config flag, not a login flag). No
   * extra reconnect probing lives here: ensureCodexServer re-probes
   * account/read on every respawn, so once the user logs in the next codex
   * call spins up a fresh child whose subscribe re-announces the (now clear)
   * banner.
   */
  const authFailureDetail = async (): Promise<string | null> => {
    try {
      const account = await client.request<{ account?: unknown; requiresOpenaiAuth?: boolean }>(
        "account/read",
        {},
        10_000,
      );
      if (!account?.account) {
        return CODEX_NOT_LOGGED_IN_MESSAGE;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A probe that died with the connection says nothing about login
      // state — the raw failure (and the outage toast) tells that story;
      // wrapping it as "not logged in" would send the user after codex
      // login for a crashed app-server.
      if (message.includes("connection lost") || message.includes("not connected")) return null;
      return `${CODEX_NOT_LOGGED_IN_MESSAGE} (${message})`;
    }
  };

  const secToMs = (seconds: number | null | undefined): number | null =>
    typeof seconds === "number" ? seconds * 1000 : null;

  const mapThread = (thread: CodexThread): SessionSummary => ({
    id: thread.id,
    title: thread.name || thread.preview || "(untitled session)",
    directory: thread.cwd ?? "",
    parentSessionId: thread.forkedFromId ?? thread.parentThreadId ?? null,
    origin: thread.forkedFromId ? "fork" : thread.parentThreadId ? "subagent" : "root",
    createdAt: secToMs(thread.createdAt) ?? Date.now(),
    updatedAt: secToMs(thread.updatedAt) ?? Date.now(),
    // thread/list carries the thread's current model settings, so the overview
    // can name a model without reading a single turn.
    modelId: thread.model ?? null,
    variant: thread.reasoningEffort ?? null,
  });

  /**
   * Walk one thread's turns pages (ascending) to the end.
   *
   * codex 0.154 keeps paginated threads' turns in a per-home sqlite store and
   * only projects a rollout into it on write operations, so a thread whose
   * rollout predates this home (a copy imported from an aweswitch account
   * home) lists zero turns until something loads it. Resuming once on the
   * empty first walk covers both browsing (messages) and fork's item lookup;
   * a refused resume (a live writer elsewhere) keeps the empty result, which
   * is what a genuinely empty new thread looks like anyway.
   *
   * A harder case stays open here: a never-loaded thread forked in the TUI
   * lists its forked-from PREFIX — reconstructed from the parent's rollout —
   * while its own post-fork turns stay invisible until the rollout loads.
   * That walk is non-empty, so the resume above never fires; turnOfItem
   * closes the gap for fork. Plain browsing keeps the truncated view rather
   * than taking the writer just to read.
   */
  async function listTurns(threadId: string): Promise<CodexTurn[]> {
    const walk = async (): Promise<CodexTurn[]> => {
      const turns: CodexTurn[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await client.request<Paginated<CodexTurn>>("thread/turns/list", {
          threadId,
          cursor: cursor ?? null,
          limit: PAGE_LIMIT,
          // turns/list defaults to descending; awefork's message list is oldest-first.
          sortDirection: "asc",
          itemsView: "full",
        });
        turns.push(...(page.data ?? []));
        cursor = page.nextCursor ?? null;
      } while (cursor);
      return turns;
    };
    let turns: CodexTurn[];
    try {
      turns = await walk();
    } catch (error) {
      // A thread/start thread has no rollout until its first user message —
      // turns/list refuses it outright. That is the empty list, not an error:
      // messages() runs right after createSession and must not toast.
      if (isNotMaterialized(error)) {
        indexTurnItems(threadId, []);
        return [];
      }
      throw error;
    }
    if (turns.length === 0) {
      try {
        await resumeThread(threadId);
        turns = await walk();
      } catch {
        // Browse must stay read-only against a thread another writer owns;
        // the retry is only for this home's own cold copies.
      }
    }
    indexTurnItems(threadId, turns);
    return turns;
  }

  function indexTurnItems(threadId: string, turns: CodexTurn[]): void {
    const index = new Map<string, string>();
    for (const turn of turns) {
      for (const item of turn.items ?? []) index.set(item.id, turn.id);
    }
    turnIndex.set(threadId, index);
  }

  /**
   * The turn a user-message item id belongs to, fetching turns when cold.
   *
   * A miss is not final: on a never-loaded forked thread, turns/list serves
   * only the forked-from prefix (see listTurns), so the anchor turn is among
   * the thread's own invisible turns. Loading the rollout once via
   * thread/resume brings them up — legitimate here because every caller is a
   * write-intending operation (fork), not a browse. A refused resume keeps
   * the miss, except a writer conflict, which explains itself instead of
   * masquerading as "message not found".
   */
  async function turnOfItem(threadId: string, itemId: string): Promise<CodexTurn | null> {
    const lookup = async (): Promise<CodexTurn | null> => {
      const turns = await listTurns(threadId);
      const turnId = turnIndex.get(threadId)?.get(itemId);
      if (!turnId) return null;
      return turns.find((t) => t.id === turnId) ?? null;
    };
    const direct = await lookup();
    if (direct) return direct;
    try {
      await resumeThread(threadId);
    } catch (error) {
      if (isWriterConflict(error)) throw new Error(OWNED_ELSEWHERE_MESSAGE);
      return null;
    }
    return lookup();
  }

  /**
   * The turn's footprint in the model's context window, same rule as
   * opencode/zcode: the backend's own total when it reports one, else the sum of
   * the parts it reports (cached reads count — they are part of what the next
   * prompt carries). The usage comes from the live `thread/tokenUsage/updated`
   * frame (see usageByThread): codex 0.163's `thread/turns/list` reports none.
   */
  function contextTokensOfUsage(usage: CodexTokenUsage | null | undefined): number | null {
    if (!usage) return null;
    // `total` accumulates the whole thread, so a later turn would inflate the
    // meter; `last` is the turn's own step. Prefer `last` when both exist, but
    // fall back to `total` for a notification that only carried it.
    const breakdown = usage.last ?? usage.total;
    if (!breakdown) return null;
    if (typeof breakdown.totalTokens === "number") return breakdown.totalTokens;
    const parts = [
      breakdown.inputTokens,
      breakdown.outputTokens,
      breakdown.reasoningOutputTokens,
      breakdown.cachedInputTokens,
      breakdown.cacheWriteInputTokens,
    ];
    let sum = 0;
    let seen = false;
    for (const part of parts) {
      if (typeof part === "number") {
        sum += part;
        seen = true;
      }
    }
    return seen ? sum : null;
  }

  /**
   * The window the frame measured against, if it carried one. codex's
   * `model/list` has no window field at all (verified against 0.163), so the
   * live usage frame is the only per-model window available to the meter.
   */
  function windowOfUsage(usage: CodexTokenUsage | null | undefined): number | null {
    const window = usage?.modelContextWindow;
    return typeof window === "number" && window > 0 ? window : null;
  }

  function mapTurn(
    turn: CodexTurn,
    thread: CodexThread | null,
    turnSettings?: CodexTurnSettings,
  ): ChatMessage[] {
    const items = turn.items ?? [];
    const startedAt = secToMs(turn.startedAt) ?? Date.now();
    // The turn's own recorded settings win: the thread carries only the latest
    // ones, so trusting it here would rewrite every earlier turn's model on
    // each switch.
    const modelId = turnSettings?.model ?? thread?.model ?? null;
    const variant = turnSettings?.effort ?? thread?.reasoningEffort ?? null;
    const rows: ChatMessage[] = [];

    // codex's compaction turn carries one contextCompaction item (the rollout
    // spells the same item ContextCompaction) and little else — the fold
    // itself is the turn. It maps to the marker row every other backend
    // emits, so the pane draws its divider and the canvas titles the turn;
    // without it the fold is invisible on every later open, long after the
    // thread/compacted toast has passed. codex's summary is encrypted, so
    // the marker carries no text of its own.
    const compaction = items.find((i) => i.type.toLowerCase() === "contextcompaction");
    if (compaction) {
      rows.push({
        id: compaction.id,
        role: "user",
        text: "",
        thinking: "",
        toolNames: [],
        modelId,
        providerId: "codex",
        variant,
        attachmentNames: [],
        createdAt: startedAt,
        completedAt: null,
        finish: null,
        outputTokens: null,
        compaction: true,
        error: null,
      });
    }

    const userItem = items.find((i) => i.type === "userMessage");
    if (userItem) {
      rows.push({
        id: userItem.id,
        role: "user",
        text: (userItem.content ?? [])
          .map((part) => (typeof part === "string" ? part : part.text))
          .filter((text): text is string => typeof text === "string")
          .join("\n")
          .trim(),
        thinking: "",
        toolNames: [],
        modelId,
        providerId: "codex",
        variant,
        attachmentNames: imageNamesOf(userItem.content),
        createdAt: startedAt,
        completedAt: null,
        finish: null,
        outputTokens: null,
        error: null,
      });
    }

    const text = items
      .filter((i) => i.type === "agentMessage" && typeof i.text === "string")
      .map((i) => i.text)
      .join("\n\n")
      .trim();
    const thinking = items
      .filter((i) => i.type === "reasoning")
      .map(reasoningTextOf)
      .join("\n\n")
      .trim();
    const toolNames = [
      ...new Set(items.map(toolNameOfItem).filter((name): name is string => name !== null)),
    ];
    const error = turn.error?.message ?? null;
    const contextTokens = contextTokensOfUsage(turn.usage);
    // A turn whose assistant side produced nothing visible (yet) yields no
    // assistant row — empty rows would flicker above the live stream.
    if (text || thinking || toolNames.length > 0 || error) {
      rows.push({
        id: turn.id,
        role: "assistant",
        text,
        thinking,
        toolNames,
        modelId,
        providerId: "codex",
        variant,
        attachmentNames: [],
        createdAt: startedAt,
        completedAt: secToMs(turn.completedAt),
        finish: turn.status === "completed" ? "stop" : null,
        outputTokens: null,
        ...(contextTokens !== null ? { contextTokens } : {}),
        error,
      });
    }
    return rows;
  }

  /**
   * Read a thread's metadata WITHOUT taking its writer.
   *
   * codex 0.154 gives each thread one exclusive writer, guarded by a lock
   * file under `$CODEX_HOME/thread-writer-locks/`. `thread/resume` takes
   * that lock, so opening a session that a live codex session already owns
   * (an aweswitch per-account terminal, say) fails with "thread ... already
   * has an active writer". Browsing history must never write, so reads go
   * through `thread/read`, which returns the same thread object while
   * another writer holds the thread.
   */
  async function readThread(threadId: string): Promise<CodexThread | null> {
    if (!supportsThreadRead(options.cliVersion)) return resumeThread(threadId);
    try {
      const read = await client.request<{ thread?: CodexThread }>("thread/read", { threadId });
      return read?.thread ?? null;
    } catch {
      // An older-than-advertised CLI, or a thread/read that failed for a
      // reason resume would report better: either way resume is the shape
      // awefork used before, and it raises a real error if the thread is gone.
      return resumeThread(threadId);
    }
  }

  /** Take the thread's writer. Only for calls that append to the rollout. */
  async function resumeThread(threadId: string): Promise<CodexThread | null> {
    // Threads from thread/list come back status:notLoaded; resume loads the
    // rollout. On an already-loaded thread it is an idempotent state read.
    const resumed = await client.request<{ thread?: CodexThread }>("thread/resume", { threadId });
    return resumed?.thread ?? null;
  }

  /**
   * Copy a thread this server may not write to, for prompt's writer-conflict
   * recovery. A full-history fork (no cut point, no context switch) so the
   * new thread carries everything the locked one had; the copy's title is
   * derived the same way listSessions derives it. Returns null when the fork
   * itself is refused — the caller then reports the original conflict.
   */
  async function forkForContinuation(sessionId: string): Promise<SessionSummary | null> {
    try {
      const response = await client.request<{ thread?: CodexThread }>("thread/fork", {
        threadId: sessionId,
      });
      const thread = response?.thread;
      if (!thread) return null;
      await recordFork(lineagePath, thread.id, {
        parentId: sessionId,
        atMessageId: null,
        createdAt: secToMs(thread.createdAt) ?? Date.now(),
      });
      const forked = mapThread(thread);
      // Report the fork before the turn starts on it: the caller emits
      // session.branchContinued right after, and the renderer selects the
      // fork it names — a branch thread/list has not projected yet would
      // otherwise be unselectable, hiding the reply the run just moved there.
      options.forkCreated?.(forked);
      return forked;
    } catch {
      return null;
    }
  }

  /**
   * A refused writer is a real, actionable state: another codex process
   * (typically an aweswitch session) owns the thread. Say so rather than
   * echoing codex's wording about writers and locks.
   */
  function isWriterConflict(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("already has an active writer");
  }

  function isNotMaterialized(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    // 0.154 said "is not materialized yet"; 0.163's thread/resume says
    // "no rollout found for thread id" for the same state.
    return message.includes("is not materialized yet") || message.includes("no rollout found");
  }

  return {
    kind: "codex",

    async listSessions() {
      const threads: CodexThread[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await client.request<Paginated<CodexThread>>("thread/list", {
          cursor: cursor ?? null,
          limit: PAGE_LIMIT,
        });
        threads.push(...(page.data ?? []));
        cursor = page.nextCursor ?? null;
      } while (cursor);
      // Same once-per-listing canonicalization as the opencode side: thread
      // cwds arrive as the shell spelled them, symlink variants included.
      return canonicalizeSessionDirectories(
        threads.map(mapThread).sort((a, b) => b.updatedAt - a.updatedAt),
      );
    },

    async messages(sessionId) {
      const thread = await readThread(sessionId);
      const turns = await listTurns(sessionId);
      const turnSettings = (await options.turnContexts?.(sessionId)) ?? {};
      const rows = turns.flatMap((turn) => mapTurn(turn, thread, turnSettings[turn.id]));
      // Fold the live usage frame back onto the turn it arrived on: without
      // this the meter goes blank after every reload, because the turn list
      // itself carries no usage on 0.163.
      const recorded = usageByThread.get(sessionId);
      if (!recorded) return rows;
      const index = rows.findIndex((row) => row.role === "assistant" && row.id === recorded.turnId);
      const row = rows[index];
      if (row) {
        const contextTokens = contextTokensOfUsage(recorded.usage);
        const contextWindow = windowOfUsage(recorded.usage);
        rows[index] = {
          ...row,
          ...(contextTokens === null ? {} : { contextTokens }),
          ...(contextWindow === null ? {} : { contextWindow }),
        };
      }
      return rows;
    },

    // codex does not round-trip sent bytes; retry prefill is text-only.
    async messageAttachments() {
      return [] as PromptAttachment[];
    },

    async listModels() {
      const models: CodexModel[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await client.request<Paginated<CodexModel>>("model/list", {
          cursor: cursor ?? null,
          limit: PAGE_LIMIT,
        });
        models.push(...(page.data ?? []));
        cursor = page.nextCursor ?? null;
      } while (cursor);
      return models
        .filter((m) => !m.hidden)
        .map((m) => ({
          providerId: "codex",
          providerName: "Codex",
          modelId: m.id,
          modelName: m.displayName || m.id,
          variants: m.supportedReasoningEfforts?.map((e) => e.reasoningEffort) ?? [
            "low",
            "medium",
            "high",
          ],
          attachment: m.inputModalities?.includes("image") ?? false,
        }));
    },

    async createSession(directory) {
      const response = await client.request<{ thread?: CodexThread }>("thread/start", {
        cwd: directory ?? null,
      });
      const thread = response?.thread;
      if (!thread) throw new Error("codex thread/start returned no thread");
      return mapThread(thread);
    },

    async fork(sessionId, atMessageId, forkOptions) {
      // Empty-context fork: thread/start in the parent's cwd. readThread (not
      // resume) — an empty fork appends nothing, so it must not take the
      // parent's writer lock just to read its directory.
      if (forkOptions?.context === "none") {
        const parent = await readThread(sessionId);
        const response = await client.request<{ thread?: CodexThread }>("thread/start", {
          cwd: parent?.cwd ?? null,
        });
        const thread = response?.thread;
        if (!thread) throw new Error("codex thread/start returned no thread");
        const summary = mapThread(thread);
        await recordFork(lineagePath, summary.id, {
          parentId: sessionId,
          atMessageId,
          createdAt: summary.createdAt,
          context: "none",
        });
        return { ...summary, origin: "fork", parentSessionId: sessionId };
      }
      let lastTurnId: string | null = null;
      if (atMessageId) {
        const turn = await turnOfItem(sessionId, atMessageId);
        if (!turn) {
          throw new Error(
            `Message ${atMessageId} not found in session ${sessionId}. Refresh the session and try again.`,
          );
        }
        lastTurnId = turn.id;
      }
      const params: Record<string, unknown> = { threadId: sessionId };
      if (lastTurnId && supportsLastTurnFork(options.cliVersion)) {
        params.lastTurnId = lastTurnId;
      }
      const response = await client.request<{ thread?: CodexThread }>("thread/fork", params);
      const thread = response?.thread;
      if (!thread) throw new Error("codex thread/fork returned no thread");
      // Version drift: the fork ran uncut; roll the copy back to the
      // requested turn count with the (deprecated but present) rollback API.
      if (lastTurnId && !supportsLastTurnFork(options.cliVersion)) {
        const turns = await listTurns(thread.id);
        const keepThrough = turns.findIndex((t) => t.id === lastTurnId);
        const drop = keepThrough >= 0 ? turns.length - (keepThrough + 1) : 0;
        if (drop > 0)
          await client.request("thread/rollback", { threadId: thread.id, numTurns: drop });
        if (!forkFallbackLogged) {
          forkFallbackLogged = true;
          console.warn(
            `codex ${options.cliVersion ?? "unknown"} lacks thread/fork.lastTurnId; degraded to fork + rollback`,
          );
        }
      }
      const summary = mapThread(thread);
      await recordFork(lineagePath, summary.id, {
        parentId: sessionId,
        atMessageId,
        createdAt: summary.createdAt,
      });
      return { ...summary, origin: "fork", parentSessionId: sessionId };
    },

    // A codex fork's parent linkage lives in codex itself (thread.forkedFrom),
    // so a detached copy cannot be produced — the renderer hides the export
    // affordance (capabilities.exportBranch === false); this throws if reached.
    async exportSession() {
      throw new Error("codex does not support exporting a detached session");
    },

    /**
     * codex compacts by starting a turn of its own: `thread/compact/start`
     * asks the app-server to fold the thread into a summary, and the work then
     * arrives as an ordinary turn (a `contextCompaction` item, its own
     * tokenUsage frame, then turn/completed). Fire-and-forget like prompt: the
     * request returns empty, and the stream plus the session.idle that
     * turn/completed emits carry the outcome. The model argument is unused —
     * codex always summarizes with the thread's own model.
     */
    async compress(sessionId) {
      try {
        await resumeThread(sessionId);
      } catch (error) {
        if (!isNotMaterialized(error)) {
          if (isWriterConflict(error)) throw new Error(OWNED_ELSEWHERE_MESSAGE);
          throw error;
        }
      }
      try {
        await client.request("thread/compact/start", { threadId: sessionId }, 30_000);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (isWriterConflict(error)) throw new Error(OWNED_ELSEWHERE_MESSAGE);
        throw new Error(`codex compact failed: ${detail}`);
      }
      // The compaction turn is asynchronous; announce it the same way opencode
      // does so the renderer's compress flow (toast + reload) behaves alike.
      emit({ type: "session.compressed", sessionId });
    },

    async deleteSession(sessionId) {
      await client.request("thread/delete", { threadId: sessionId });
      await removeFork(lineagePath, sessionId);
    },

    // codex has no single-message delete; the renderer hides the affordance
    // (capabilities.deleteMessage === false) and this throws if ever reached.
    async deleteMessage() {
      throw new Error("codex does not support deleting a single message");
    },

    async renameSession(sessionId, title) {
      await client.request("thread/name/set", { threadId: sessionId, name: title });
    },

    async prompt(sessionId, text, model, attachments) {
      const { input, staged } = buildTurnInput(text, attachments);
      const turnParams = (threadId: string) => {
        const params: Record<string, unknown> = {
          threadId,
          input,
        };
        if (model?.modelId) params.model = model.modelId;
        if (model?.variant) params.effort = model.variant;
        return params;
      };
      // Claim the slot before the call: a staging this thread still holds
      // belongs to a finished turn (its end frame may have been dropped).
      if (staged) registerStaging(sessionId, staged);
      try {
        // turn/start only sees threads this server has loaded, and reading a
        // thread no longer loads it (readThread deliberately avoids the
        // writer). Taking the writer here is correct: a turn appends to the
        // rollout. Idempotent when the thread is already loaded. A brand-new
        // thread/start session has no rollout until its first turn, and
        // thread/resume refuses it — that refusal is not an error, the
        // turn/start below is what materializes the rollout.
        try {
          await resumeThread(sessionId);
        } catch (error) {
          if (!isNotMaterialized(error)) throw error;
        }
        const response = await client.request<{ turn?: { id?: string } }>(
          "turn/start",
          turnParams(sessionId),
        );
        if (response?.turn?.id) {
          activeTurns.set(sessionId, response.turn.id);
          return;
        }
        // No turn came back: nothing will ever read the staged files.
        releaseStaging(sessionId);
      } catch (error) {
        // Request-level failures (auth, unknown thread) have no notification;
        // surface them with the session id so the renderer settles the run —
        // then rethrow: the renderer arms its completion watchdog only after
        // prompt() resolves, so a swallowed error would leave a phantom run
        // polling for a turn that never started.
        const detail = error instanceof Error ? error.message : String(error);
        if (isWriterConflict(error)) {
          // codex 0.163's managed app-server daemon keeps a thread's writer
          // lock open long after its turn finished (verified on 0.163: the
          // rollout's last write was minutes stale, yet the lock fd stayed
          // open), so "close the other window and retry" is advice the user
          // cannot follow. thread/fork is not gated on that lock — it copies
          // the rollout into a fresh thread id — so continue the run there:
          // the user keeps their message, and the fork carries the history
          // the locked thread held.
          const forked = await forkForContinuation(sessionId);
          if (forked) {
            try {
              await client.request("turn/start", turnParams(forked.id));
            } catch (forkError) {
              releaseStaging(sessionId);
              throw forkError instanceof Error ? forkError : new Error(String(forkError));
            }
            // The turn now runs on the fork, so the staged files outlive the
            // fork's turn end, not the locked thread's.
            if (staged) {
              stagedByThread.delete(sessionId);
              registerStaging(forked.id, staged);
            }
            emit({
              type: "session.branchContinued",
              sessionId,
              forkedSessionId: forked.id,
              message: `${OWNED_ELSEWHERE_MESSAGE}; continued in the new branch ${forked.id}`,
            });
            return;
          }
        }
        // The turn never started: nothing will read the staged files.
        releaseStaging(sessionId);
        const authDetail = await authFailureDetail();
        emit({
          type: "server.error",
          sessionId,
          message: isWriterConflict(error)
            ? OWNED_ELSEWHERE_MESSAGE
            : (authDetail ?? `codex prompt failed: ${detail}`),
        });
        throw error instanceof Error ? error : new Error(detail);
      }
    },

    async respondInteraction(requestId, response) {
      const pending = pendingInteractions.get(requestId);
      if (!pending) return;
      pendingInteractions.delete(requestId);
      pending.resolve(interactionReply(pending.method, response));
    },

    async abort(sessionId) {
      const turnId = activeTurns.get(sessionId);
      if (!turnId) throw new Error("No running turn in this session");
      await client.request("turn/interrupt", { threadId: sessionId, turnId });
    },

    async subscribe(handler) {
      const stopped = { flag: false };
      emitEvent = (event) => {
        if (!stopped.flag) handler(event);
      };
      client.setNotificationHandler((method, params) => {
        emitCodexNotification(method, params, emit, activeTurns, usageByThread, (threadId) =>
          releaseStaging(threadId),
        );
      });
      client.setRequestHandler?.((method, params) => {
        const requestId = `codex-interaction-${nextInteractionId++}`;
        const request = interactionRequest(requestId, method, params);
        if (!request) {
          // Unmappable or malformed params: refuse the request over the wire
          // AND toast it — a silent refusal would look like a hung turn.
          emit({
            type: "server.error",
            message: `codex asked for an interaction awefork cannot display (${method}), so it was declined`,
          });
          return Promise.reject(new Error(`awefork cannot handle the codex request ${method}`));
        }
        return new Promise<unknown>((resolve) => {
          pendingInteractions.set(requestId, { method, resolve });
          emit({ type: "interaction.requested", request });
        });
      });
      if (options.authMessage) {
        emit({ type: "server.error", message: options.authMessage });
      }
      return () => {
        stopped.flag = true;
        emitEvent = null;
        pendingInteractions.clear();
        client.setNotificationHandler(() => {});
        client.setRequestHandler?.(undefined);
      };
    },

    dispose() {
      emitEvent = null;
      pendingInteractions.clear();
      for (const staged of stagedByThread.values()) staged.cleanup();
      stagedByThread.clear();
      client.setNotificationHandler(() => {});
      client.setRequestHandler?.(undefined);
    },
  };
}

/**
 * CLI version gate. Anything unparseable or unknown assumes the newest
 * behavior: awefork would rather try the modern call and fail loudly than
 * silently take a degraded path.
 */
function atLeastCodex(version: string | null | undefined, minor: number, patch: number): boolean {
  if (!version) return true;
  const [major = 0, minorPart = 0, patchPart = 0] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if ([major, minorPart, patchPart].some((part) => Number.isNaN(part))) return true;
  if (major !== 0) return true;
  return minorPart > minor || (minorPart === minor && patchPart >= patch);
}

/** lastTurnId landed in codex 0.154; older CLIs take the rollback fallback. */
function supportsLastTurnFork(version: string | null | undefined): boolean {
  return atLeastCodex(version, 154, 0);
}

/**
 * `thread/read` landed in codex 0.154 — the same release that introduced the
 * per-thread writer lock, so a CLI without thread/read is a CLI whose resume
 * cannot collide.
 */
function supportsThreadRead(version: string | null | undefined): boolean {
  return atLeastCodex(version, 154, 0);
}

function emitCodexNotification(
  method: string,
  params: unknown,
  emit: (event: AgentEvent) => void,
  activeTurns: Map<string, string>,
  usageByThread: Map<string, { turnId: string; usage: CodexTokenUsage }>,
  /** Fires where a thread's turn is over — success, idle twin, or failure. */
  onTurnEnd?: (threadId: string) => void,
): void {
  const p = (params ?? {}) as {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    delta?: string;
    turn?: { id?: string; error?: { message?: string } | null };
    item?: CodexItem;
    startedAtMs?: number;
    completedAtMs?: number;
    willRetry?: boolean;
    error?: { message?: string };
    status?: { type?: string };
    tokenUsage?: CodexTokenUsage | null;
  };
  const threadId = typeof p.threadId === "string" ? p.threadId : null;
  switch (method) {
    case "error": {
      if (p.willRetry) break;
      const message = p.error?.message ?? "unknown codex error";
      emit({ type: "server.error", sessionId: threadId, message: `codex: ${message}` });
      // A fatal error ends the turn too — its staged files are done for.
      if (threadId) onTurnEnd?.(threadId);
      break;
    }
    case "turn/started": {
      const turnId = p.turn?.id ?? null;
      if (!threadId || !turnId) break;
      activeTurns.set(threadId, turnId);
      emit({ type: "message.started", sessionId: threadId, messageId: turnId });
      break;
    }
    case "turn/completed": {
      if (!threadId) break;
      activeTurns.delete(threadId);
      if (p.turn?.error?.message) {
        emit({
          type: "server.error",
          sessionId: threadId,
          message: `codex: ${p.turn.error.message}`,
        });
      }
      onTurnEnd?.(threadId);
      emit({ type: "session.idle", sessionId: threadId });
      break;
    }
    case "thread/status/changed": {
      // The idle twin of turn/completed: handling both means a dropped frame
      // of either kind still finishes the run in UI.
      if (!threadId) break;
      if (p.status?.type === "active") {
        emit({ type: "message.started", sessionId: threadId, messageId: "" });
      } else if (p.status?.type === "idle") {
        // Mirror turn/completed's bookkeeping: without this, a dropped
        // completed frame leaves a stale turnId that a later abort would
        // interrupt (and surface as a raw codex error).
        activeTurns.delete(threadId);
        onTurnEnd?.(threadId);
        emit({ type: "session.idle", sessionId: threadId });
      }
      break;
    }
    case "thread/tokenUsage/updated": {
      // codex persists usage only as an untyped rollout event and its turn
      // list drops it, so this frame is the meter's only source. Record it
      // against the turn it arrived on, then nudge the renderer to reload so
      // the meter paints without waiting for the idle reload.
      const turnId = p.turnId ?? activeTurns.get(threadId ?? "") ?? null;
      if (!threadId || !turnId || !p.tokenUsage) break;
      usageByThread.set(threadId, { turnId, usage: p.tokenUsage });
      emit({ type: "session.updated", sessionId: threadId });
      break;
    }
    case "item/agentMessage/delta": {
      if (!threadId || !p.turnId || !p.itemId || typeof p.delta !== "string") break;
      emit({
        type: "message.delta",
        sessionId: threadId,
        messageId: p.turnId,
        partId: p.itemId,
        kind: "text",
        delta: p.delta,
      });
      break;
    }
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta": {
      if (!threadId || !p.turnId || !p.itemId || typeof p.delta !== "string") break;
      emit({
        type: "message.delta",
        sessionId: threadId,
        messageId: p.turnId,
        // Summary deltas are a separate part so they never splice into the
        // raw reasoning stream mid-sentence.
        partId: method === "item/reasoning/summaryTextDelta" ? `${p.itemId}:summary` : p.itemId,
        kind: "thinking",
        delta: p.delta,
      });
      break;
    }
    case "item/started":
    case "item/completed": {
      const item = p.item;
      if (!threadId || !p.turnId || !item) break;
      // Full snapshots self-heal a dropped delta; other item kinds surface
      // through the idle message reload (tool rows live on the assistant row)
      // — but their start/end still stream as live chips, so a running
      // command or patch is visible the moment codex begins it.
      if (item.type === "agentMessage") {
        emit({
          type: "message.part",
          sessionId: threadId,
          messageId: p.turnId,
          partId: item.id,
          kind: "text",
          text: typeof item.text === "string" ? item.text : "",
          startedAt: method === "item/started" ? (p.startedAtMs ?? null) : null,
          endedAt: method === "item/completed" ? (p.completedAtMs ?? null) : null,
        });
      } else if (item.type === "reasoning") {
        const startedAt = method === "item/started" ? (p.startedAtMs ?? null) : null;
        const endedAt = method === "item/completed" ? (p.completedAtMs ?? null) : null;
        // The snapshot pair mirrors the delta pair above: raw content in the
        // item's own part, summaries in the :summary part. Folding the
        // summary into the main part's snapshot too would render it twice
        // for as long as the live stream is on screen (the idle reload
        // joins them into one thinking field).
        emit({
          type: "message.part",
          sessionId: threadId,
          messageId: p.turnId,
          partId: item.id,
          kind: "thinking",
          text: reasoningContentOf(item),
          startedAt,
          endedAt,
        });
        const summary = reasoningSummaryOf(item);
        if (summary) {
          emit({
            type: "message.part",
            sessionId: threadId,
            messageId: p.turnId,
            partId: `${item.id}:summary`,
            kind: "thinking",
            text: summary,
            startedAt,
            endedAt,
          });
        }
      } else {
        // Tool-like items (commandExecution, fileChange, mcpToolCall, …):
        // stream the chip live so the pane shows what the turn is doing while
        // it runs; the settled row's full tool list still lands via the idle
        // reload. text is the same chip label mapTurn uses.
        const tool = toolNameOfItem(item);
        if (tool) {
          emit({
            type: "message.part",
            sessionId: threadId,
            messageId: p.turnId,
            partId: item.id,
            kind: "tool",
            text: tool,
            startedAt: method === "item/started" ? (p.startedAtMs ?? null) : null,
            endedAt: method === "item/completed" ? (p.completedAtMs ?? null) : null,
          });
        }
      }
      break;
    }
    case "thread/started":
    case "thread/name/updated":
    case "thread/deleted":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/reverted":
    case "thread/queue/changed": {
      if (threadId) emit({ type: "session.updated", sessionId: threadId });
      break;
    }
    case "thread/compacted": {
      // codex folded the thread's history into a summary on its own (auto
      // compaction — there is no manual primitive). Surface it like opencode's
      // completed summarize: reload + 🗜 toast, instead of a silent refresh.
      if (threadId) {
        emit({ type: "session.updated", sessionId: threadId });
        emit({ type: "session.compressed", sessionId: threadId });
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Tool chip names for ChatMessage.toolNames (first-seen order) and for the
 * live tool parts streamed while a turn runs. commandExecution carries a
 * short command preview — a stack of identical "shell" chips says nothing
 * about what the turn is doing.
 */
function toolNameOfItem(item: CodexItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return commandChipLabel(item.command);
    case "fileChange":
      return "patch";
    case "mcpToolCall":
      return item.server && item.tool ? `${item.server}/${item.tool}` : (item.tool ?? "mcp");
    case "dynamicToolCall":
    case "collabAgentToolCall":
      return "tool";
    case "webSearch":
      return "web";
    case "subAgentActivity":
      return "subagent";
    case "imageGeneration":
      return "image";
    default:
      return null;
  }
}

/**
 * "shell · rg login" — the command collapsed to one line, truncated to a
 * pill-sized preview. Some codex builds send argv as string[], others as a
 * joined string; either is accepted. No readable command falls back to the
 * bare tool name.
 */
function commandChipLabel(command?: string | string[]): string {
  const raw = Array.isArray(command) ? command.join(" ") : command;
  const line = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!line) return "shell";
  return `shell · ${line.length > 24 ? `${line.slice(0, 24)}…` : line}`;
}

/**
 * Reasoning text helpers. Codex 0.154's `content` is string[] (older builds
 * sent {text}[] — both accepted); summaries are always string[]. The join for
 * the persisted thinking field keeps content and summary in that order.
 */ function reasoningContentOf(item: CodexItem): string {
  return (item.content ?? [])
    .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
    .join("\n\n")
    .trim();
}

function reasoningSummaryOf(item: CodexItem): string {
  return (item.summary ?? []).join("\n\n").trim();
}

function reasoningTextOf(item: CodexItem): string {
  return [reasoningContentOf(item), reasoningSummaryOf(item)].filter(Boolean).join("\n\n");
}

/**
 * Filenames of the images a user turn carried. codex echoes each back as a
 * `localImage` part holding the staged file's path; staging names files
 * after the originals, so the path's basename is the name the composer
 * showed and history shows the same chip.
 */
function imageNamesOf(content: CodexItem["content"]): string[] {
  const names: string[] = [];
  for (const part of content ?? []) {
    if (typeof part === "string" || part.type !== "localImage") continue;
    if (typeof part.path !== "string") continue;
    const name = part.path.split(/[\\/]/).pop();
    if (name) names.push(name);
  }
  return names;
}

function interactionRequest(
  requestId: string,
  method: string,
  params: unknown,
): AgentInteractionRequest | null {
  const p = (params ?? {}) as Record<string, unknown>;
  const sessionId = typeof p.threadId === "string" ? p.threadId : null;
  const reason = typeof p.reason === "string" ? p.reason : undefined;
  switch (method) {
    case "item/commandExecution/requestApproval": {
      const command = typeof p.command === "string" ? p.command : "";
      if (!command) return null;
      return {
        requestId,
        sessionId,
        kind: "command-approval",
        title: "Run this command?",
        detail: reason ?? "Codex is asking to run a command.",
        command,
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        reason,
      };
    }
    case "item/fileChange/requestApproval":
      return {
        requestId,
        sessionId,
        kind: "file-approval",
        title: "Edit these files?",
        detail: reason ?? "Codex is asking to edit files.",
        grantRoot: typeof p.grantRoot === "string" ? p.grantRoot : undefined,
        reason,
      };
    case "item/permissions/requestApproval":
      return {
        requestId,
        sessionId,
        kind: "permission-approval",
        title: "Grant extra permissions?",
        detail: reason ?? "Codex is asking to widen this turn's permissions.",
        requested: permissionSummary(p.permissions),
        reason,
      };
    case "item/tool/requestUserInput": {
      const questions = Array.isArray(p.questions)
        ? p.questions.flatMap((question) => {
            const q = question as Record<string, unknown>;
            const id = typeof q.id === "string" ? q.id : null;
            const questionText = typeof q.question === "string" ? q.question : null;
            if (!id || !questionText) return [];
            return [
              {
                id,
                header: typeof q.header === "string" ? q.header : "Your input is needed",
                question: questionText,
                options: Array.isArray(q.options)
                  ? q.options.flatMap((option) => {
                      const o = option as Record<string, unknown>;
                      return typeof o.label === "string"
                        ? [
                            {
                              label: o.label,
                              description: typeof o.description === "string" ? o.description : "",
                            },
                          ]
                        : [];
                    })
                  : undefined,
                isSecret: q.isSecret === true,
              },
            ];
          })
        : [];
      if (questions.length === 0) return null;
      return {
        requestId,
        sessionId,
        kind: "user-input",
        title: "Codex needs your input",
        detail: reason ?? "",
        questions,
      };
    }
    case "mcpServer/elicitation/request":
      return {
        requestId,
        sessionId,
        kind: "mcp-elicitation",
        title: "MCP server requests input",
        detail: typeof p.message === "string" ? p.message : (reason ?? ""),
        serverName: typeof p.serverName === "string" ? p.serverName : "MCP",
      };
    default:
      return null;
  }
}

function interactionReply(method: string, response: AgentInteractionResponse): unknown {
  // codex has no "save this rule" reply; its dialogs never offer the button,
  // so an "always" that somehow arrives lands as a plain allow.
  const allowed = response.decision === "allow" || response.decision === "always";
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: allowed ? "accept" : "decline" };
    case "item/permissions/requestApproval":
      return { permissions: allowed ? {} : { fileSystem: null, network: null } };
    case "item/tool/requestUserInput":
      return response.decision === "answers" ? { answers: response.answers } : { answers: {} };
    case "mcpServer/elicitation/request":
      return { action: allowed ? "accept" : "decline" };
    default:
      return { decision: { denied: { rejection: "the user declined this action" } } };
  }
}

function permissionSummary(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["extra permissions"];
  const permissions = value as Record<string, unknown>;
  const result: string[] = [];
  if (permissions.fileSystem) result.push("file system access");
  if (permissions.network) result.push("network access");
  return result.length > 0 ? result : ["extra permissions"];
}
