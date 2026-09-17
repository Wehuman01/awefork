import type {
  BackendCapabilities,
  BackendEventEnvelope,
  BackendId,
  BackendsResult,
} from "./backend.js";
import type { LineDiffResult } from "./diff.js";
import type {
  AgentInteractionResponse,
  ArchiveKind,
  ArchiveState,
  ChatMessage,
  ForkRecord,
  ModelChoice,
  ModelOption,
  PersistedComposer,
  PromptAttachment,
  SessionFileChanges,
  SessionSummary,
  TrashEntry,
} from "./types.js";

/** What awefork:check-updates resolves to. */
export interface CheckUpdatesResult {
  currentVersion: string;
  latest: string | null;
  updateAvailable: boolean;
}

/** Live bytes of an in-flight update download; total is 0 when unknown. */
export interface UpdateDownloadProgress {
  downloaded: number;
  total: number;
}

/** The tags.json sidecar's shape (see tags-store.ts on the main side). */
export interface TagStore {
  sessions: Record<string, string[]>;
  colors: Record<string, number>;
  /**
   * Parent session id → "inherit my tags when forked" preference. Absent
   * entry (or whole map) = ask on every fork; true/false = always/never
   * without asking. Only consulted for future forks — backfilling tags onto
   * already-existing children is always an explicit per-edit ask.
   */
  forkPref?: Record<string, boolean>;
}

/** One session the renderer asks main to scan, with its updatedAt so cached
 *  bodies can be reused across keystrokes. */
export interface SessionSearchTarget {
  id: string;
  updatedAt: number;
}

/** Terms the session BODY owes the query, pre-lowercased (search-query.ts). */
export interface BodySearchRequest {
  terms: string[];
  /** Substrings that veto a session when found in its body. */
  excludes: string[];
}

export interface BodySearchHit {
  sessionId: string;
  messageId: string;
  /** Window of the message text around the first match, "…" where trimmed. */
  snippet: string;
  /** Where the match starts inside `snippet`. */
  matchStart: number;
  matchLength: number;
}

export interface BodySearchResult {
  hits: BodySearchHit[];
  /** Sessions whose body contains an exclusion — vetoed everywhere. */
  excludedSessionIds: string[];
  /** Sessions whose messages were actually read (fetch failures excluded). */
  scanned: number;
}

/**
 * The full window.awefork surface exposed by the preload bridge. Declared once
 * so the preload implementation and the renderer's Window typing can't drift:
 * `src/renderer/src/env.d.ts` types `awefork` as this interface, and the
 * preload types its api object against it.
 *
 * Backend routing: every method that touches an agent adapter or an awefork
 * overlay store takes the backend as its FIRST argument — the renderer always
 * passes its active backend, main routes by that argument, and a switch can
 * never misroute an in-flight invoke. `onEvent` delivers envelopes tagged with
 * the emitting backend.
 */
