import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AgentNavigateRequest,
  AweforkApi,
  BodySearchRequest,
  BodySearchResult,
  CheckUpdatesResult,
  SessionSearchTarget,
  TagStore,
  UpdateDownloadProgress,
} from "../shared/awefork-api.js";
import type {
  BackendCapabilities,
  BackendEventEnvelope,
  BackendId,
  BackendsResult,
} from "../shared/backend.js";
import type { LineDiffResult } from "../shared/diff.js";
import type {
  DirListing,
  FileEntry,
  FileStat,
  FsResult,
  ImagePreview,
  SearchOptions,
  TextPreview,
} from "../shared/file-types.js";
import type {
  OverviewLedgerSnapshot,
  OverviewReadEntry,
  OverviewReadLedger,
  OverviewReadUpdate,
} from "../shared/overview-ledger-types.js";

import type {
  AgentInteractionResponse,
  ArchiveKind,
  ArchiveState,
  ChatMessage,
  ForkOptions,
  ModelChoice,
  ModelOption,
  PersistedComposer,
  PromptAttachment,
  SessionFileChanges,
  SessionSummary,
  TrashEntry,
} from "../shared/types.js";

// Mechanical bridge only: every method forwards its args to the matching
// awefork:* channel (backend first where the API takes one) and hands the
// result straight back. onEvent delivers {backend, event} envelopes.
const api: AweforkApi = {
  ready: (backend: BackendId): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:ready", backend),
  sessions: (
    backend: BackendId,
  ): Promise<{
    sessions: SessionSummary[];
    lineage: Record<string, { parentId: string; atMessageId: string | null; createdAt: number }>;
  }> => ipcRenderer.invoke("awefork:sessions", backend),
  messages: (backend: BackendId, sessionId: string): Promise<ChatMessage[]> =>
    ipcRenderer.invoke("awefork:messages", backend, sessionId),
  searchMessages: (
    backend: BackendId,
    targets: SessionSearchTarget[],
    request: BodySearchRequest,
  ): Promise<BodySearchResult> =>
    ipcRenderer.invoke("awefork:searchMessages", backend, targets, request),
  models: (backend: BackendId): Promise<ModelOption[]> =>
    ipcRenderer.invoke("awefork:models", backend),
  messageAttachments: (
    backend: BackendId,
    sessionId: string,
    messageId: string,
  ): Promise<PromptAttachment[]> =>
    ipcRenderer.invoke("awefork:messageAttachments", backend, sessionId, messageId),
  createSession: (backend: BackendId, directory?: string): Promise<SessionSummary> =>
    ipcRenderer.invoke("awefork:createSession", backend, directory),
  fork: (
    backend: BackendId,
    sessionId: string,
    atMessageId: string | null,
    options?: ForkOptions,
  ): Promise<SessionSummary> =>
    ipcRenderer.invoke("awefork:fork", backend, sessionId, atMessageId, options),
  exportSession: (
    backend: BackendId,
    sessionId: string,
    atMessageId: string | null,
  ): Promise<SessionSummary> =>
    ipcRenderer.invoke("awefork:exportSession", backend, sessionId, atMessageId),
  deleteSession: (backend: BackendId, sessionId: string): Promise<string[]> =>
    ipcRenderer.invoke("awefork:deleteSession", backend, sessionId),
  deleteMessage: (backend: BackendId, sessionId: string, messageId: string): Promise<void> =>
    ipcRenderer.invoke("awefork:deleteMessage", backend, sessionId, messageId),
  prompt: (
    backend: BackendId,
    sessionId: string,
    text: string,
    model: ModelChoice | null,
    attachments?: PromptAttachment[],
  ): Promise<void> =>
    ipcRenderer.invoke("awefork:prompt", backend, sessionId, text, model, attachments),
  compressSession: (backend: BackendId, sessionId: string, model: ModelChoice): Promise<void> =>
    ipcRenderer.invoke("awefork:compressSession", backend, sessionId, model),
  abort: (backend: BackendId, sessionId: string): Promise<void> =>
    ipcRenderer.invoke("awefork:abort", backend, sessionId),
  respondInteraction: (
    backend: BackendId,
    requestId: string,
    response: AgentInteractionResponse,
  ): Promise<void> =>
    ipcRenderer.invoke("awefork:respondInteraction", backend, requestId, response),
  renameSession: (backend: BackendId, sessionId: string, title: string): Promise<void> =>
    ipcRenderer.invoke("awefork:renameSession", backend, sessionId, title),
  openSessionTerminal: (
    backend: BackendId,
    sessionId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:openSessionTerminal", backend, sessionId),
  pins: (backend: BackendId): Promise<string[]> => ipcRenderer.invoke("awefork:pins", backend),
  togglePin: (backend: BackendId, sessionId: string): Promise<string[]> =>
    ipcRenderer.invoke("awefork:togglePin", backend, sessionId),
  marks: (backend: BackendId): Promise<string[]> => ipcRenderer.invoke("awefork:marks", backend),
  toggleMark: (backend: BackendId, sessionId: string, messageId: string): Promise<string[]> =>
    ipcRenderer.invoke("awefork:toggleMark", backend, sessionId, messageId),
  tags: (backend: BackendId): Promise<TagStore> => ipcRenderer.invoke("awefork:tags", backend),
  setSessionTags: (backend: BackendId, sessionId: string, tags: string[]): Promise<TagStore> =>
    ipcRenderer.invoke("awefork:setSessionTags", backend, sessionId, tags),
  setTagColor: (backend: BackendId, tag: string, hue: number | null): Promise<TagStore> =>
    ipcRenderer.invoke("awefork:setTagColor", backend, tag, hue),
  deleteTag: (backend: BackendId, tag: string): Promise<TagStore> =>
    ipcRenderer.invoke("awefork:deleteTag", backend, tag),
  addTagsToSessions: (
    backend: BackendId,
    sessionIds: string[],
    tags: string[],
  ): Promise<TagStore> =>
    ipcRenderer.invoke("awefork:addTagsToSessions", backend, sessionIds, tags),
  setForkTagPref: (
    backend: BackendId,
    sessionId: string,
    pref: boolean | null,
  ): Promise<TagStore> => ipcRenderer.invoke("awefork:setForkTagPref", backend, sessionId, pref),
  trash: (backend: BackendId): Promise<TrashEntry[]> =>
    ipcRenderer.invoke("awefork:trash", backend),
  trashAdd: (backend: BackendId, sessionId: string, title: string): Promise<TrashEntry[]> =>
    ipcRenderer.invoke("awefork:trashAdd", backend, sessionId, title),
  trashRemove: (backend: BackendId, sessionId: string): Promise<TrashEntry[]> =>
    ipcRenderer.invoke("awefork:trashRemove", backend, sessionId),
  archive: (backend: BackendId): Promise<ArchiveState> =>
    ipcRenderer.invoke("awefork:archive", backend),
  archiveAdd: (backend: BackendId, kind: ArchiveKind, key: string): Promise<ArchiveState> =>
    ipcRenderer.invoke("awefork:archiveAdd", backend, kind, key),
  archiveRemove: (backend: BackendId, kind: ArchiveKind, key: string): Promise<ArchiveState> =>
    ipcRenderer.invoke("awefork:archiveRemove", backend, kind, key),
  dirs: (backend: BackendId): Promise<string[]> => ipcRenderer.invoke("awefork:dirs", backend),
  composer: (backend: BackendId): Promise<PersistedComposer | null> =>
    ipcRenderer.invoke("awefork:composer", backend),
  saveComposer: (backend: BackendId, value: PersistedComposer | null): Promise<void> =>
    ipcRenderer.invoke("awefork:saveComposer", backend, value),
  fileChanges: (backend: BackendId, sessionId: string): Promise<SessionFileChanges | null> =>
    ipcRenderer.invoke("awefork:fileChanges", backend, sessionId),
  fileChangeDiff: (
    backend: BackendId,
    sessionId: string,
    messageId: string,
    path: string,
  ): Promise<LineDiffResult | null> =>
    ipcRenderer.invoke("awefork:fileChangeDiff", backend, sessionId, messageId, path),
  backends: (): Promise<BackendsResult> => ipcRenderer.invoke("awefork:backends"),
  selectBackend: (backend: BackendId): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:selectBackend", backend),
  openAgentWindow: (backend: BackendId): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:openAgentWindow", backend),
  capabilities: (backend: BackendId): Promise<BackendCapabilities> =>
    ipcRenderer.invoke("awefork:capabilities", backend),
  installBackend: (backend: BackendId): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:installBackend", backend),
  onboardingDone: (): Promise<boolean> => ipcRenderer.invoke("awefork:onboardingDone"),
  finishOnboarding: (): Promise<void> => ipcRenderer.invoke("awefork:finishOnboarding"),
  quitKeepAlive: (): Promise<boolean> => ipcRenderer.invoke("awefork:quitKeepAlive"),
  setQuitKeepAlive: (value: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:setQuitKeepAlive", value),
  runningSessionCount: (): Promise<number> => ipcRenderer.invoke("awefork:runningSessionCount"),
  openPath: (target: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:openPath", target),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("awefork:pickDirectory"),
  openAppData: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:openAppData"),
  listDir: (target: string): Promise<FsResult<DirListing>> =>
    ipcRenderer.invoke("awefork:listDir", target),
  statFile: (target: string): Promise<FsResult<FileStat>> =>
    ipcRenderer.invoke("awefork:statFile", target),
  readTextPreview: (target: string, maxBytes?: number): Promise<FsResult<TextPreview>> =>
    ipcRenderer.invoke("awefork:readTextPreview", target, maxBytes),
  readImagePreview: (target: string, maxBytes?: number): Promise<FsResult<ImagePreview>> =>
    ipcRenderer.invoke("awefork:readImagePreview", target, maxBytes),
  readFileAsDataUrl: (
    target: string,
    mime: string,
    maxBytes?: number,
  ): Promise<FsResult<{ path: string; dataUrl: string; bytes: number }>> =>
    ipcRenderer.invoke("awefork:readFileAsDataUrl", target, mime, maxBytes),
  relativeToRoot: (root: string, target: string): Promise<FsResult<string | null>> =>
    ipcRenderer.invoke("awefork:relativeToRoot", root, target),
  searchFiles: (
    root: string,
    query: string,
    options?: SearchOptions,
  ): Promise<FsResult<FileEntry[]>> =>
    ipcRenderer.invoke("awefork:searchFiles", root, query, options),
  homePath: (): Promise<string> => ipcRenderer.invoke("awefork:homePath"),
  showInFolder: (target: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:showInFolder", target),
  // webUtils.getPathForFile is the only sanctioned way to name a File that
  // arrived from outside the app; the legacy File.path is non-standard.
  pathForFile: (file: File): string | null => webUtils.getPathForFile(file),
  saveTextFile: (
    defaultName: string,
    content: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke("awefork:saveTextFile", defaultName, content),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("awefork:openExternal", url),
  setTheme: (theme: "light" | "dark"): Promise<void> =>
    ipcRenderer.invoke("awefork:setTheme", theme),
  convertDocument: (filename: string, bytes: Uint8Array): Promise<string> =>
    ipcRenderer.invoke("awefork:convertDocument", filename, bytes),
  checkUpdates: (respectSkip: boolean): Promise<CheckUpdatesResult> =>
    ipcRenderer.invoke("awefork:check-updates", respectSkip),
  skipUpdate: (version: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:skip-update", version),
  openRelease: (version: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:open-release", version),
  downloadAndInstallUpdate: (version: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:download-update", version),
  onUpdateProgress: (handler: (progress: UpdateDownloadProgress) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown) =>
      handler(payload as UpdateDownloadProgress);
    ipcRenderer.on("awefork:update-progress", listener);
    return () => ipcRenderer.removeListener("awefork:update-progress", listener);
  },
  onEvent: (handler: (envelope: BackendEventEnvelope) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown) =>
      handler(payload as BackendEventEnvelope);
    ipcRenderer.on("awefork:event", listener);
    return () => ipcRenderer.removeListener("awefork:event", listener);
  },
  overviewLedger: (): Promise<OverviewLedgerSnapshot> =>
    ipcRenderer.invoke("awefork:overviewLedger"),
  overviewObserveSessions: (
    backend: BackendId,
    sessions: Array<{ id: string; updatedAt: number }>,
    scannedAt: number,
  ): Promise<number> =>
    ipcRenderer.invoke("awefork:overviewObserveSessions", backend, sessions, scannedAt),
  overviewRecordSettle: (
    backend: BackendId,
    sessionId: string,
    failed: boolean,
    settleId?: string,
    runId?: string,
  ): Promise<OverviewReadEntry> =>
    ipcRenderer.invoke("awefork:overviewRecordSettle", backend, sessionId, failed, settleId, runId),
  overviewSetUnknown: (
    backend: BackendId,
    sessionId: string,
    unknown: boolean,
    runId?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("awefork:overviewSetUnknown", backend, sessionId, unknown, runId),
  overviewMarkSeen: (
    backend: BackendId,
    sessionId: string,
    upTo?: number,
  ): Promise<OverviewReadEntry | null> =>
    ipcRenderer.invoke("awefork:overviewMarkSeen", backend, sessionId, upTo),
  overviewForget: (backend: BackendId, sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke("awefork:overviewForget", backend, sessionId),
  overviewMergeLedger: (incoming: OverviewReadLedger): Promise<OverviewReadLedger> =>
    ipcRenderer.invoke("awefork:overviewMergeLedger", incoming),
  onOverviewRead: (handler: (update: OverviewReadUpdate) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload as OverviewReadUpdate);
    ipcRenderer.on("awefork:overview-read", listener);
    return () => ipcRenderer.removeListener("awefork:overview-read", listener);
  },
  requestAgentNavigate: (
    backend: BackendId,
    sessionId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("awefork:requestAgentNavigate", backend, sessionId),
  onAgentNavigate: (handler: (request: AgentNavigateRequest) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown) =>
      handler(payload as AgentNavigateRequest);
    ipcRenderer.on("awefork:agent-navigate", listener);
    return () => ipcRenderer.removeListener("awefork:agent-navigate", listener);
  },
};

contextBridge.exposeInMainWorld("awefork", api);
