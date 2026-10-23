/**
 * File-browser UI state: the directory being browsed, its navigation
 * history, selection, name filter, quick search and the current preview.
 * Deliberately separate from state.ts — the agent workspace (sessions,
 * drafts, backends) knows nothing about browsing, and browsing never
 * changes the agent's project directory.
 *
 * Everything fallible comes back as an FsResult from the main process and
 * is stored as { code } here, so the components phrase failures per locale
 * instead of catching throws.
 */
import { reactive } from "vue";
import {
  displayName,
  isAbsolutePath,
  isHiddenName,
  parentOf,
  samePath,
} from "../../shared/file-paths";
import type {
  DirListing,
  FileEntry,
  FileError,
  FsResult,
  ImagePreview,
  TextPreview,
} from "../../shared/file-types";
import { t } from "./i18n";
import { settings } from "./settings";

export type FileView = "list" | "grid";

export type PreviewStatus = "loading" | "text" | "image" | "error";

export interface PreviewState {
  path: string;
  status: PreviewStatus;
  text?: string;
  truncated?: boolean;
  dataUrl?: string;
  bytes?: number;
  error?: FileError;
}

export const files = reactive({
  /** Directory currently listed; null before the first browse. */
  browsing: null as string | null,
  /** Back stack of visited directories. */
  history: [] as string[],
  /** Forward stack, cleared by every new navigation. */
  forward: [] as string[],
  entries: [] as FileEntry[],
  loading: false,
  error: null as FileError | null,
  /** The listing stopped at the entry cap (giant folder). */
  capped: false,
  /** Selected entry path — the preview and the context menu both act on it. */
  selectedPath: null as string | null,
  /** Seeded from the settings page's default view; the toolbar overrides it. */
  view: settings.files.view as FileView,
  /** Name filter for the current directory only — never a project search. */
  filter: "",
  showHidden: settings.files.showHidden,
  quickQuery: "",
  quickResults: [] as FileEntry[],
  quickLoading: false,
  quickError: null as FileError | null,
  quickIncludeHidden: false,
  preview: null as PreviewState | null,
  homePath: null as string | null,
  /** Sidebar tree: children per expanded directory, plus per-node status. */
  treeChildren: {} as Record<string, FileEntry[]>,
  treeLoading: {} as Record<string, boolean>,
  treeError: {} as Record<string, FileError | null>,
  treeExpanded: {} as Record<string, boolean>,
  /** Short-lived feedback (copy ok/failed, insert hints); auto-clears. */
  notice: null as string | null,
});

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every preview request; stale responses are dropped. */
let previewSeq = 0;
/** Bumped on every quick search; stale responses are dropped. */
let quickSeq = 0;
/** Bumped on every listing; stale responses are dropped. */
let listSeq = 0;

export function flashNotice(message: string): void {
  files.notice = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    files.notice = null;
  }, 4000);
}

/** Home directory for the common-locations row; safe to call repeatedly. */
export async function initFiles(): Promise<void> {
  if (files.homePath !== null) return;
  try {
    files.homePath = await window.awefork.homePath();
  } catch {
    files.homePath = null;
  }
}

/**
 * First look at the file view: land on the project root when one is open,
 * else the home directory. A no-op once anything has been browsed — the
 * browsing position survives view switches.
 */
export async function ensureBrowsing(root: string | null): Promise<void> {
  if (files.browsing !== null) return;
  await initFiles();
  await browseTo(root ?? files.homePath ?? "/");
}

async function load(dir: string): Promise<void> {
  const seq = ++listSeq;
  files.loading = true;
  files.error = null;
  let result: FsResult<DirListing>;
  try {
    result = await window.awefork.listDir(dir);
  } catch {
    result = { ok: false, error: { code: "unknown" } };
  }
  // A newer navigation (or a refresh of another directory) already won.
  if (seq !== listSeq) return;
  files.loading = false;
  // The attempted directory is recorded either way: a failed listing still
  // shows where the user tried to go, so the error has a breadcrumb and a
  // path to correct, and "up" leads somewhere sensible.
  files.browsing = dir;
  if (!result.ok) {
    files.entries = [];
    files.error = result.error;
    files.capped = false;
    return;
  }
  files.browsing = result.value.path;
  files.entries = result.value.entries;
  files.capped = result.value.capped;
  // A selection that no longer exists in the listed directory is dropped,
  // so the preview never describes a row the user cannot see.
  if (files.selectedPath && !result.value.entries.some((e) => e.path === files.selectedPath)) {
    files.selectedPath = null;
    files.preview = null;
  }
}

/** Navigate to a directory, recording history unless this is a redraw. */
export async function browseTo(dir: string): Promise<void> {
  if (files.browsing !== null && samePath(dir, files.browsing)) {
    await load(files.browsing);
    return;
  }
  if (files.browsing !== null) {
    files.history.push(files.browsing);
    // A fresh navigation invalidates the forward stack, like any browser.
    files.forward = [];
  }
  await load(dir);
}

