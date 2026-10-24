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
import { computed, reactive, watch } from "vue";
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

/** One browsing position: where it is, how it got there, and what it shows. */
export interface FileTab {
  id: string;
  /** Directory currently listed; null before the first browse. */
  browsing: string | null;
  /** Back stack of visited directories. */
  history: string[];
  /** Forward stack, cleared by every new navigation. */
  forward: string[];
  entries: FileEntry[];
  loading: boolean;
  error: FileError | null;
  /** The listing stopped at the entry cap (giant folder). */
  capped: boolean;
  /** Selected entry path — the preview and the context menu both act on it. */
  selectedPath: string | null;
  /** Name filter for the current directory only — never a project search. */
  filter: string;
  quickQuery: string;
  quickResults: FileEntry[];
  quickLoading: boolean;
  quickError: FileError | null;
  preview: PreviewState | null;
  /** Preview pane width in px; the split drag writes it. */
  previewWidth: number;
  /** Listing scroll offset, restored when the tab comes back. */
  scrollTop: number;
  /** Per-tab request sequence numbers, so a tab's own responses stay its own. */
  previewSeq: number;
  listSeq: number;
  quickSeq: number;
}

/**
 * The browsing state lives on tabs, not on the store. Every field the
 * browser renders is read from the active tab, so two tabs on two
 * directories never share a selection, a filter or a preview. The
 * app-wide preferences (view, hidden files, quick-search hidden toggle,
 * the sidebar tree and the notice) are deliberately NOT per tab: they are
 * one user's settings for the whole browser.
 */
export const files = reactive({
  tabs: [] as FileTab[],
  activeTabId: null as string | null,
  /** Seeded from the settings page's default view; the toolbar overrides it. */
  view: settings.files.view as FileView,
  showHidden: settings.files.showHidden,
  quickIncludeHidden: false,
  homePath: null as string | null,
  /** Sidebar tree: children per expanded directory, plus per-node status. */
  treeChildren: {} as Record<string, FileEntry[]>,
  treeLoading: {} as Record<string, boolean>,
  treeError: {} as Record<string, FileError | null>,
  treeExpanded: {} as Record<string, boolean>,
  /** Short-lived feedback (copy ok/failed, insert hints); auto-clears. */
  notice: null as string | null,
});

/** The tab every browser read and write goes through. */
function activeTab(): FileTab | null {
  if (files.activeTabId === null) return null;
  return files.tabs.find((tab) => tab.id === files.activeTabId) ?? null;
}

/**
 * The active tab's browsing directory and selection, for the surfaces that
 * only need to know where the browser is (the sidebar tree's active row,
 * the dock's selected row). Null until a tab holds a position.
 */
export const browsingDir = computed(() => activeTab()?.browsing ?? null);
export const selectedPath = computed(() => activeTab()?.selectedPath ?? null);

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let tabSeq = 0;

function makeTab(dir: string | null): FileTab {
  tabSeq += 1;
  return {
    id: `ftab-${tabSeq}`,
    browsing: dir,
    history: [],
    forward: [],
    entries: [],
    loading: false,
    error: null,
    capped: false,
    selectedPath: null,
    filter: "",
    quickQuery: "",
    quickResults: [],
    quickLoading: false,
    quickError: null,
    preview: null,
    previewWidth: DEFAULT_PREVIEW_WIDTH,
    scrollTop: 0,
    previewSeq: 0,
    listSeq: 0,
    quickSeq: 0,
  };
}

const DEFAULT_PREVIEW_WIDTH = 340;

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
 * else the home directory. A no-op once a tab already holds a position —
 * browsing survives view switches.
 */
export async function ensureBrowsing(root: string | null): Promise<void> {
  await initFiles();
  if (files.tabs.length === 0) {
    const tab = makeTab(null);
    files.tabs.push(tab);
    files.activeTabId = tab.id;
  }
  const tab = activeTab();
  if (!tab || tab.browsing !== null) return;
  await browseTabTo(tab, root ?? files.homePath ?? "/");
}

