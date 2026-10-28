import type {
  BackendCapabilities,
  BackendEventEnvelope,
  BackendId,
  BackendsResult,
} from "./backend.js";
import type { DiagnosticEntry, DiagnosticUpdate } from "./diagnostics.js";
import type { LineDiffResult } from "./diff.js";
import type { DigestGroup } from "./digest-types.js";
import type {
  DirListing,
  FileEntry,
  FileStat,
  FsResult,
  ImagePreview,
  SearchOptions,
  TextPreview,
} from "./file-types.js";
import type {
  OverviewLedgerSnapshot,
  OverviewReadEntry,
  OverviewReadLedger,
  OverviewReadUpdate,
} from "./overview-ledger-types.js";
import type { OverviewListing, OverviewRunningEntry } from "./overview-listing.js";
import type { RoundRecord } from "./rounds-types.js";
import type {
  AgentInteractionResponse,
  ArchiveKind,
  ArchiveState,
  ChatMessage,
  ForkOptions,
  ForkRecord,
  ModelChoice,
  ModelOption,
  PersistedComposer,
  PromptAttachment,
  SessionFileChanges,
  SessionSummary,
  TrashEntry,
} from "./types.js";

/** One cross-window jump: the window that owns `backend` lands this session. */
export interface AgentNavigateRequest {
  backend: BackendId;
  sessionId: string;
}

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
  fork(
    backend: BackendId,
    sessionId: string,
    atMessageId: string | null,
    options?: ForkOptions,
  ): Promise<SessionSummary>;
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
  /**
   * Fold the session's history into a summary (session compaction). History
   * stays intact on the backend — later prompts just carry summary + recent
   * turns. Fire-and-forget like prompt: completion arrives as a
   * session.compressed event.
   */
  compressSession(backend: BackendId, sessionId: string, model: ModelChoice): Promise<void>;
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
  /** Directories registered by hand before the resident folder existed
   *  (dirs.json sidecar). Read once at boot so an upgrade can adopt the
   *  first entry; nothing writes it anymore. */
  dirs(backend: BackendId): Promise<string[]>;
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
  /**
   * Focus the agent's dedicated window, opening one when none exists. Bounded
   * by the agent count — a second ask for the same agent never spawns a window.
   */
  openAgentWindow(backend: BackendId): Promise<{ ok: boolean; error?: string }>;
  /**
   * Multi-window jump: focus (or open) the backend's own window and have it
   * land the session, keeping this window's identity intact. The renderer
   * receives the landing through onAgentNavigate. `pending` reports that no
   * live window had claimed the backend yet, so main parked the navigation
   * until one boots — the landing still arrives through onAgentNavigate, or
   * is dropped when its window never claims it.
   */
  requestAgentNavigate(
    backend: BackendId,
    sessionId: string,
  ): Promise<{ ok: boolean; error?: string; pending?: boolean }>;
  /** Main → renderer: land this session (an overview jump routed to this window). */
  onAgentNavigate(handler: (request: AgentNavigateRequest) => void): () => void;
  /**
   * Tell main this window subscribes to onAgentNavigate for its active
   * backend — a navigation parks until some window claims it, so a jump into
   * a window that is still booting waits instead of vanishing. Returns false
   * when nothing was parked (the normal case) or the parked jump went stale.
   */
  agentNavigateReady(backend: BackendId): Promise<boolean>;
  /** Feature surface of a backend; hides affordances the backend lacks. */
  capabilities(backend: BackendId): Promise<BackendCapabilities>;
  /**
   * One-click install of a supported agent CLI's latest version (npm -g).
   * {ok:false,error} when the backend has no one-command install (zcode) or
   * the install command failed; on success a backends() re-probe sees it.
   */
  installBackend(backend: BackendId): Promise<{ ok: boolean; error?: string }>;
  /** Whether the first-run agent-install guide already ran (persisted). */
  onboardingDone(): Promise<boolean>;
  /** Mark the first-run guide as run — shown or skipped, it never returns. */
  finishOnboarding(): Promise<void>;
  /**
   * Whether quitting keeps the spawned backends alive so in-flight turns
   * finish in the background (persisted in settings.json; default false).
   */
  quitKeepAlive(): Promise<boolean>;
  setQuitKeepAlive(value: boolean): Promise<{ ok: boolean; error?: string }>;
  /**
   * Sessions with a run in flight across every backend — what quitting would
   * interrupt, and what keep-alive would let finish in the background.
   */
  runningSessionCount(): Promise<number>;
  /** Open a local drive path (reply references) with the OS handler. */
  openPath(target: string): Promise<{ ok: boolean; error?: string }>;
  /** Native folder picker for the ＋ New directory entry; null when canceled. */
  pickDirectory(): Promise<string | null>;
  /** Open the app data folder (settings storage) in the OS file manager. */
  openAppData(): Promise<{ ok: boolean; error?: string }>;
  /**
   * File browser surface (read-only, backend-free). Every fallible call
   * answers with an FsResult so the UI can phrase the failure; browsing
   * never touches the agent's project directory.
   */
  listDir(target: string): Promise<FsResult<DirListing>>;
  statFile(target: string): Promise<FsResult<FileStat>>;
  readTextPreview(target: string, maxBytes?: number): Promise<FsResult<TextPreview>>;
  readImagePreview(target: string, maxBytes?: number): Promise<FsResult<ImagePreview>>;
  /**
   * Whole-file bytes as a data URL, for the renderer's PDF rasterizer. The
   * mime is supplied by the caller because only the renderer knows which
   * parser will read the result.
   */
  readFileAsDataUrl(
    target: string,
    mime: string,
    maxBytes?: number,
  ): Promise<FsResult<{ path: string; dataUrl: string; bytes: number }>>;
  /** Project-relative path; value null = no relative path exists (cross-drive). */
  relativeToRoot(root: string, target: string): Promise<FsResult<string | null>>;
  searchFiles(root: string, query: string, options?: SearchOptions): Promise<FsResult<FileEntry[]>>;
  /** Home directory, anchoring the file panel's common locations. */
  homePath(): Promise<string>;
  /** Reveal an entry in the OS file manager. */
  showInFolder(target: string): Promise<{ ok: boolean; error?: string }>;
  /**
   * Resolve the real path of a File dropped in from outside the app (Finder).
   * null when the OS will not name it — the caller says so instead of
   * inventing a path or silently turning the drop into an attachment.
   */
  pathForFile(file: File): string | null;
  /**
   * Write text to a user-chosen path through a native save dialog. {ok:false}
   * when the dialog is canceled; {ok:false,error} when the write fails.
   */
  saveTextFile(
    defaultName: string,
    content: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>;
  openExternal(url: string): Promise<void>;
  /** Mirror the renderer palette into native window chrome (title bar). */
  setTheme(theme: "light" | "dark"): Promise<void>;
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
  /**
   * Canvas session overview: the unread ledger is owned by the main process
   * (one file, every window shares it), so a result marked seen in one window
   * stops being a badge in all of them. `overviewLedger` returns a snapshot
   * that a fresh window merges with broadcasts received while loading it.
   * `onOverviewRead` delivers sequence-stamped updates. Backend-first like
   * every adapter method.
   */
  overviewLedger(): Promise<OverviewLedgerSnapshot>;
  /** Persist this window's newest session-list timestamps for closed-app recovery. */
  overviewObserveSessions(
    backend: BackendId,
    sessions: Array<{ id: string; updatedAt: number }>,
    scannedAt: number,
  ): Promise<number>;
  /** Fold one observed run ending in; returns the entry it produced. */
  overviewRecordSettle(
    backend: BackendId,
    sessionId: string,
    failed: boolean,
    settleId?: string,
    runId?: string,
  ): Promise<OverviewReadEntry>;
  /** Persist that a previously observed run has no confirmed ending yet. */
  overviewSetUnknown(
    backend: BackendId,
    sessionId: string,
    unknown: boolean,
    runId?: string,
  ): Promise<boolean>;
  /**
   * Advance a session's seen watermark. `upTo` pins the revision the user was
   * actually shown, so a result that landed while messages were loading stays
   * unread. Returns the entry when it moved, null otherwise.
   */
  overviewMarkSeen(
    backend: BackendId,
    sessionId: string,
    upTo?: number,
  ): Promise<OverviewReadEntry | null>;
  /** Forget a deleted session's record; false when it had none. */
  overviewForget(backend: BackendId, sessionId: string): Promise<boolean>;
  /**
   * Fold this window's copy of the ledger into the authoritative one (a window
   * that ran ahead — offline, or migrating from the old per-window storage —
   * must contribute its revisions instead of dropping them). Returns the
   * merged ledger, which the caller applies in place of its snapshot.
   */
  overviewMergeLedger(incoming: OverviewReadLedger): Promise<OverviewReadLedger>;
  /** Every applied entry, from any window; subscribe after the snapshot. */
  onOverviewRead(handler: (update: OverviewReadUpdate) => void): () => void;
  /**
   * Canvas session overview, cross-window listings: the session lists of the
   * agents a window is NOT showing. Without a shared cache every window
   * refreshes its own copy on its own schedule, so two windows project
   * different session sets — and different running/unread counts — for the
   * same backend. `overviewPublishListing` stores what one window fetched and
   * broadcasts it; `overviewListings` hands a fresh window what is already
   * there; `onOverviewListing` keeps the rest in step. Newer-wins on
   * `fetchedAt`, so the freshest fetch — whichever window paid for it — is
   * what all of them render.
   */
  overviewListings(): Promise<Partial<Record<BackendId, OverviewListing>>>;
  overviewPublishListing(backend: BackendId, listing: OverviewListing): Promise<boolean>;
  onOverviewListing(
    handler: (payload: { backend: BackendId; listing: OverviewListing }) => void,
  ): () => void;
  /**
   * The runs main's registry watched start and has not seen end. A window
   * that opened mid-run never observed the start frame, so it seeds its run
   * state from this set at boot instead of showing an in-flight run as idle.
   */
  overviewRunning(): Promise<OverviewRunningEntry[]>;
  /**
   * Mirror the overview's "needs you" total onto the app icon (macOS Dock
   * badge). The renderer owns the projection; this only surfaces it where the
   * user looks when the window is buried. 0 clears the badge.
   */
  overviewBadge(count: number): Promise<boolean>;
  /**
   * Multi-model rounds sidecar (main-owned, one file every window shares).
   * The renderer's round groups are window-local memory, so without this a
   * restart forgets which branches form a round: its sessions degrade into
   * plain fork cards, and a round's summary branch even reads as a hand-made
   * ✂ empty-context fork. `roundsList` restores them at boot; `roundsSave`
   * upserts one round (false when the record fails validation).
   */
  roundsList(): Promise<RoundRecord[]>;
  roundsSave(record: RoundRecord): Promise<boolean>;
  /**
   * Story digests sidecar (main-owned, one file every window shares). Same
   * contract as the rounds sidecar: `digestsList` restores the digests at
   * boot (their ✦ cards and reading views must not depend on which window
   * ran them), `digestsSave` upserts one digest (false when it fails
   * validation).
   */
  digestsList(): Promise<DigestGroup[]>;
  digestsSave(group: DigestGroup): Promise<boolean>;
  /**
   * Status panel: the buffered main-process console lines of this app
   * session — backend children dying, spawns failing, subscriptions
   * collapsing — the failures a packaged launch has no terminal to print.
   * App-global (one buffer, every window reads the same tail), in-memory
   * only, oldest dropped past the cap. `onDiagnostic` streams new entries
   * and the app-global clear; subscribe before the snapshot resolves so
   * nothing that lands in between is missed.
   */
  diagnostics(): Promise<DiagnosticEntry[]>;
  clearDiagnostics(): Promise<void>;
  onDiagnostic(handler: (update: DiagnosticUpdate) => void): () => void;
}
