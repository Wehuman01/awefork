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
import { renderPdfPages } from "./pdf-preview";
import { settings } from "./settings";

/** The main process' own ceiling for a whole-document read; kept in sync here. */
const MAX_PDF_BYTES = 64 * 1024 * 1024;

/** Lowercased extension, or "" for a dotless name. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

/** Decode a data URL's base64 payload; null when the shape is not one. */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export type FileView = "list" | "grid";

export type PreviewStatus = "loading" | "text" | "image" | "pdf" | "error";

export interface PreviewState {
  path: string;
  status: PreviewStatus;
  text?: string;
  truncated?: boolean;
  dataUrl?: string;
  bytes?: number;
  error?: FileError;
  /** PDF: one rendered page image per entry, plus the page on screen. */
  pages?: string[];
  page?: number;
  pageCount?: number;
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
  /**
   * Reading mode: the listing has folded away and the preview owns the
   * middle column. Per tab, and deliberately NOT reset when the preview
   * changes — stepping to the next file with ↑/↓ keeps the reader reading.
   * It dies with the preview (clearPreview) or an explicit exit.
   */
  reading: boolean;
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
 * The reactive row for a tab that was just created and activated. The object
 * pushed into the store is still raw: navigating it directly mutates outside
 * Vue's tracking, and the view then keeps rendering whatever the last tracked
 * change left behind — a fresh tab stuck parked, or stuck on "loading", no
 * matter where its navigation actually landed. Reading the row back through
 * the store is what makes the navigation's own writes (browsing, loading,
 * error) re-render.
 */
function reactiveRow(created: FileTab): FileTab {
  return activeTab() ?? created;
}

/**
 * The tab an entry jump binds to. A dock click or a context-menu preview can
 * arrive before the browser view has mounted and called ensureBrowsing, so a
 * missing tab is created rather than dropping the click. Callers bind once
 * here and never re-read the active tab after an await — a jump made in one
 * tab must not land its preview on whichever tab is active when the read
 * returns.
 */
function requireTab(): FileTab {
  const existing = activeTab();
  if (existing) return existing;
  const tab = makeTab(null);
  files.tabs.push(tab);
  files.activeTabId = tab.id;
  return reactiveRow(tab);
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
    reading: false,
    scrollTop: 0,
    previewSeq: 0,
    listSeq: 0,
    quickSeq: 0,
  };
}

const DEFAULT_PREVIEW_WIDTH = 340;

/** The listing always keeps this much room; the preview clamps to the rest. */
export const MIN_LISTING_WIDTH = 240;

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
  // A jump-in from the canvas (a tree click, "open in new tab", a dock
  // click) switches the middle view and claims a tab in the same gesture,
  // so this landing resolves after that claim: `selectedPath` covers the
  // dock's claim made before its read starts, `loading` covers the claim
  // whose listing is already on its way. Landing on top of either would
  // race the caller's browse and win — the newer listing retires the older
  // one as stale — and the user would get the project root instead of the
  // folder they asked for.
  if (tab.loading) return;
  if (tab.selectedPath !== null) return;
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
  const created = makeTab(null);
  files.tabs.push(created);
  files.activeTabId = created.id;
  await browseTabTo(reactiveRow(created), target);
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

/**
 * Open dropped paths, one new tab each, in drop order — the file browser's
 * landing for a path dragged out of the sidebar (or in from the Finder).
 *
 * A directory becomes a tab position, reusing a tab that already shows it
 * (the rule the context menu's "open in new tab" follows: browsing the same
 * directory twice has nothing to say). A file always gets a fresh tab of its
 * parent directory with the file previewed — the parent is only where the
 * file lives, and a drop is a request not to disturb what is on screen.
 *
 * A stat decides which; a path that is neither (vanished between the drag
 * and the drop) opens as a directory anyway and lands on its own tab's
 * not-found error, which carries a breadcrumb the user can correct.
 * Identical paths open once; the last path ends up the active tab.
 */