// ── tabs ─────────────────────────────────────────────────────────────────

/**
 * Create a tab parked on no directory. The browser's first paint and tests
 * both need a tab that has not navigated anywhere, so nothing pollutes the
 * history before the caller's own first browse.
 */
export function parkFileTab(): string {
  const tab = makeTab(null);
  files.tabs.push(tab);
  files.activeTabId = tab.id;
  return tab.id;
}

/** Open a new tab on `dir` (a copy of the active position when omitted). */
export async function openFileTab(dir?: string): Promise<void> {
  await initFiles();
  const active = activeTab();
  const target = dir ?? active?.browsing ?? files.homePath ?? "/";
  const tab = makeTab(null);
  files.tabs.push(tab);
  files.activeTabId = tab.id;
  await browseTabTo(tab, target);
}

/** Open `dir` in its own tab unless a tab already shows it. */
export async function openFileTabFor(dir: string): Promise<void> {
  const existing = files.tabs.find((tab) => tab.browsing !== null && samePath(tab.browsing, dir));
  if (existing) {
    await activateFileTab(existing.id);
    return;
  }
  await openFileTab(dir);
}

export async function activateFileTab(tabId: string): Promise<void> {
  if (files.activeTabId === tabId) return;
  if (!files.tabs.some((tab) => tab.id === tabId)) return;
  files.activeTabId = tabId;
}

/**
 * Close a tab and activate its neighbour, like the canvas tabs do. The last
 * tab cannot be closed: an empty file view has nothing to show, so closing
 * it lands on the home directory instead.
 */
export async function closeFileTab(tabId: string): Promise<void> {
  const index = files.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  // The closing tab's in-flight reads must not write into a reused slot.
  const closing = files.tabs[index];
  if (!closing) return;
  closing.previewSeq += 1;
  closing.listSeq += 1;
  closing.quickSeq += 1;
  files.tabs.splice(index, 1);
  if (files.tabs.length === 0) {
    await initFiles();
    const tab = makeTab(null);
    files.tabs.push(tab);
    files.activeTabId = tab.id;
    await browseTabTo(tab, files.homePath ?? "/");
    return;
  }
  if (files.activeTabId === tabId) {
    const neighbour = files.tabs[Math.min(index, files.tabs.length - 1)];
    if (neighbour) files.activeTabId = neighbour.id;
  }
}

/** Tab title: the directory name, or its parent's when two share a name. */
export function fileTabLabel(tab: FileTab): string {
  const dir = tab.browsing;
  if (dir === null) return t("files.tabBlank");
  const name = displayName(dir);
  const clashes = files.tabs.some(
    (other) =>
      other.id !== tab.id && other.browsing !== null && displayName(other.browsing) === name,
  );
  if (!clashes) return name;
  const parent = parentOf(dir);
  return parent === null ? name : `${displayName(parent)}/${name}`;
}

export function setPreviewWidth(width: number): void {
  const tab = activeTab();
  if (!tab) return;
  tab.previewWidth = Math.min(640, Math.max(220, width));
}

export function setListingScroll(top: number): void {
  const tab = activeTab();
  if (tab) tab.scrollTop = top;
}