export async function goBack(): Promise<void> {
  const previous = files.history.pop();
  if (previous === undefined) return;
  if (files.browsing !== null) files.forward.push(files.browsing);
  await load(previous);
}

export async function goForward(): Promise<void> {
  const next = files.forward.pop();
  if (next === undefined) return;
  if (files.browsing !== null) files.history.push(files.browsing);
  await load(next);
}

export async function goUp(): Promise<void> {
  if (files.browsing === null) return;
  const parent = parentOf(files.browsing);
  if (parent === null) return;
  await browseTo(parent);
}

/** A minimal entry for a path the user typed (no listing row behind it). */
export function entryFromPath(target: string): FileEntry {
  return {
    name: displayName(target),
    path: target,
    isDir: false,
    isSymlink: false,
    size: null,
    mtime: null,
    hidden: isHiddenName(displayName(target)),
  };
}

/**
 * Jump to a typed path: "~" expands against the home directory, a directory
 * opens it, and a file locates its directory and previews it. A stat first
 * keeps a failed file jump out of the navigation history.
 */
export async function goToPath(input: string): Promise<void> {
  let target = input.trim();
  if (target === "") return;
  if (target === "~") target = files.homePath ?? target;
  else if (target.startsWith("~/")) target = `${files.homePath ?? ""}${target.slice(1)}`;
  // A relative string is not a path we can serve — say so instead of
  // silently rooting it at "/".
  if (!isAbsolutePath(target)) {
    flashNotice(t("files.pathNotAbsolute"));
    return;
  }
  const stat = await window.awefork.statFile(target).catch(() => null);
  if (stat?.ok && stat.value.exists && !stat.value.isDir) {
    const parent = parentOf(target);
    if (parent !== null) await browseTo(parent);
    await previewEntry(entryFromPath(target));
    return;
  }
  await browseTo(target);
}

export async function refresh(): Promise<void> {
  if (files.browsing === null) return;
  await load(files.browsing);
}

export function selectEntry(entry: FileEntry): void {
  files.selectedPath = entry.path;
}

export function setFilter(value: string): void {
  files.filter = value;
}

export function setView(view: FileView): void {
  files.view = view;
  // The toolbar choice doubles as the default for the next boot, so the
  // settings row and the toggle never disagree.
  settings.files.view = view;
}

export function toggleHidden(): void {
  files.showHidden = !files.showHidden;
  settings.files.showHidden = files.showHidden;
}

/** Directories shown by the current filter and hidden-files setting. */
export function visibleEntries(): FileEntry[] {
  const needle = files.filter.trim().toLowerCase();
  return files.entries.filter((entry) => {
    if (entry.hidden && !files.showHidden) return false;
    return needle === "" || entry.name.toLowerCase().includes(needle);
  });
}

/**
 * Open an entry: a directory is entered (symlinks included — readdir
 * follows them, and the displayed path stays the one that was clicked),
 * a file is previewed without being executed.
 */
export async function openEntry(entry: FileEntry): Promise<void> {
  if (entry.isDir || entry.isSymlink) {
    await browseTo(entry.path);
    // A symlink pointing at a file answers "not a directory"; preview it
    // instead of leaving the user on an error.
    if (files.error?.code === "not-a-directory") {
      files.error = null;
      await previewEntry(entry);
    }
    return;
  }
  // "System app" hands the file to the OS instead of the in-app preview; a
  // failure (no handler for the type) falls back to the preview so the click
  // still does something visible.
  if (settings.files.openOnDouble === "system") {
    const result = await window.awefork.openPath(entry.path).catch(() => null);
    if (result?.ok) {
      files.selectedPath = entry.path;
      return;
    }
  }
  await previewEntry(entry);
}

/** Preview a file; responses that lost the race are dropped. */
export async function previewEntry(entry: FileEntry): Promise<void> {
  const seq = ++previewSeq;
  files.selectedPath = entry.path;
  files.preview = { path: entry.path, status: "loading" };
  const image = await window.awefork
    .readImagePreview(entry.path, settings.files.imageCapMb * 1024 * 1024)
    .catch(() => null);
  if (seq !== previewSeq) return;
  if (image?.ok) {
    const value: ImagePreview = image.value;
    files.preview = {
      path: entry.path,
      status: "image",
      dataUrl: value.dataUrl,
      bytes: value.bytes,
    };
    return;
  }
  const text = await window.awefork
    .readTextPreview(entry.path, settings.files.previewCapKb * 1024)
    .catch(() => null);
  if (seq !== previewSeq) return;
  if (text?.ok) {
    const value: TextPreview = text.value;
    files.preview = {
      path: entry.path,
      status: "text",
      text: value.text,
      truncated: value.truncated,
      bytes: value.bytes,
    };
    return;
  }
  // Not an image and not decodable text: binary (or unreadable) — the UI
  // says so and offers the OS open instead of showing an empty file.
  files.preview = {
    path: entry.path,
    status: "error",
    error: text && !text.ok ? text.error : { code: "binary" },
  };
}

export function clearPreview(): void {
  previewSeq += 1;
  files.preview = null;
  files.selectedPath = null;
}

