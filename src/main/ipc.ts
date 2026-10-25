import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import { canonicalizeStoredArchive, setArchived } from "../shared/archive-store.js";
import { type BackendId, isBackendId } from "../shared/backend.js";
import {
  canonicalDirectory,
  canonicalizeArchiveDirectories,
  canonicalizeDirectoryList,
} from "../shared/canonical-paths.js";
import { readComposer, writeComposer } from "../shared/composer-store.js";
import { lineDiff } from "../shared/diff.js";
import { canonicalizeStoredDirs } from "../shared/dirs-store.js";
import {
  clearSessionChanges,
  type FileChangeEntry,
  findEntry,
  readSessionChanges,
  readSnapshotBlob,
  sessionChangesDir,
} from "../shared/file-changes.js";
import type {
  DirListing,
  FileEntry,
  FileError,
  FileStat,
  FsResult,
  ImagePreview,
  SearchOptions,
  TextPreview,
} from "../shared/file-types.js";
import { lineageForDisplay, readLineage } from "../shared/lineage-store.js";
import { isLocalPath } from "../shared/local-path.js";
import { pruneSessionMarks, pruneTurnMark, readMarks, toggleMark } from "../shared/marks-store.js";
import type { OverviewLedgerStore } from "../shared/overview-ledger.js";
import {
  normalizeOverviewLedger,
  type OverviewReadEntry,
  type OverviewReadLedger,
  overviewKey,
} from "../shared/overview-ledger-types.js";
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
import { installBackend } from "./agent-installer.js";
import type { BackendRegistry } from "./backend-registry.js";
import {
  codexHomeForSession,
  codexRolloutProviderFallback,
  terminalDefaultCodexHome,
} from "./codex-homes.js";
import { convertDocumentToText } from "./document-convert.js";
import {
  listDirectory,
  readFileAsDataUrl,
  readImagePreview,
  readTextPreview,
  relativeToRoot,
  searchFiles,
  statPath,
} from "./file-browser.js";
import { createMessageSearcher, type MessageSearcher } from "./message-search.js";
import { findPiSessionFile } from "./pi-server.js";
import { openSessionInTerminal } from "./session-terminal.js";
import { readOnboardingDone, writeOnboardingDone } from "./settings-store.js";
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
 *   compressSession(backend, id, model) -> void     fold history into a
 *                           summary (capability-gated, fire-and-forget)
 *   respondInteraction(backend, requestId, response) -> void  reply to a pending
 *                                                approval/interaction request
 *   renameSession(backend, id, title) -> void
 *   openSessionTerminal(backend, id) -> {ok, error?}  TUI in a system terminal
 * Overlay-store channels (per-backend files, no adapter spawn):
 *   pins / togglePin / marks / toggleMark / tags / setSessionTags / setTagColor /
 *   deleteTag / addTagsToSessions / setForkTagPref / trash / trashAdd / trashRemove /
 *   archive / archiveAdd / archiveRemove / dirs /
 *   composer / saveComposer — same
 *   shapes as before, backend-routed (composer holds the unsent draft + pane
 *   model picks; tags returns { sessions, colors, forkPref? }; dirs is the
 *   legacy hand-added sidebar directories, read once for the resident-folder
 *   adoption and written by nothing).
 * Backend switcher:
 *   backends      -> { selected, backends: BackendInfo[] } (probe, no spawn)
 *   selectBackend -> { ok, error? }                persists; probe failure bounces back
 *   capabilities  -> { deleteMessage, attachments }
 * Agent install + first-run guide:
 *   installBackend -> { ok, error? }   npm -g latest; drops the cached probe
 *   onboardingDone -> boolean          first-run guide already ran (persisted)
 *   finishOnboarding -> void           mark the guide as run, never show again
 * App-level (backend-free): openExternal, openPath, pickDirectory,
 * convertDocument, checkUpdates, skipUpdate, openRelease, downloadUpdate.
 * File browser (also backend-free, read-only): listDir, statFile,
 * readTextPreview, readImagePreview, relativeToRoot, searchFiles, homePath,
 * showInFolder — each answering an FsResult (or a plain value) built by
 * file-browser.ts.
 * Update download progress arrives on channel "awefork:update-progress" as
 * {downloaded,total}. Events are forwarded on channel "awefork:event" as
 * {backend, event, eventId, runId?}.
 * Canvas session overview (main-owned unread ledger, when one is passed in):
 *   overviewLedger        -> overview snapshot         for a new window
 *   overviewObserveSessions(backend, sessions, scannedAt) -> saved scan time
 *   overviewRecordSettle(backend, session, failed, settleId?, runId?) -> entry
 *   overviewMarkSeen(backend, session, upTo?)      -> entry | null (broadcast)
 *   overviewForget(backend, session)               -> boolean (hard delete)
 *   overviewMergeLedger(ledger)                    -> merged ledger (window sync)
 * Sequence-stamped entry and unknown-state updates arrive on
 * "awefork:overview-read".
 */