async function load(tab: FileTab, dir: string): Promise<void> {
  // Any preview in flight belongs to the directory being left; a listing is
  // a navigation, so the read is retired before the new rows arrive and a
  // late answer cannot describe a file this listing no longer shows.
  tab.previewSeq += 1;
  const seq = ++tab.listSeq;
  tab.loading = true;
  tab.error = null;
  let result: FsResult<DirListing>;
  try {
    result = await window.awefork.listDir(dir);
  } catch {
    result = { ok: false, error: { code: "unknown" } };
  }
  // A newer navigation (or a refresh of another directory) already won.
  if (seq !== tab.listSeq) return;
  tab.loading = false;
  // The attempted directory is recorded either way: a failed listing still
  // shows where the user tried to go, so the error has a breadcrumb and a
  // path to correct, and "up" leads somewhere sensible.
  tab.browsing = dir;
  if (!result.ok) {
    tab.entries = [];
    tab.error = result.error;
    tab.capped = false;
    // The failed listing shows no rows, so the old selection and preview
    // would describe entries the user cannot see.
    tab.selectedPath = null;
    tab.preview = null;
    return;
  }
  tab.browsing = result.value.path;
  tab.entries = result.value.entries;
  tab.capped = result.value.capped;
  // A selection that no longer exists in the listed directory is dropped,
  // so the preview never describes a row the user cannot see.
  if (tab.selectedPath && !result.value.entries.some((e) => e.path === tab.selectedPath)) {
    tab.selectedPath = null;
    tab.preview = null;
  }
}

/** Navigate the active tab to a directory, recording history. */
export async function browseTo(dir: string): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  await browseTabTo(tab, dir);
}

async function browseTabTo(tab: FileTab, dir: string): Promise<void> {
  if (tab.browsing !== null && samePath(dir, tab.browsing)) {
    await load(tab, tab.browsing);
    return;
  }
  if (tab.browsing !== null) {
    tab.history.push(tab.browsing);
    // A fresh navigation invalidates the forward stack, like any browser.
    tab.forward = [];
  }
  await load(tab, dir);
}

export async function goBack(): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const previous = tab.history.pop();
  if (previous === undefined) return;
  if (tab.browsing !== null) tab.forward.push(tab.browsing);
  await load(tab, previous);
}

export async function goForward(): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const next = tab.forward.pop();
  if (next === undefined) return;
  if (tab.browsing !== null) tab.history.push(tab.browsing);
  await load(tab, next);
}

export async function goUp(): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.browsing === null) return;
  const parent = parentOf(tab.browsing);
  if (parent === null) return;
  await browseTabTo(tab, parent);
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
  const tab = activeTab();
  if (!tab) return;
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
    if (parent !== null) await browseTabTo(tab, parent);
    await previewEntry(entryFromPath(target));
    return;
  }
  await browseTabTo(tab, target);
}

export async function refresh(): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.browsing === null) return;
  await load(tab, tab.browsing);
}

export function selectEntry(entry: FileEntry): void {
  const tab = activeTab();
  if (tab) tab.selectedPath = entry.path;
}

/**
 * A click on a row: a file is selected and previewed in one step (the
 * side dock's click already previews), a directory is only selected so the
 * preview pane keeps describing a file. The previous click's preview, if
 * still in flight, must not land afterwards and describe a row the user has
 * already moved past — that is the same staleness rule as previewEntry's.
 */
export function selectOrPreviewEntry(entry: FileEntry): void {
  const tab = activeTab();
  if (!tab) return;
  tab.selectedPath = entry.path;
  if (entry.isDir) return;
  if (settings.files.openOnDouble === "system") return;
  void previewEntry(entry);
}

/** Drop the current preview without touching the selection. */
export function clearPreview(): void {
  const tab = activeTab();
  if (!tab) return;
  tab.previewSeq += 1;
  tab.preview = null;
}

