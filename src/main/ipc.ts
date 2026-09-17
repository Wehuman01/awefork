import { BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from "electron";
import { canonicalizeStoredArchive, setArchived } from "../shared/archive-store.js";
import { type BackendId, isBackendId } from "../shared/backend.js";
import {
  canonicalDirectory,
  canonicalizeArchiveDirectories,
  canonicalizeDirectoryList,
} from "../shared/canonical-paths.js";
import { readComposer, writeComposer } from "../shared/composer-store.js";
import { lineDiff } from "../shared/diff.js";
import { addDir, canonicalizeStoredDirs, removeDir } from "../shared/dirs-store.js";
import {
  clearSessionChanges,
  type FileChangeEntry,
  findEntry,
  readSessionChanges,
  readSnapshotBlob,
  sessionChangesDir,
} from "../shared/file-changes.js";
import { readLineage } from "../shared/lineage-store.js";
import { isLocalPath } from "../shared/local-path.js";
import { pruneSessionMarks, pruneTurnMark, readMarks, toggleMark } from "../shared/marks-store.js";
import { prunePin, readPins, togglePin } from "../shared/pins-store.js";
import {
  addTagsToSessions,
  deleteTag,
  pruneTags,
  readTags,
  setForkTagPref,
  setSessionTags,
  setTagColor,
} from "../shared/tags-store.js";
import { addTrashEntry, readTrash, removeTrashEntry } from "../shared/trash-store.js";
import type {
  AgentInteractionResponse,
  ArchiveKind,
  ArchiveState,
  ForkOptions,
  ModelChoice,
  PersistedComposer,
  PromptAttachment,
} from "../shared/types.js";
import type { BackendRegistry } from "./backend-registry.js";
import {
  codexHomeForSession,
  codexRolloutProviderFallback,
  terminalDefaultCodexHome,
} from "./codex-homes.js";
import { convertDocumentToText } from "./document-convert.js";
import { createMessageSearcher, type MessageSearcher } from "./message-search.js";
import { findPiSessionFile } from "./pi-server.js";
import { openSessionInTerminal } from "./session-terminal.js";
import { checkForUpdates, openRelease, skipUpdate } from "./update-check.js";
import { downloadAndInstallUpdate } from "./update-install.js";
import { resolveZcodeCli } from "./zcode-server.js";

/**
 * IPC surface (all invoke-channels, prefixed awefork:). Every method that
 * touches an agent adapter or an awefork overlay store takes the backend as
 * its FIRST argument — the renderer always passes its active backend, main
 * routes by that argument, and a backend switch can never misroute an
 * in-flight invoke. Adapter-backed channels:
 *   ready(backend)          -> { ok, error? }       adapter status after startup
 *   sessions(backend)       -> {sessions, lineage}  sessions + lineage merged
 *   messages(backend, id)   -> ChatMessage[]        flat message list of a session
 *   searchMessages(backend, targets, request) -> BodySearchResult
 *                                                sidebar body scan (cached)
 *   models(backend)         -> ModelOption[]        models offered by the agent config
 *   messageAttachments(backend, session, message) -> PromptAttachment[] (retry prefill)
 *   createSession(backend, directory?) -> SessionSummary
 *   fork(backend, id, atMessageId | null, {context}?) -> SessionSummary
 *                           (turn-preserving; context "none" = empty fork)
 *   exportSession(backend, id, atMessageId | null) -> SessionSummary
 *                           standalone native copy, no lineage recorded
 *   deleteSession(backend, id) -> string[]          delete, pruned pins back
 *   deleteMessage(backend, session, message) -> void (native DELETE)
 *   prompt(backend, id, text, model, attachments?) -> void
 *   abort(backend, id)      -> void                 abort the running turn
 *   respondInteraction(backend, requestId, response) -> void  reply to a pending
 *                                                approval/interaction request
 *   renameSession(backend, id, title) -> void
 *   openSessionTerminal(backend, id) -> {ok, error?}  TUI in a system terminal
 * Overlay-store channels (per-backend files, no adapter spawn):
 *   pins / togglePin / marks / toggleMark / tags / setSessionTags / setTagColor /
 *   deleteTag / addTagsToSessions / setForkTagPref / trash / trashAdd / trashRemove /
 *   archive / archiveAdd / archiveRemove / dirs / dirsAdd / dirsRemove /
 *   composer / saveComposer — same
 *   shapes as before, backend-routed (composer holds the unsent draft + pane
 *   model picks; tags returns { sessions, colors, forkPref? }; dirs is the
 *   hand-added sidebar directories).
 * Backend switcher:
 *   backends      -> { selected, backends: BackendInfo[] } (probe, no spawn)
 *   selectBackend -> { ok, error? }                persists; probe failure bounces back
 *   capabilities  -> { deleteMessage, attachments }
 * App-level (backend-free): openExternal, openPath, pickDirectory,
 * convertDocument, checkUpdates, skipUpdate, openRelease, downloadUpdate.
 * Update download progress arrives on channel "awefork:update-progress" as
 * {downloaded,total}. Events are forwarded on channel "awefork:event" as
 * {backend, event}.
 */
export function registerIpc(registry: BackendRegistry): void {
  const withAdapter = async (backend: BackendId) => registry.get(backend);
  // Store channels take the backend from the invoke; unknown ids route to the
  // default rather than throwing so a stale renderer can't wedge the store.
  const storeBackend = (value: unknown): BackendId => (isBackendId(value) ? value : "opencode");

  ipcMain.handle("awefork:ready", async (_event: IpcMainInvokeEvent, backend: BackendId) => {
    try {
      await withAdapter(storeBackend(backend));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("awefork:sessions", async (_event: IpcMainInvokeEvent, backend: BackendId) => {
    const id = storeBackend(backend);
    const adapter = await withAdapter(id);
    const sessions = await adapter.listSessions();
    const lineage = await readLineage(registry.storePaths(id).lineage);
    return { sessions, lineage };
  });

  ipcMain.handle(
    "awefork:messages",
    async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) => {
      const adapter = await withAdapter(storeBackend(backend));
      return adapter.messages(sessionId);
    },
  );

  // Sidebar enhanced search: body scan with a per-backend session cache.
  // One searcher per backend keeps codex/opencode caches from cross-filling.
  const searchers = new Map<BackendId, MessageSearcher>();
  ipcMain.handle(
    "awefork:searchMessages",
    async (_event: IpcMainInvokeEvent, backend: BackendId, targets: unknown, request: unknown) => {
      const id = storeBackend(backend);
      let searcher = searchers.get(id);
      if (!searcher) {
        searcher = createMessageSearcher(() => withAdapter(id));
        searchers.set(id, searcher);
      }
      // IPC boundary: trust nothing about the shape, keep the searcher pure.
      const safeTargets = (Array.isArray(targets) ? targets : []).filter(
        (target): target is { id: string; updatedAt: number } =>
          typeof target?.id === "string" && typeof target?.updatedAt === "number",
      );
      const raw = (request ?? {}) as { terms?: unknown; excludes?: unknown };
      const strings = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((term): term is string => typeof term === "string")
          : [];
      return searcher.search(safeTargets, {
        terms: strings(raw.terms),
        excludes: strings(raw.excludes),
      });
    },
  );

  ipcMain.handle("awefork:models", async (_event: IpcMainInvokeEvent, backend: BackendId) => {
    const adapter = await withAdapter(storeBackend(backend));
    return adapter.listModels();
  });

  // Retry prefill: the composer asks for a message's original file parts so a
  // retried prompt carries the same attachments.
  ipcMain.handle(
    "awefork:messageAttachments",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      messageId: string,
    ) => {
      const adapter = await withAdapter(storeBackend(backend));
      return adapter.messageAttachments(sessionId, messageId);
    },
  );

  ipcMain.handle(
    "awefork:createSession",
    async (_event: IpcMainInvokeEvent, backend: BackendId, directory?: string) => {
      const adapter = await withAdapter(storeBackend(backend));
      return adapter.createSession(directory);
    },
  );

  ipcMain.handle(
    "awefork:fork",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      atMessageId: string | null,
      options?: ForkOptions,
    ) => {
      const adapter = await withAdapter(storeBackend(backend));
      return adapter.fork(sessionId, atMessageId, options);
    },
  );

  // Standalone copy of a branch: same native fork primitive, no lineage
  // record — the exported session lands as a plain root session. Rejects on
  // backends whose fork linkage lives in the backend itself (capabilities).
  ipcMain.handle(
    "awefork:exportSession",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      atMessageId: string | null,
    ) => {
      const id = storeBackend(backend);
      const adapter = await withAdapter(id);
      if (!registry.capabilities(id).exportBranch) {
        throw new Error("这个后端不支持导出独立会话");
      }
      return adapter.exportSession(sessionId, atMessageId);
    },
  );

  // Returns the pins list after pruning the deleted session, so the renderer
  // can update its canvas residents in one round-trip.
  ipcMain.handle(
    "awefork:deleteSession",
    async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) => {
      const id = storeBackend(backend);
      const adapter = await withAdapter(id);
      await adapter.deleteSession(sessionId);
      // The file-change sidecar is evidence about a session that no longer
      // exists; it leaves with the session (best effort — the delete already
      // succeeded and must not report failure over a sidecar).
      void clearSessionChanges(sessionChangesDir(registry.fileChangesDir(id), sessionId)).catch(
        () => {},
      );
      // Tags outlive nothing: the session is gone, prune the label too.
      void pruneTags(registry.storePaths(id).tags, sessionId).catch(() => {});
      void pruneSessionMarks(registry.storePaths(id).marks, sessionId).catch(() => {});
      return prunePin(registry.storePaths(id).pins, sessionId);
    },
  );

  ipcMain.handle(
    "awefork:prompt",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      text: string,
      model: ModelChoice | null,
      attachments?: PromptAttachment[],
    ) => {
      const adapter = await withAdapter(storeBackend(backend));
      await adapter.prompt(sessionId, text, model ?? undefined, attachments);
    },
  );

  ipcMain.handle(
    "awefork:abort",
    async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) => {
      const adapter = await withAdapter(storeBackend(backend));
      await adapter.abort(sessionId);
    },
  );

  // Reply to a pending backend interaction (approval/tool-user-input). The
  // adapter resolves its pending request by `requestId`, so the renderer
  // only ever sees the id the backend handed out. Replying to an unknown or
  // already-settled request is a silent no-op — the JSON-RPC layer safe-
  // replied it at its deadline, so a stale dialog click cannot double-answer.
  ipcMain.handle(
    "awefork:respondInteraction",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      requestId: string,
      response: AgentInteractionResponse,
    ) => {
      const adapter = await withAdapter(storeBackend(backend));
      await adapter.respondInteraction(requestId, response);
    },
  );

  ipcMain.handle(
    "awefork:deleteMessage",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      messageId: string,
    ) => {
      const id = storeBackend(backend);
      const adapter = await withAdapter(id);
      await adapter.deleteMessage(sessionId, messageId);
      // The mark pointed at a turn that no longer exists; drop it with the row.
      void pruneTurnMark(registry.storePaths(id).marks, sessionId, messageId).catch(() => {});
    },
  );

  ipcMain.handle(
    "awefork:renameSession",
    async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string, title: string) => {
      const adapter = await withAdapter(storeBackend(backend));
      await adapter.renameSession(sessionId, title);
    },
  );

  // Open the session's TUI in a system terminal (opencode -s / codex resume).
  // The session is re-resolved through the adapter rather than trusting the
  // renderer for the working directory; codex sessions in aweswitch account
  // homes additionally carry that home's CODEX_HOME so the TUI can see them.
  // A rollout recorded under a provider the home's config no longer defines
  // gets the current default forced on, or the resume crashes at bootstrap.
  ipcMain.handle(
    "awefork:openSessionTerminal",
    async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) => {
      const id = storeBackend(backend);
      const adapter = await withAdapter(id);
      const sessions = await adapter.listSessions();
      const session = sessions.find((entry) => entry.id === sessionId);
      if (!session) return { ok: false, error: `会话 ${sessionId} 不存在，可能已被删除` };
      let codexHome: string | null = null;
      let codexProviderOverride: string | null = null;
      if (id === "codex") {
        const home = codexHomeForSession(sessionId);
        // Compare against ~/.codex, not the home id: a session under an
        // inherited CODEX_HOME lives in the "default" home yet still needs
        // the export, or the terminal codex looks in ~/.codex.
        codexHome = home !== null && home.path !== terminalDefaultCodexHome() ? home.path : null;
        codexProviderOverride =
          home !== null ? codexRolloutProviderFallback(home.path, sessionId) : null;
      }
      // pi resumes by session FILE (no resume-by-id flag); zcode by id but
      // through its bundled CLI, which is not on PATH.
      let sessionFile: string | null = null;
      let zcodeCli: string | null = null;
      if (id === "pi") {
        sessionFile = await findPiSessionFile(sessionId);
      } else if (id === "zcode") {
        const cli = await resolveZcodeCli();
        // The bundle install runs `node <script>`; a PATH install has no
        // script to hand the terminal script.
        zcodeCli = cli?.args[0] ?? null;
      }
      return openSessionInTerminal({
        backend: id,
        sessionId,
        directory: session.directory,
        codexHome,
        codexProviderOverride,
        sessionFile,
        zcodeCli,
      });
    },
  );

  // ── per-backend overlay stores ─────────────────────────────────────────

  ipcMain.handle("awefork:pins", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    readPins(registry.storePaths(storeBackend(backend)).pins),
  );

  ipcMain.handle(
    "awefork:togglePin",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) =>
      togglePin(registry.storePaths(storeBackend(backend)).pins, sessionId),
  );

  ipcMain.handle("awefork:marks", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    readMarks(registry.storePaths(storeBackend(backend)).marks),
  );

  ipcMain.handle(
    "awefork:toggleMark",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string, messageId: string) =>
      toggleMark(registry.storePaths(storeBackend(backend)).marks, sessionId, messageId),
  );

  ipcMain.handle("awefork:tags", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    readTags(registry.storePaths(storeBackend(backend)).tags),
  );

  ipcMain.handle(
    "awefork:setSessionTags",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string, tags: string[]) =>
      setSessionTags(registry.storePaths(storeBackend(backend)).tags, sessionId, tags),
  );

  ipcMain.handle(
    "awefork:setTagColor",
    (_event: IpcMainInvokeEvent, backend: BackendId, tag: string, hue: number | null) =>
      setTagColor(registry.storePaths(storeBackend(backend)).tags, tag, hue),
  );

  ipcMain.handle(
    "awefork:deleteTag",
    (_event: IpcMainInvokeEvent, backend: BackendId, tag: string) =>
      deleteTag(registry.storePaths(storeBackend(backend)).tags, tag),
  );

  ipcMain.handle(
    "awefork:addTagsToSessions",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionIds: string[], tags: string[]) =>
      addTagsToSessions(registry.storePaths(storeBackend(backend)).tags, sessionIds, tags),
  );

  ipcMain.handle(
    "awefork:setForkTagPref",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string, pref: boolean | null) =>
      setForkTagPref(registry.storePaths(storeBackend(backend)).tags, sessionId, pref),
  );

  ipcMain.handle("awefork:trash", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    readTrash(registry.storePaths(storeBackend(backend)).trash),
  );

  ipcMain.handle(
    "awefork:trashAdd",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string, title: string) =>
      addTrashEntry(registry.storePaths(storeBackend(backend)).trash, sessionId, title),
  );

  ipcMain.handle(
    "awefork:trashRemove",
    (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) =>
      removeTrashEntry(registry.storePaths(storeBackend(backend)).trash, sessionId),
  );

  // Archive keys on directory paths canonicalize on the way in and out, so a
  // hidden project stays hidden however its sessions report their directory.
  // Pre-upgrade sidecars may still hold a symlinked spelling — migrate the
  // file once so later restore/remove match by exact string. The migration is
  // itself a queued read-modify-write (see canonicalizeStoredArchive): a read
  // outside the queue with a whole-file write could drop a concurrent
  // setArchived/change landing in between.
  async function loadCanonicalArchive(backend: BackendId): Promise<ArchiveState> {
    return canonicalizeStoredArchive(
      registry.storePaths(storeBackend(backend)).archive,
      canonicalizeArchiveDirectories,
    );
  }

  async function loadCanonicalDirs(backend: BackendId): Promise<string[]> {
    return canonicalizeStoredDirs(
      registry.storePaths(storeBackend(backend)).dirs,
      canonicalizeDirectoryList,
    );
  }

  ipcMain.handle("awefork:archive", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    loadCanonicalArchive(backend),
  );

  ipcMain.handle(
    "awefork:archiveAdd",
    async (_event: IpcMainInvokeEvent, backend: BackendId, kind: ArchiveKind, key: string) => {
      // Migrate first so a re-archive of a pre-upgrade spelling folds onto
      // one entry instead of stacking a second path that later lists as a twin.
      await loadCanonicalArchive(backend);
      return setArchived(
        registry.storePaths(storeBackend(backend)).archive,
        kind,
        kind === "directory" ? await canonicalDirectory(key) : key,
        true,
      );
    },
  );

  ipcMain.handle(
    "awefork:archiveRemove",
    async (_event: IpcMainInvokeEvent, backend: BackendId, kind: ArchiveKind, key: string) => {
      await loadCanonicalArchive(backend);
      return setArchived(
        registry.storePaths(storeBackend(backend)).archive,
        kind,
        kind === "directory" ? await canonicalDirectory(key) : key,
        false,
      );
    },
  );

  // Directories the user registered by hand (＋ 新目录): they render as a
  // sidebar group even before the first conversation exists there. Stored and
  // served canonicalized, so a hand-added spelling matches the session rows'
  // directories however the shell reported them.
  ipcMain.handle("awefork:dirs", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    loadCanonicalDirs(backend),
  );

  ipcMain.handle(
    "awefork:dirsAdd",
    async (_event: IpcMainInvokeEvent, backend: BackendId, directory: string) => {
      await loadCanonicalDirs(backend);
      return addDir(
        registry.storePaths(storeBackend(backend)).dirs,
        await canonicalDirectory(directory),
      );
    },
  );

  ipcMain.handle(
    "awefork:dirsRemove",
    async (_event: IpcMainInvokeEvent, backend: BackendId, directory: string) => {
      await loadCanonicalDirs(backend);
      return removeDir(
        registry.storePaths(storeBackend(backend)).dirs,
        await canonicalDirectory(directory),
      );
    },
  );

  // The unsent draft's crash-recovery sidecar, one file per backend — the
  // draft anchors to a session, and sessions belong to their backend. Written
  // by the renderer's debounced flush, read back after every backend boot.
  ipcMain.handle("awefork:composer", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    readComposer(registry.storePaths(storeBackend(backend)).composer),
  );

  ipcMain.handle(
    "awefork:saveComposer",
    (_event: IpcMainInvokeEvent, backend: BackendId, value: PersistedComposer | null) =>
      writeComposer(registry.storePaths(storeBackend(backend)).composer, value),
  );

  // ── per-turn file changes (observer sidecar) ─────────────────────────────

  // The whole session index in one read; the pane maps entries onto turns.
  ipcMain.handle(
    "awefork:fileChanges",
    async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) =>
      readSessionChanges(
        sessionChangesDir(registry.fileChangesDir(storeBackend(backend)), sessionId),
      ),
  );

  /**
   * The saved diff of one entry, recomputed from its two snapshots — the same
   * lineDiff that produced the persisted totals, so the expanded view can
   * never disagree with the collapsed row. Entries without a snapshot pair
   * (binary/oversized/unknown) resolve to null.
   */
  ipcMain.handle(
    "awefork:fileChangeDiff",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      messageId: string,
      path: string,
    ) => {
      const sessionDir = sessionChangesDir(
        registry.fileChangesDir(storeBackend(backend)),
        sessionId,
      );
      const changes = await readSessionChanges(sessionDir);
      if (!changes) return null;
      const entry: FileChangeEntry | null = findEntry(changes, messageId, path);
      if (!entry || entry.before === null || entry.after === null) return null;
      const [before, after] = await Promise.all([
        readSnapshotBlob(sessionDir, messageId, entry.before),
        readSnapshotBlob(sessionDir, messageId, entry.after),
      ]);
      if (before === null || after === null) return null;
      return lineDiff(before, after);
    },
  );

  // ── backend switcher ────────────────────────────────────────────────────

  ipcMain.handle("awefork:backends", () => registry.listBackends());

  ipcMain.handle(
    "awefork:selectBackend",
    async (_event: IpcMainInvokeEvent, backend: BackendId) => {
      if (!isBackendId(backend)) return { ok: false, error: `未知后端：${String(backend)}` };
      return registry.select(backend);
    },
  );

  ipcMain.handle("awefork:capabilities", (_event: IpcMainInvokeEvent, backend: BackendId) =>
    registry.capabilities(storeBackend(backend)),
  );

  // ── app-level ────────────────────────────────────────────────────────────

  // Local file references in replies (agent output is full of them — Windows
  // drive paths and absolute POSIX paths alike) open with the OS handler.
  // Only absolute local paths pass the gate — the same regexes the
  // renderer's parser used, so nothing reaches the OS that the markdown
  // view wouldn't have linked itself.
  ipcMain.handle("awefork:openPath", async (_event: IpcMainInvokeEvent, target: string) => {
    if (!isLocalPath(target)) return { ok: false, error: "不是本地路径" };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });

  // Native folder picker behind ＋ 新目录 — anchored to the requesting window
  // so the dialog stays with the app. Null on cancel, first pick otherwise.
  ipcMain.handle("awefork:pickDirectory", async (event: IpcMainInvokeEvent) => {
    const options: Electron.OpenDialogOptions = {
      title: "选择要添加的项目目录",
      properties: ["openDirectory", "createDirectory"],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Word/RTF attachments are converted here in the main process; the renderer
  // stages the result as a text/plain attachment.
  ipcMain.handle(
    "awefork:convertDocument",
    (_event: IpcMainInvokeEvent, filename: string, bytes: Uint8Array) =>
      convertDocumentToText(filename, bytes),
  );

  // Markdown links in replies route through here — shell.openExternal is the
  // only sanctioned way out of the app window, and the scheme gate keeps
  // file:/javascript:-style hrefs from ever reaching it.
  ipcMain.handle("awefork:openExternal", (_event: IpcMainInvokeEvent, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "mailto:"
    ) {
      return;
    }
    void shell.openExternal(parsed.href);
  });

  // Release checks are main-process-side: the renderer never talks to the
  // GitHub API and only receives a raw version number back.
  ipcMain.handle("awefork:check-updates", (_event: IpcMainInvokeEvent, respectSkip: boolean) =>
    checkForUpdates(Boolean(respectSkip)),
  );

  ipcMain.handle("awefork:skip-update", (_event: IpcMainInvokeEvent, version: string) =>
    skipUpdate(version),
  );

  // The URL is assembled here, not by the renderer — an arbitrary link never
  // reaches shell.openExternal this way.
  ipcMain.handle("awefork:open-release", (_event: IpcMainInvokeEvent, version: string) =>
    openRelease(version),
  );

  // In-place install: the renderer supplies only a version string; progress
  // streams back on awefork:update-progress until the download finishes (and,
  // on macOS, the process is replaced by the relaunch).
  ipcMain.handle("awefork:download-update", (event: IpcMainInvokeEvent, version: string) => {
    const sender = event.sender;
    return downloadAndInstallUpdate(String(version ?? ""), (progress) => {
      if (!sender.isDestroyed()) sender.send("awefork:update-progress", progress);
    });
  });
}