export async function openPathsInNewTabs(paths: readonly string[]): Promise<void> {
  for (const path of [...new Set(paths)]) {
    const stat = await window.awefork.statFile(path).catch(() => null);
    if (stat?.ok && stat.value.exists && !stat.value.isDir) {
      const parent = parentOf(path);
      if (parent !== null) await openFileTab(parent);
      // previewEntry binds to the tab that is active now — the one just
      // opened — and its parent landing is already there, so the file is
      // previewed without a second navigation.
      await previewEntry(entryFromPath(path));
      continue;
    }
    await openFileTabFor(path);
  }
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
    await browseTabTo(reactiveRow(tab), files.homePath ?? "/");
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

/**
 * Set the split width, clamped against the space the preview may take: the
 * listing keeps a floor (240px incl. the splitter) so a wide preview can
 * never squeeze the file names into slivers, and the hard 220..640 range
 * still applies. The caller passes the measured body width when it has one;
 * without it only the hard range applies.
 */
export function setPreviewWidth(width: number, bodyWidth?: number): void {
  const tab = activeTab();
  if (!tab) return;
  let max = 640;
  if (bodyWidth !== undefined) {
    max = Math.min(max, Math.max(220, bodyWidth - MIN_LISTING_WIDTH));
  }
  tab.previewWidth = Math.min(max, Math.max(220, width));
}

export function setListingScroll(top: number): void {
  const tab = activeTab();
  if (tab) tab.scrollTop = top;
}

async function load(tab: FileTab, dir: string, forPreview = false): Promise<void> {
  // Any preview in flight belongs to the directory being left; a listing is
  // a navigation, so the read is retired before the new rows arrive and a
  // late answer cannot describe a file this listing no longer shows. A
  // navigation that is itself landing the preview's parent directory is the
  // exception: retiring here would kill the preview being prepared.
  if (!forPreview) tab.previewSeq += 1;
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
    // would describe entries the user cannot see. Reading dies with the
    // preview it was reading — the folded-away listing must come back.
    tab.selectedPath = null;
    tab.preview = null;
    tab.reading = false;
    return;
  }
  tab.browsing = result.value.path;
  tab.entries = result.value.entries;
  tab.capped = result.value.capped;
  // A selection that no longer exists in the listed directory is dropped,
  // so the preview never describes a row the user cannot see. A landing
  // made for a preview keeps its selection: the read is still in flight and
  // the file may legitimately miss the listing's first snapshot.
  if (
    !forPreview &&
    tab.selectedPath &&
    !result.value.entries.some((e) => e.path === tab.selectedPath)
  ) {
    tab.selectedPath = null;
    tab.preview = null;
    tab.reading = false;
  }
}

/** Navigate the active tab to a directory, recording history. */
export async function browseTo(dir: string): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  await browseTabTo(tab, dir);
}

/**
 * Navigate a tab to a directory, recording history unless this is a redraw.
 * `forPreview` marks the navigation as a *preparation* for a preview about
 * to be made (a dock jump landing on the file's parent): the listing that
 * arrives will describe the previewed file, so the in-flight read must not
 * be retired the way a real navigation retires it.
 */