export function setFilter(value: string): void {
  const tab = activeTab();
  if (tab) tab.filter = value;
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

// The settings page writes settings.files.view/showHidden directly; without
// this mirror the toolbar keeps this boot's seed until a restart, and the
// toolbar toggle then writes that stale seed back over the settings change.
watch(
  () => settings.files.view,
  (view) => {
    files.view = view as FileView;
  },
);
watch(
  () => settings.files.showHidden,
  (showHidden) => {
    files.showHidden = showHidden;
  },
);

/** Directories shown by the current filter and hidden-files setting. */
export function visibleEntries(): FileEntry[] {
  const tab = activeTab();
  if (!tab) return [];
  const needle = tab.filter.trim().toLowerCase();
  return tab.entries.filter((entry) => {
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
  const tab = activeTab();
  if (!tab) return;
  if (entry.isDir || entry.isSymlink) {
    await browseTabTo(tab, entry.path);
    // A symlink pointing at a file answers "not a directory"; preview it
    // instead of leaving the user on an error.
    if (tab.error?.code === "not-a-directory") {
      tab.error = null;
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
      tab.selectedPath = entry.path;
      return;
    }
  }
  await previewEntry(entry);
}

/** Preview a file; responses that lost the race are dropped. */
export async function previewEntry(entry: FileEntry): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const seq = ++tab.previewSeq;
  tab.selectedPath = entry.path;
  tab.preview = { path: entry.path, status: "loading" };
  const image = await window.awefork
    .readImagePreview(entry.path, settings.files.imageCapMb * 1024 * 1024)
    .catch(() => null);
  if (seq !== tab.previewSeq) return;
  if (image?.ok) {
    const value: ImagePreview = image.value;
    tab.preview = {
      path: entry.path,
      status: "image",
      dataUrl: value.dataUrl,
      bytes: value.bytes,
    };
    return;
  }
  // An image that exists but is too big fails only as an image; surfacing
  // "binary" from the text fallback below would misname the problem.
  if (image && !image.ok && image.error.code === "too-large") {
    tab.preview = { path: entry.path, status: "error", error: image.error };
    return;
  }
  const text = await window.awefork
    .readTextPreview(entry.path, settings.files.previewCapKb * 1024)
    .catch(() => null);
  if (seq !== tab.previewSeq) return;
  if (text?.ok) {
    const value: TextPreview = text.value;
    tab.preview = {
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
  tab.preview = {
    path: entry.path,
    status: "error",
    error: text && !text.ok ? text.error : { code: "binary" },
  };
}

/**
 * Locate an entry from elsewhere (quick open, "reveal"): enter its parent
 * directory, select it, and preview it when it is a file.
 */
export async function revealEntry(entry: FileEntry): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const parent = parentOf(entry.path);
  if (parent !== null && !samePath(parent, tab.browsing ?? "")) {
    await browseTabTo(tab, parent);
  }
  tab.selectedPath = entry.path;
  if (!entry.isDir) await previewEntry(entry);
}

/** Quick search inside one project root (never the browsing directory). */
export async function quickSearch(root: string, query: string): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  const seq = ++tab.quickSeq;
  tab.quickQuery = query;
  const needle = query.trim();
  if (needle === "" || root === "") {
    tab.quickResults = [];
    tab.quickLoading = false;
    tab.quickError = null;
    return;
  }
  tab.quickLoading = true;
  tab.quickError = null;
  const result = await window.awefork
    .searchFiles(root, needle, { includeHidden: files.quickIncludeHidden })
    .catch(() => null);
  if (seq !== tab.quickSeq) return;
  tab.quickLoading = false;
  if (!result?.ok) {
    tab.quickResults = [];
    tab.quickError = result && !result.ok ? result.error : { code: "unknown" };
    return;
  }
  tab.quickResults = result.value;
}

export function setQuickIncludeHidden(value: boolean): void {
  files.quickIncludeHidden = value;
}

export function clearQuickSearch(): void {
  const tab = activeTab();
  if (!tab) return;
  tab.quickSeq += 1;
  tab.quickQuery = "";
  tab.quickResults = [];
  tab.quickLoading = false;
  tab.quickError = null;
}

// ── sidebar tree ───────────────────────────────────────────────────────

/** Bumped per directory on every tree load; stale responses are dropped. */
const treeSeq: Record<string, number> = {};

export async function loadTreeChildren(dir: string): Promise<void> {
  treeSeq[dir] = (treeSeq[dir] ?? 0) + 1;
  const seq = treeSeq[dir];
  files.treeLoading[dir] = true;
  files.treeError[dir] = null;
  const result = await window.awefork.listDir(dir).catch(() => null);
  // A newer load for the same directory already won; let it finish the job.
  if (seq !== treeSeq[dir]) return;
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