export interface AweforkApi {
  ready(backend: BackendId): Promise<{ ok: boolean; error?: string }>;
  sessions(
    backend: BackendId,
  ): Promise<{ sessions: SessionSummary[]; lineage: Record<string, ForkRecord> }>;
  messages(backend: BackendId, sessionId: string): Promise<ChatMessage[]>;
  /**
   * Sidebar enhanced search: scan the listed sessions' bodies (message text
   * + tool names) for the pre-lowercased terms. Hits are capped per session
   * and overall; bodies are cached per sessionId+updatedAt in main.
   */
  searchMessages(
    backend: BackendId,
    targets: SessionSearchTarget[],
    request: BodySearchRequest,
  ): Promise<BodySearchResult>;
  models(backend: BackendId): Promise<ModelOption[]>;
  messageAttachments(
    backend: BackendId,
    sessionId: string,
    messageId: string,
  ): Promise<PromptAttachment[]>;
  createSession(backend: BackendId, directory?: string): Promise<SessionSummary>;
  fork(backend: BackendId, sessionId: string, atMessageId: string | null): Promise<SessionSummary>;
  /**
   * Copy the branch through `atMessageId` into a standalone native session
   * (no lineage, no canvas branch) that any opencode client can continue.
   * atMessageId null copies at the session's latest state.
   */
  exportSession(
    backend: BackendId,
    sessionId: string,
    atMessageId: string | null,
  ): Promise<SessionSummary>;
  deleteSession(backend: BackendId, sessionId: string): Promise<string[]>;
  deleteMessage(backend: BackendId, sessionId: string, messageId: string): Promise<void>;
  prompt(
    backend: BackendId,
    sessionId: string,
    text: string,
    model: ModelChoice | null,
    attachments?: PromptAttachment[],
  ): Promise<void>;
  abort(backend: BackendId, sessionId: string): Promise<void>;
  /**
   * Reply to a pending interaction (approval/tool-user-input) the backend is
   * waiting on. `requestId` is the backend's id for the pending request;
   * `response` is the approved/denied decision. Backend-first like every
   * adapter method, so a backend switch can't misroute a reply.
   */
  respondInteraction(
    backend: BackendId,
    requestId: string,
    response: AgentInteractionResponse,
  ): Promise<void>;
  renameSession(backend: BackendId, sessionId: string, title: string): Promise<void>;
  /**
   * Open the session in the backend's native TUI inside a system terminal
   * (`opencode -s` / `codex resume`, in the session's working directory).
   * {ok:false,error} surfaces as a toast — the terminal itself is external.
   */
  openSessionTerminal(
    backend: BackendId,
    sessionId: string,
  ): Promise<{ ok: boolean; error?: string }>;
  pins(backend: BackendId): Promise<string[]>;
  togglePin(backend: BackendId, sessionId: string): Promise<string[]>;
  /**
   * Key-turn marks (marks.json): `sessionId:messageId` keys the user starred.
   * Same overlay pattern as pins; keys match canvas turn node ids.
   */
  marks(backend: BackendId): Promise<string[]>;
  toggleMark(backend: BackendId, sessionId: string, messageId: string): Promise<string[]>;
  /** Session tags (tags.json sidecar): sessions map + per-tag color hues. */
  tags(backend: BackendId): Promise<TagStore>;
  /** Replace one session's tags (empty clears it); returns the whole store. */
  setSessionTags(backend: BackendId, sessionId: string, tags: string[]): Promise<TagStore>;
  /** Set (null clears) a tag's user-chosen hue; returns the whole store. */
  setTagColor(backend: BackendId, tag: string, hue: number | null): Promise<TagStore>;
  /** Remove a tag from every session; returns the whole store. */
  deleteTag(backend: BackendId, tag: string): Promise<TagStore>;
  /**
   * Union-add tags to several sessions in one serialized write (subtree
   * application); each session keeps its own order and unique tags. Returns
   * the whole store.
   */
  addTagsToSessions(backend: BackendId, sessionIds: string[], tags: string[]): Promise<TagStore>;
  /**
   * Set (null clears back to ask-every-time) one session's fork tag
   * inheritance preference; returns the whole store.
   */
  setForkTagPref(backend: BackendId, sessionId: string, pref: boolean | null): Promise<TagStore>;
  trash(backend: BackendId): Promise<TrashEntry[]>;
  trashAdd(backend: BackendId, sessionId: string, title: string): Promise<TrashEntry[]>;
  trashRemove(backend: BackendId, sessionId: string): Promise<TrashEntry[]>;
  archive(backend: BackendId): Promise<ArchiveState>;
  archiveAdd(backend: BackendId, kind: ArchiveKind, key: string): Promise<ArchiveState>;
  archiveRemove(backend: BackendId, kind: ArchiveKind, key: string): Promise<ArchiveState>;
  /** Directories the user added by hand (dirs.json sidecar): they keep a
   *  sidebar group even with zero conversations. */
  dirs(backend: BackendId): Promise<string[]>;
  /** Register a directory (dedupes); returns the whole list. */
  dirsAdd(backend: BackendId, directory: string): Promise<string[]>;
  /** Forget a registration — no session data moves; returns the whole list. */
  dirsRemove(backend: BackendId, directory: string): Promise<string[]>;
  /** The backend's unsent draft + pane model picks (composer.json sidecar). */
  composer(backend: BackendId): Promise<PersistedComposer | null>;
  saveComposer(backend: BackendId, value: PersistedComposer | null): Promise<void>;
  /** Per-turn file-change index of one session (observer sidecar). */
  fileChanges(backend: BackendId, sessionId: string): Promise<SessionFileChanges | null>;
  /** The saved diff of one entry, from its snapshot pair; null when unknown. */
  fileChangeDiff(
    backend: BackendId,
    sessionId: string,
    messageId: string,
    path: string,
  ): Promise<LineDiffResult | null>;
  /** Switcher data: installed probe (--version spawn, no server) + persisted selection. */
  backends(): Promise<BackendsResult>;
  /** Persist a selection; {ok:false,error} when the probe fails so the UI bounces back. */
  selectBackend(backend: BackendId): Promise<{ ok: boolean; error?: string }>;
  /** Feature surface of a backend; hides affordances the backend lacks. */
  capabilities(backend: BackendId): Promise<BackendCapabilities>;
  /** Open a local drive path (reply references) with the OS handler. */
  openPath(target: string): Promise<{ ok: boolean; error?: string }>;
  /** Native folder picker for ＋ 新目录; null when the user canceled. */
  pickDirectory(): Promise<string | null>;
  /**
   * Write text to a user-chosen path through a native save dialog. {ok:false}
   * when the dialog is canceled; {ok:false,error} when the write fails.
   */
  saveTextFile(
    defaultName: string,
    content: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>;
  openExternal(url: string): Promise<void>;
  convertDocument(filename: string, bytes: Uint8Array): Promise<string>;
  checkUpdates(respectSkip: boolean): Promise<CheckUpdatesResult>;
  skipUpdate(version: string): Promise<{ ok: boolean; error?: string }>;
  openRelease(version: string): Promise<{ ok: boolean; error?: string }>;
  /**
   * Download the release artifact and swap the app in place. macOS verifies
   * the DMG, replaces the bundle and relaunches (never resolves on success);
   * Windows launches the NSIS installer and resolves once it is running.
   */
  downloadAndInstallUpdate(version: string): Promise<{ ok: boolean; error?: string }>;
  /** Subscribe to update download progress; returns an unsubscribe function. */
  onUpdateProgress(handler: (progress: UpdateDownloadProgress) => void): () => void;
  onEvent(handler: (envelope: BackendEventEnvelope) => void): () => void;
}