async function browseTabTo(tab: FileTab, dir: string, forPreview = false): Promise<void> {
  if (tab.browsing !== null && samePath(dir, tab.browsing)) {
    await load(tab, tab.browsing, forPreview);
    return;
  }
  if (tab.browsing !== null) {
    tab.history.push(tab.browsing);
    // A fresh navigation invalidates the forward stack, like any browser.
    tab.forward = [];
  }
  await load(tab, dir, forPreview);
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
  // Only now is a jump certain: a rejected path must not leave behind the
  // blank tab requireTab would have created for it.
  const tab = requireTab();
  const stat = await window.awefork.statFile(target).catch(() => null);
  if (stat?.ok && stat.value.exists && !stat.value.isDir) {
    const parent = parentOf(target);
    if (parent !== null) await browseTabTo(tab, parent);
    await previewOnTab(tab, entryFromPath(target));
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
  const tab = requireTab();
  tab.selectedPath = entry.path;
  if (entry.isDir) return;
  if (settings.files.openOnDouble === "system") return;
  void previewOnTab(tab, entry);
}

/** Drop the current preview without touching the selection. */
export function clearPreview(): void {
  const tab = activeTab();
  if (!tab) return;
  tab.previewSeq += 1;
  tab.preview = null;
  // Nothing left to read: the folded-away listing comes back.
  tab.reading = false;
}

/**
 * Reading mode folds the listing away and lets the preview own the middle
 * column. Entering needs a preview to read; leaving is always allowed (Esc,
 * the return bar, the ⤢ toggle). Switching files does not leave — the flag
 * lives on the tab, not on the preview object.
 */
export function enterReading(): void {
  const tab = activeTab();
  if (!tab || tab.preview === null) return;
  tab.reading = true;
}

export function exitReading(): void {
  const tab = activeTab();
  if (tab) tab.reading = false;
}

export function toggleReading(): void {
  const tab = activeTab();
  if (!tab) return;
  if (tab.reading) {
    tab.reading = false;
    return;
  }
  if (tab.preview !== null) tab.reading = true;
}

/**
 * Step the preview to the next or previous file while reading. Directories
 * are skipped and the filter and ignore list still apply, so the reader
 * walks exactly the rows the listing shows. The reader keeps reading —
 * `reading` lives on the tab, not on the preview, which is the one case
 * that flag was built for. The preview is forced: a step is a request to
 * read the neighbour, whatever openOnDouble says about a plain click.
 */
export function stepReading(delta: number): void {
  const tab = activeTab();
  if (!tab?.reading) return;
  const filesOnly = visibleEntries().filter((entry) => !entry.isDir);
  if (filesOnly.length === 0) return;
  const current = filesOnly.findIndex((entry) => entry.path === tab.selectedPath);
  const next = Math.min(Math.max((current < 0 ? 0 : current) + delta, 0), filesOnly.length - 1);
  const target = filesOnly[next];
  if (!target) return;
  tab.selectedPath = target.path;
  void previewOnTab(tab, target);
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

/**
 * Name patterns from the settings' ignore list. `*` is the only wildcard;
 * everything else matches a name exactly (case-insensitively, like the
 * filesystems people browse).
 */
const ignoreMatchers: RegExp[] = [];
let ignoreSource = "";
function ignoreMatchersFor(patterns: readonly string[]): RegExp[] {
  const key = patterns.join("\n");
  if (key === ignoreSource) return ignoreMatchers;
  ignoreSource = key;
  ignoreMatchers.length = 0;
  for (const pattern of patterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) =>
      char === "*" ? ".*" : `\\${char}`,
    );
    ignoreMatchers.push(new RegExp(`^${escaped}$`, "i"));
  }
  return ignoreMatchers;
}

export function isIgnoredName(name: string): boolean {
  const matchers = ignoreMatchersFor(settings.files.ignore);
  return matchers.some((matcher) => matcher.test(name));
}