export function registerIpc(
  registry: BackendRegistry,
  openAgentWindow?: (backend: BackendId) => Promise<{ ok: boolean; error?: string }>,
  overviewLedger?: OverviewLedgerStore,
  userDataDir = app.getPath("userData"),
): void {
  const withAdapter = async (backend: BackendId) => registry.get(backend);
  // Store channels take the backend from the invoke; unknown ids route to the
  // default rather than throwing so a stale renderer can't wedge the store.
  const storeBackend = (value: unknown): BackendId => (isBackendId(value) ? value : "opencode");

  // ── canvas session overview unread ledger (main-owned) ──────────────────
  // The overview's unread record is one file in userData, written only here.
  // Every window reads the same snapshot on boot and receives the applied entry
  // on "awefork:overview-read" after any mutation, so a seen watermark or a new
  // revision is visible everywhere without a second source of truth.
  if (overviewLedger) {
    let overviewSequence = 0;
    const broadcast = (
      key: string,
      entry?: OverviewReadEntry | null,
      unknown?: string | null,
    ): void => {
      const update = {
        sequence: ++overviewSequence,
        key,
        ...(entry !== undefined ? { entry } : {}),
        ...(unknown !== undefined ? { unknown } : {}),
      };
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("awefork:overview-read", update);
      }
    };
    ipcMain.handle("awefork:overviewLedger", async () => {
      // Capture before awaiting the disk-backed load. Any update during that
      // await has a larger sequence and will be replayed after the snapshot.
      const sequence = overviewSequence;
      const snapshot = await overviewLedger.snapshot();
      return { ...snapshot, sequence };
    });
    ipcMain.handle(
      "awefork:overviewObserveSessions",
      async (
        _event: IpcMainInvokeEvent,
        backend: BackendId,
        value: unknown,
        scannedAt: unknown,
      ) => {
        const id = storeBackend(backend);
        const sessions = (Array.isArray(value) ? value : []).slice(0, 10_000);
        return overviewLedger.observeUpdatedAt(
          id,
          sessions.flatMap((session) =>
            typeof session?.id === "string" &&
            session.id.length > 0 &&
            Number.isFinite(session.updatedAt)
              ? [{ key: overviewKey(id, session.id), updatedAt: Number(session.updatedAt) }]
              : [],
          ),
          Number.isFinite(scannedAt) ? Number(scannedAt) : Date.now(),
        );
      },
    );
    ipcMain.handle(
      "awefork:overviewRecordSettle",
      async (
        _event: IpcMainInvokeEvent,
        backend: BackendId,
        sessionId: string,
        failed: boolean,
        settleId?: string,
        runId?: string,
      ) => {
        const key = overviewKey(storeBackend(backend), String(sessionId ?? ""));
        const result = await overviewLedger.recordSettle(key, {
          settledAt: Date.now(),
          failed: Boolean(failed),
          settleId: typeof settleId === "string" ? settleId.slice(0, 256) : undefined,
          runId: typeof runId === "string" ? runId.slice(0, 256) : undefined,
        });
        if (result.changed) {
          broadcast(key, result.entry, result.unknownCleared ? null : undefined);
        }
        return result.entry;
      },
    );
    ipcMain.handle(
      "awefork:overviewSetUnknown",
      async (
        _event: IpcMainInvokeEvent,
        backend: BackendId,
        sessionId: string,
        unknown: boolean,
        runId?: string,
      ) => {
        const key = overviewKey(storeBackend(backend), String(sessionId ?? ""));
        const result = await overviewLedger.setUnknown(key, Boolean(unknown), runId);
        if (result.changed) {
          broadcast(key, undefined, result.unknown ? (result.runId ?? "") : null);
        }
        return result.unknown;
      },
    );
    ipcMain.handle(
      "awefork:overviewMarkSeen",
      async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string, upTo?: number) => {
        const key = overviewKey(storeBackend(backend), String(sessionId ?? ""));
        const entry = await overviewLedger.markSeen(
          key,
          Number.isFinite(upTo) ? Number(upTo) : undefined,
        );
        // Only an entry that actually moved broadcasts: a redundant mark (the
        // watermark already at or past it) must not wake every window.
        if (entry && entry.seen > 0) broadcast(key, entry);
        return entry;
      },
    );
    ipcMain.handle(
      "awefork:overviewForget",
      async (_event: IpcMainInvokeEvent, backend: BackendId, sessionId: string) => {
        const key = overviewKey(storeBackend(backend), String(sessionId ?? ""));
        const forgotten = await overviewLedger.forget(key);
        if (forgotten) broadcast(key, null, null);
        return forgotten;
      },
    );
    ipcMain.handle(
      "awefork:overviewMergeLedger",
      async (_event: IpcMainInvokeEvent, value: unknown) => {
        const incoming = normalizeOverviewLedger(value);
        const before = await overviewLedger.snapshot();
        const merged = await overviewLedger.merge(incoming);
        const after = await overviewLedger.snapshot();
        for (const key of Object.keys(incoming)) {
          const entry = merged[key];
          if (entry) {
            const unknownCleared =
              before.unknown[key] !== undefined && after.unknown[key] === undefined;
            broadcast(key, entry, unknownCleared ? null : undefined);
          }
        }
        return merged;
      },
    );
  }

  ipcMain.handle("awefork:setTheme", (_event: IpcMainInvokeEvent, value: unknown) => {
    // Mirror the renderer's palette choice into native window chrome.
    nativeTheme.themeSource = value === "dark" ? "dark" : "light";
  });

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
    // Detached exports carry a record only to override a server-side fork
    // link; the renderer must never see it, or the copy would read as a branch.
    const lineage = lineageForDisplay(await readLineage(registry.storePaths(id).lineage));
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
      if (!(await registry.capabilities(id)).exportBranch) {
        throw new Error("this backend cannot export a detached session");
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

  // Session compaction through the backend's own summarize primitive.
  // Capability-gated like exportSession; fire-and-forget like prompt — the
  // adapter returns once the request is out, the summary streams in on the
  // event feed, and session.compressed announces completion.
  ipcMain.handle(
    "awefork:compressSession",
    async (
      _event: IpcMainInvokeEvent,
      backend: BackendId,
      sessionId: string,
      model: ModelChoice,
    ) => {
      const id = storeBackend(backend);
      const adapter = await withAdapter(id);
      if (!(await registry.capabilities(id)).compress) {
        throw new Error("this backend cannot compress sessions");
      }
      await adapter.compress(sessionId, model);
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
      if (!session)
        return { ok: false, error: `session ${sessionId} not found — it may have been deleted` };
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

  // Directories registered by hand before the resident folder existed: the
  // sidecar is read once so an upgrade can adopt the first entry, and served
  // canonicalized so a legacy spelling matches the session rows' directories.
  // Nothing writes it anymore — the resident folder lives in the settings blob.
  ipcMain.handle("awefork:dirs", async (_event: IpcMainInvokeEvent, backend: BackendId) =>
    loadCanonicalDirs(backend),
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
      if (!isBackendId(backend)) return { ok: false, error: `unknown backend: ${String(backend)}` };
      return registry.select(backend);
    },
  );

  // Focus-or-open the agent's dedicated window. No installed probe here:
  // the renderer only offers the entry on rows it already probed, and a
  // missing CLI surfaces inside the new window like any boot failure.
  ipcMain.handle(
    "awefork:openAgentWindow",
    async (_event: IpcMainInvokeEvent, backend: BackendId) => {
      if (!isBackendId(backend)) return { ok: false, error: `Unknown backend: ${String(backend)}` };
      if (!openAgentWindow) return { ok: false, error: "Multi-window is not enabled" };
      return openAgentWindow(backend);
    },
  );

  ipcMain.handle("awefork:capabilities", (_event: IpcMainInvokeEvent, backend: BackendId) =>
    registry.capabilities(storeBackend(backend)),
  );

  // ── agent install + first-run guide ────────────────────────────────────

  // One-click CLI install (npm -g, latest). The cached opencode probe would
  // keep answering "not installed" after a successful install, so drop it on
  // success and let the renderer's refresh re-read the truth.
  ipcMain.handle("awefork:installBackend", async (_event: IpcMainInvokeEvent, backend: unknown) => {
    if (!isBackendId(backend)) return { ok: false, error: `unknown backend: ${String(backend)}` };
    const result = await installBackend(backend);
    if (result.ok) registry.reprobe();
    return result;
  });

  const onboardingPath = join(userDataDir, "settings.json");
  ipcMain.handle("awefork:onboardingDone", () => readOnboardingDone(onboardingPath));
  ipcMain.handle("awefork:finishOnboarding", () => writeOnboardingDone(onboardingPath));

  // Quit behavior: whether quitting leaves the spawned backends running so
  // in-flight turns finish in the background. Read is served from the
  // registry's cache (persisted-backed); write persists it.
  ipcMain.handle("awefork:quitKeepAlive", () => registry.quitKeepAlive());
  ipcMain.handle("awefork:setQuitKeepAlive", (_event: IpcMainInvokeEvent, value: unknown) => {
    if (typeof value !== "boolean") return { ok: false, error: "expected a boolean" };
    registry.setQuitKeepAlive(value);
    return { ok: true };
  });
  // Runs in flight across every backend — the top bar counts them before
  // offering to turn keep-alive on, so the user knows what will survive.
  ipcMain.handle("awefork:runningSessionCount", () => registry.runningSessions().length);

  // ── app-level ────────────────────────────────────────────────────────────

  // Local file references in replies (agent output is full of them — Windows
  // drive paths and absolute POSIX paths alike) open with the OS handler.
  // Only absolute local paths pass the gate — the same regexes the
  // renderer's parser used, so nothing reaches the OS that the markdown
  // view wouldn't have linked itself.
  ipcMain.handle("awefork:openPath", async (_event: IpcMainInvokeEvent, target: string) => {
    if (!isLocalPath(target)) return { ok: false, error: "not a local path" };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });

  // Native folder picker behind the ＋ resident-folder entry and the file
  // browser's jump — anchored to the requesting window so the dialog stays
  // with the app. Null on cancel, first pick otherwise. The answer comes back
  // canonicalized: every other path the app groups by (session directories,
  // archive keys) is canonical too, so a /var vs /private/var spelling cannot
  // split one folder into two rows.
  ipcMain.handle("awefork:pickDirectory", async (event: IpcMainInvokeEvent) => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose a folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    const picked = result.filePaths[0] ?? null;
    return picked === null ? null : await canonicalDirectory(picked);
  });

  // ── file browser (backend-free, read-only) ────────────────────────────
  // Directory listings, metadata, bounded previews, the project-relative
  // path and the quick search all live in file-browser.ts: absolute paths
  // only, nothing executed, nothing written. Every handler answers with an
  // FsResult so the renderer can phrase failures instead of catching throws.

  ipcMain.handle("awefork:listDir", (_event: IpcMainInvokeEvent, target: string) =>
    listDirectory(target),
  );

  ipcMain.handle("awefork:statFile", (_event: IpcMainInvokeEvent, target: string) =>
    statPath(target),
  );

  ipcMain.handle(
    "awefork:readTextPreview",
    (_event: IpcMainInvokeEvent, target: string, maxBytes?: number) =>
      readTextPreview(target, maxBytes),
  );

  ipcMain.handle(
    "awefork:readImagePreview",
    (_event: IpcMainInvokeEvent, target: string, maxBytes?: number) =>
      readImagePreview(target, maxBytes),
  );

  // Whole-file bytes for the renderer's PDF rasterizer. The mime comes from
  // the caller because only the renderer knows which parser will read it.
  ipcMain.handle(
    "awefork:readFileAsDataUrl",
    (_event: IpcMainInvokeEvent, target: string, mime: string, maxBytes?: number) =>
      readFileAsDataUrl(target, mime, maxBytes),
  );

  ipcMain.handle(
    "awefork:relativeToRoot",
    (_event: IpcMainInvokeEvent, root: string, target: string) => relativeToRoot(root, target),
  );

  ipcMain.handle(
    "awefork:searchFiles",
    (_event: IpcMainInvokeEvent, root: string, query: string, options?: SearchOptions) =>
      searchFiles(root, query, options),
  );

  // The home directory anchors the file panel's common locations; the
  // renderer has no other way to name it.
  ipcMain.handle("awefork:homePath", () => app.getPath("home"));

  // The settings page's Storage section opens the app data folder; "~" fails
  // the openPath gate and names the wrong folder anyway.
  ipcMain.handle("awefork:openAppData", async () => {
    const error = await shell.openPath(app.getPath("userData"));
    return error ? { ok: false, error } : { ok: true };
  });

  // Reveal an entry in the OS file manager — the one file action that
  // leaves the app, and the only one routed through shell besides openPath.
  ipcMain.handle("awefork:showInFolder", (_event: IpcMainInvokeEvent, target: string) => {
    if (!isLocalPath(target)) return { ok: false, error: "not a local path" };
    shell.showItemInFolder(target);
    return { ok: true };
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