/**
 * Locate an entry from elsewhere (quick open, "reveal"): enter its parent
 * directory, select it, and preview it when it is a file.
 */
export async function revealEntry(entry: FileEntry): Promise<void> {
  const parent = parentOf(entry.path);
  if (parent !== null && !samePath(parent, files.browsing ?? "")) {
    await browseTo(parent);
  } else if (files.browsing === null && parent !== null) {
    await browseTo(parent);
  }
  files.selectedPath = entry.path;
  if (!entry.isDir) await previewEntry(entry);
}

/** Quick search inside one project root (never the browsing directory). */
export async function quickSearch(root: string, query: string): Promise<void> {
  const seq = ++quickSeq;
  files.quickQuery = query;
  const needle = query.trim();
  if (needle === "" || root === "") {
    files.quickResults = [];
    files.quickLoading = false;
    files.quickError = null;
    return;
  }
  files.quickLoading = true;
  files.quickError = null;
  const result = await window.awefork
    .searchFiles(root, needle, { includeHidden: files.quickIncludeHidden })
    .catch(() => null);
  if (seq !== quickSeq) return;
  files.quickLoading = false;
  if (!result?.ok) {
    files.quickResults = [];
    files.quickError = result && !result.ok ? result.error : { code: "unknown" };
    return;
  }
  files.quickResults = result.value;
}

export function setQuickIncludeHidden(value: boolean): void {
  files.quickIncludeHidden = value;
}

export function clearQuickSearch(): void {
  quickSeq += 1;
  files.quickQuery = "";
  files.quickResults = [];
  files.quickLoading = false;
  files.quickError = null;
}

// ── sidebar tree ───────────────────────────────────────────────────────

export async function loadTreeChildren(dir: string): Promise<void> {
  files.treeLoading[dir] = true;
  files.treeError[dir] = null;
  const result = await window.awefork.listDir(dir).catch(() => null);
  files.treeLoading[dir] = false;
  if (!result?.ok) {
    files.treeChildren[dir] = [];
    files.treeError[dir] = result && !result.ok ? result.error : { code: "unknown" };
    return;
  }
  // Dot-prefixed entries left out — a project tree is for navigating source,
  // not for wading through .git and .cache. Files are kept alongside
  // directories: the tree renderers filter to dirs themselves, and the
  // session file dock shows everything.
  files.treeChildren[dir] = result.value.entries.filter((entry) => !entry.hidden);
}

/** Expand a node, loading its children on first open (never recursively). */
export async function toggleTreeNode(dir: string): Promise<void> {
  if (files.treeExpanded[dir]) {
    files.treeExpanded[dir] = false;
    return;
  }
  files.treeExpanded[dir] = true;
  if (files.treeChildren[dir] === undefined) await loadTreeChildren(dir);
}

export function isTreeNodeExpanded(dir: string): boolean {
  return files.treeExpanded[dir] === true;
}

// ── internal path drags ────────────────────────────────────────────────

/**
 * Custom drag type for paths dragged out of the file panel. A drop that
 * carries it is internal (the paths are already real); a drop without it
 * came from outside the app and is resolved per-File instead.
 */
export const PATH_DRAG_TYPE = "application/x-awefork-path";

export function startPathDrag(event: DragEvent, paths: readonly string[]): void {
  const dt = event.dataTransfer;
  if (!dt || paths.length === 0) return;
  dt.setData(PATH_DRAG_TYPE, JSON.stringify(paths));
  // text/plain too: a drop onto any plain text target still yields paths.
  dt.setData("text/plain", paths.join("\n"));
  dt.effectAllowed = "copy";
}

/** True while a path drag (internal or from Finder) is over a target. */
export function isPathDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return types.includes(PATH_DRAG_TYPE) || types.includes("Files");
}

export interface PathDrop {
  paths: string[];
  /** true when the payload came from outside the app (Finder). */
  external: boolean;
}

/**
 * Read a drop's paths: the internal payload when present, otherwise the
 * real paths of the dropped Files (null entries are dropped, never
 * invented). Returns null when the drop carries nothing we can name.
 */
export function readPathDrop(event: DragEvent): PathDrop | null {
  const dt = event.dataTransfer;
  if (!dt) return null;
  if (dt.types.includes(PATH_DRAG_TYPE)) {
    const raw = dt.getData(PATH_DRAG_TYPE);
    if (raw !== "") {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const paths = parsed.filter((p): p is string => typeof p === "string" && p !== "");
          if (paths.length > 0) return { paths, external: false };
        }
      } catch {
        // Malformed payload: fall through to the Files branch.
      }
    }
  }
  if (dt.files && dt.files.length > 0) {
    const paths: string[] = [];
    for (const file of Array.from(dt.files)) {
      const resolved = window.awefork.pathForFile(file);
      if (typeof resolved === "string" && resolved !== "") paths.push(resolved);
    }
    // Files that carry no nameable path are reported by the caller, which
    // knows how many arrived — an empty list with files present means the
    // OS refused to name them.
    return { paths, external: true };
  }
  return null;
}