/** Entries shown by the current filter, hidden-files and ignore settings. */
export function visibleEntries(): FileEntry[] {
  const tab = activeTab();
  if (!tab) return [];
  const needle = tab.filter.trim().toLowerCase();
  return tab.entries.filter((entry) => {
    if (entry.hidden && !files.showHidden) return false;
    if (isIgnoredName(entry.name)) return false;
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
      await previewOnTab(tab, entry);
      if (tab.preview?.status !== "error") tab.reading = true;
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
  // A double-click is a request to read, not just to peek: the listing
  // folds away and the preview owns the middle column. An error pane is
  // not something to read — it keeps the listing up instead.
  await previewOnTab(tab, entry);
  if (tab.preview?.status !== "error") tab.reading = true;
}

/**
 * Preview a file; responses that lost the race are dropped. The tab is
 * bound once: a preview requested in one tab is never re-read against
 * whichever tab happens to be active when a slow IPC answer arrives.
 */
export async function previewEntry(entry: FileEntry): Promise<void> {
  const tab = requireTab();
  // Claim the selection before any await: a dock or menu jump on a parked
  // tab would otherwise let the view's first-landing watch (ensureBrowsing)
  // list the project root while the parent listing is still in flight.
  tab.selectedPath = entry.path;
  // A jump from a surface outside the browser (dock click, context menu) can
  // reach a tab that lists another directory — or none at all. Land on the
  // file's parent either way, so the listing underneath describes what the
  // preview shows; without it a refresh would drop the preview as a
  // selection that is not in the listing.
  const parent = parentOf(entry.path);
  if (parent !== null && !samePath(parent, tab.browsing ?? "")) {
    await browseTabTo(tab, parent, true);
  }
  await previewOnTab(tab, entry);
}

/** Preview on the bound tab — never re-reads the active tab. */
async function previewOnTab(tab: FileTab, entry: FileEntry): Promise<void> {
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
  // A PDF is rasterized in the renderer, so the document's bytes come over
  // once and the pages are produced there. The document cap lives in the
  // main process; this branch only decides the file is one.
  if (extensionOf(entry.path) === ".pdf") {
    const doc = await window.awefork
      .readFileAsDataUrl(entry.path, "application/pdf", MAX_PDF_BYTES)
      .catch(() => null);
    if (seq !== tab.previewSeq) return;
    const read = doc?.ok ? doc : null;
    const bytes = read ? dataUrlToBytes(read.value.dataUrl) : null;
    const rendered = bytes ? await renderPdfPages(bytes) : null;
    if (seq !== tab.previewSeq) return;
    if (rendered && rendered.pages.length > 0) {
      tab.preview = {
        path: entry.path,
        status: "pdf",
        pages: rendered.pages,
        page: 0,
        pageCount: rendered.pageCount,
        bytes: read?.value.bytes,
      };
      return;
    }
    // Unreadable, over the cap, or nothing rendered. A PDF must not fall
    // through to the text reader — its bytes would preview as noise — so it
    // lands on the error pane, which offers the system open.
    tab.preview = {
      path: entry.path,
      status: "error",
      error: doc && !doc.ok ? doc.error : { code: "binary" },
    };
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
 * directory, select it, and preview it when it is a file. The tab is bound
 * once at entry: if the user switches tabs while the listing is in flight,
 * the selection and preview still land on the tab the click belonged to.
 */
export async function revealEntry(entry: FileEntry): Promise<void> {
  const tab = requireTab();
  const parent = parentOf(entry.path);
  if (parent !== null && !samePath(parent, tab.browsing ?? "")) {
    await browseTabTo(tab, parent);
  }
  tab.selectedPath = entry.path;
  if (!entry.isDir) await previewOnTab(tab, entry);
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
  // The ignore list hides names from the browser's own surfaces — the
  // listing, the tree and the dock — so the quick box honours it too, or an
  // ignored name could be opened into a preview with no visible row.
  tab.quickResults = result.value.filter((entry) => !isIgnoredName(entry.name));
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
  // session file dock shows everything. The ignore list is applied where
  // the entries are read, so a settings change reaches loaded trees too.
  files.treeChildren[dir] = result.value.entries.filter((entry) => !entry.hidden);
}

/** A directory's loaded children minus the settings' ignored names. */
export function visibleTreeChildren(dir: string): FileEntry[] {
  return (files.treeChildren[dir] ?? []).filter((entry) => !isIgnoredName(entry.name));
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

/** One row of the browser's list view: an entry, its depth, its open state. */
export interface ListingRow {
  entry: FileEntry;
  /** Indentation level; 0 for the listed directory's own entries. */
  depth: number;
  /** True while this directory's children are nested underneath it. */
  expanded: boolean;
  /** Set when the directory is open but its children could not be read. */
  error?: FileError;
}

/**
 * The list view's rows: the given entries, with every open directory's own
 * children (recursively) nested below it — the same unfolding the sidebar
 * tree and the session dock do, driven by the same expansion state, so a
 * folder reads as open everywhere and its children cost no second read.
 *
 * The name filter deliberately stops at the listed directory: it scopes to
 * what the user is looking at, never to the subtree they unfold. Dotfiles
 * stay out, as they do in every tree — the listing's own ◉ toggle covers
 * the top level.
 */
export function nestedListingRows(entries: readonly FileEntry[]): ListingRow[] {
  const rows: ListingRow[] = [];
  const walk = (list: readonly FileEntry[], depth: number): void => {
    for (const entry of list) {
      const expanded = entry.isDir && isTreeNodeExpanded(entry.path);
      const error = expanded ? files.treeError[entry.path] : undefined;
      rows.push({ entry, depth, expanded, ...(error ? { error } : {}) });
      if (expanded) walk(visibleTreeChildren(entry.path), depth + 1);
    }
  };
  walk(entries, 0);
  return rows;
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
