<template>
  <div
    v-if="tab"
    class="fb"
    :class="{ 'drop-on': pathDragOver }"
    @dragover="onPathDragOver"
    @dragleave="onPathDragLeave"
    @drop="onPathDrop"
  >
    <div class="fb-tabs" role="tablist" :aria-label="t('files.tabsLabel')">
      <button
        v-for="entry in files.tabs"
        :key="entry.id"
        type="button"
        role="tab"
        class="fb-tab"
        :class="tabClass(entry)"
        :aria-selected="entry.id === files.activeTabId"
        :title="entry.browsing ?? undefined"
        draggable="true"
        @dragstart="tabDrag.onDragStart(entry.id, $event)"
        @dragover="tabDrag.onDragOver(entry.id, $event)"
        @dragleave="tabDrag.onDragLeave(entry.id, $event)"
        @drop="tabDrag.onDrop(entry.id, $event)"
        @dragend="tabDrag.onDragEnd()"
        @click="activateFileTab(entry.id)"
        @auxclick="onTabAuxClick(entry.id, $event)"
      >
        <span class="fb-tab-title">{{ fileTabLabel(entry) }}</span>
        <span
          class="fb-tab-x"
          role="button"
          :aria-label="t('files.tabClose')"
          :title="t('files.tabClose')"
          @click.stop="closeFileTab(entry.id)"
          >×</span
        >
      </button>
      <button
        type="button"
        class="fb-tab fb-tab-new"
        :title="t('files.tabNew')"
        :aria-label="t('files.tabNew')"
        @click="openFileTab()"
        >
        ＋</button
      >
    </div>
    <div class="fb-toolbar">
      <div class="fb-nav">
        <button
          type="button"
          class="fb-btn"
          :disabled="tab.history.length === 0"
          :title="t('files.back')"
          :aria-label="t('files.back')"
          @click="goBack"
        >
          ‹</button
        >
        <button
          type="button"
          class="fb-btn"
          :disabled="tab.forward.length === 0"
          :title="t('files.forward')"
          :aria-label="t('files.forward')"
          @click="goForward"
        >
          ›</button
        >
        <button
          type="button"
          class="fb-btn"
          :disabled="!canGoUp"
          :title="t('files.up')"
          :aria-label="t('files.up')"
          @click="goUp"
        >
          ↑</button
        >
        <button
          type="button"
          class="fb-btn"
          :disabled="tab.browsing === null"
          :title="t('files.refresh')"
          :aria-label="t('files.refresh')"
          @click="refresh"
        >
          ⟳</button
        >
      </div>
      <nav v-if="crumbs.length > 0" class="fb-crumbs" :aria-label="t('files.breadcrumb')">
        <template v-for="(crumb, i) in crumbs" :key="crumb.path">
          <button
            type="button"
            class="fb-crumb"
            :class="{ last: i === crumbs.length - 1 }"
            :title="crumb.path"
            @click="browseTo(crumb.path)"
            >{{ crumb.label }}</button
          ><span v-if="i < crumbs.length - 1" class="fb-crumb-sep">›</span>
        </template>
      </nav>
      <form class="fb-path-form" @submit.prevent="submitPath">
        <input
          v-model="pathInput"
          class="fb-path"
          type="text"
          :placeholder="t('files.pathPlaceholder')"
          :aria-label="t('files.pathLabel')"
          spellcheck="false"
        />
      </form>
      <input
        v-model="filterInput"
        class="fb-filter"
        type="text"
        :placeholder="t('files.filterPlaceholder')"
        :aria-label="t('files.filterHere')"
        spellcheck="false"
      />
      <button
        type="button"
        class="fb-btn"
        :class="{ on: files.showHidden }"
        :title="t('files.showHidden')"
        :aria-label="t('files.showHidden')"
        :aria-pressed="files.showHidden"
        @click="toggleHidden"
      >
        ◉</button
      >
      <button
        type="button"
        class="fb-btn"
        :class="{ on: files.view === 'grid' }"
        :title="t('files.toggleView')"
        :aria-label="t('files.toggleView')"
        @click="toggleView"
      >
        ▦</button
      >
    </div>

    <div class="fb-quick">
      <span class="fb-quick-icon" aria-hidden="true">⌕</span>
      <input
        v-model="quickInput"
        class="fb-quick-input"
        type="text"
        :placeholder="quickPlaceholder"
        :aria-label="t('files.quickOpen')"
        spellcheck="false"
        @input="runQuickSearch"
        @keydown.down.prevent="focusFirstQuick"
        @keydown.enter.prevent="pickFirstQuick"
        @keydown.esc="clearQuickSearch"
      />
      <label class="fb-quick-hidden" :title="t('files.quickIncludeHidden')">
        <input
          v-model="quickHiddenInput"
          type="checkbox"
          @change="runQuickSearch"
        />{{ t("files.quickHiddenShort") }}
      </label>
      <span
        v-if="quickScopeLabel"
        class="fb-quick-status"
        :title="quickScope ?? undefined"
        >{{ t("files.quickScope", { dir: quickScopeLabel }) }}</span
      >
      <span v-if="tab.quickLoading" class="fb-quick-status">{{ t("files.searching") }}</span>
      <span v-else-if="quickErrorText" class="fb-quick-status err">{{ quickErrorText }}</span>
      <span v-else-if="tab.quickResults.length > 0" class="fb-quick-status">{{
        t("files.quickCount", { n: tab.quickResults.length })
      }}</span>
    </div>
    <div v-if="quickOpen && tab.quickResults.length > 0" class="fb-quick-results">
      <button
        v-for="entry in tab.quickResults"
        :key="entry.path"
        ref="quickItems"
        type="button"
        class="fb-quick-row"
        :title="entry.path"
        draggable="true"
        @dragstart="startPathDrag($event, [entry.path])"
        @click="pickQuick(entry)"
        @contextmenu.prevent="openFileMenu(entry, $event.clientX, $event.clientY)"
      >
        <span class="fb-quick-row-icon" aria-hidden="true">{{ entry.isDir ? "📁" : "📄" }}</span>
        <span class="fb-quick-row-name">{{ entry.name }}</span>
        <span class="fb-quick-row-path">{{ parentLabel(entry.path) }}</span>
      </button>
    </div>

    <div
      class="fb-body"
      :class="{ 'fb-body-narrow': narrow, 'fb-body-reading': tab.reading }"
      @keydown.esc="exitReading"
    >
      <div v-if="tab.reading" class="fb-reading-bar">
        <button
          type="button"
          class="fb-btn"
          :title="t('files.exitReading')"
          :aria-label="t('files.exitReading')"
          @click="exitReading"
        >
          ‹</button
        >
        <span class="fb-reading-name" :title="tab.browsing ?? undefined">{{
          tab.browsing ? displayName(tab.browsing) : t("files.tabBlank")
        }}</span>
      </div>
      <div
        ref="entriesEl"
        class="fb-entries"
        :class="files.view"
        tabindex="0"
        @contextmenu.prevent
        @keydown="onEntriesKeydown"
        @scroll="onEntriesScroll"
      >
        <p v-if="tab.loading" class="fb-state">{{ t("files.loading") }}</p>
        <p v-else-if="listError" class="fb-state err">{{ listError }}</p>
        <p v-else-if="tab.entries.length === 0" class="fb-state">{{ t("files.dirEmpty") }}</p>
        <p v-else-if="rows.length === 0" class="fb-state">
          {{ t("files.noMatch") }}
        </p>
        <template v-else-if="files.view === 'list'">
          <div class="fb-list-head">
            <span class="fb-col-caret"></span>
            <span class="fb-col-name">{{ t("files.colName") }}</span>
            <span class="fb-col-size">{{ t("files.colSize") }}</span>
            <span class="fb-col-mtime">{{ t("files.colModified") }}</span>
          </div>
          <div
            v-for="row in listRows"
            :key="row.entry.path"
            class="fb-row-wrap"
            :style="{ '--fb-depth': row.depth }"
          >
            <button
              v-if="row.entry.isDir"
              type="button"
              class="fb-row-caret"
              :aria-expanded="row.expanded"
              :title="t('files.toggleTree')"
              @click.stop="toggleTreeNode(row.entry.path)"
              >{{ row.expanded ? "▾" : "▸" }}</button
            >
            <span v-else class="fb-row-caret fb-row-caret-off" aria-hidden="true"></span>
            <button
              type="button"
              class="fb-row"
              :class="{ selected: row.entry.path === tab.selectedPath }"
              draggable="true"
              @dragstart="startPathDrag($event, [row.entry.path])"
              @click="selectOrPreviewEntry(row.entry)"
              @dblclick="openEntry(row.entry)"
              @keydown.enter.prevent="openEntry(row.entry)"
              @contextmenu.prevent="openFileMenu(row.entry, $event.clientX, $event.clientY)"
            >
              <span class="fb-row-icon" aria-hidden="true">{{
                row.entry.isDir ? "📁" : row.entry.isSymlink ? "🔗" : "📄"
              }}</span>
              <span class="fb-row-name" :title="row.entry.path">{{ row.entry.name }}</span>
              <span class="fb-row-size">{{
                row.entry.isDir ? t("files.dirSizeDash") : formatBytes(row.entry.size ?? 0)
              }}</span>
              <span class="fb-row-mtime">{{
                row.entry.mtime === null ? "" : formatTimestamp(row.entry.mtime)
              }}</span>
            </button>
            <p v-if="row.error" class="fb-row-error">{{ describeFsError(row.error) }}</p>
          </div>
        </template>
        <template v-else>
          <button
            v-for="row in gridRows"
            :key="row.entry.path"
            type="button"
            class="fb-tile"
            :class="{ selected: row.entry.path === tab.selectedPath }"
            draggable="true"
            @dragstart="startPathDrag($event, [row.entry.path])"
            @click="selectOrPreviewEntry(row.entry)"
            @dblclick="openEntry(row.entry)"
            @keydown.enter.prevent="openEntry(row.entry)"
            @contextmenu.prevent="openFileMenu(row.entry, $event.clientX, $event.clientY)"
          >
            <span class="fb-tile-icon" aria-hidden="true">{{
              row.entry.isDir ? "📁" : row.entry.isSymlink ? "🔗" : "📄"
            }}</span>
            <span class="fb-tile-name" :title="row.entry.path">{{ row.entry.name }}</span>
          </button>
        </template>
        <p v-if="tab.capped" class="fb-capped">{{ t("files.capped", { n: MAX_ENTRIES }) }}</p>
      </div>
      <div v-if="tab.preview !== null && !narrow" class="fb-split" @mousedown="startSplitDrag"></div>
      <aside
        v-if="tab.preview !== null"
        class="fb-preview"
        :class="{ 'fb-preview-overlay': narrow }"
        :style="previewStyle"
      >
        <FilePreview :preview="tab.preview" :reading="tab.reading" @toggle-reading="toggleReading" />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { displayName, joinSegments, parentOf, pathSegments } from "../../../shared/file-paths";
import type { FileEntry, FileError } from "../../../shared/file-types";
import { MAX_ENTRIES } from "../../../shared/file-types";
import { openFileMenu } from "../file-menu";
import {
  activateFileTab,
  browseTo,
  clearQuickSearch,
  closeFileTab,
  ensureBrowsing,
  exitReading,
  type FileTab,
  files,
  fileTabLabel,
  flashNotice,
  goBack,
  goForward,
  goToPath,
  goUp,
  isPathDrag,
  nestedListingRows,
  openEntry,
  openFileTab,
  openPathsInNewTabs,
  quickSearch,
  readPathDrop,
  refresh,
  reorderFileTab,
  revealEntry,
  selectOrPreviewEntry,
  setFilter,
  setListingScroll,
  setPreviewWidth,
  setQuickIncludeHidden,
  setView,
  startPathDrag,
  stepReading,
  toggleHidden,
  toggleReading,
  toggleTreeNode,
  visibleEntries,
} from "../files";
import { formatBytes, formatTimestamp } from "../format";
import { t } from "../i18n";
import { mainView } from "../layout";
import { store } from "../state";
import { createTabDrag } from "../tab-drag";
import FilePreview from "./file-preview.vue";

const pathInput = ref("");
const filterInput = ref("");
const quickInput = ref("");
const quickHiddenInput = ref(false);
const quickItems = ref<HTMLButtonElement[]>([]);

/**
 * The tab every read and write below goes through. The browser only renders
 * while the files view is up, and ensureBrowsing guarantees a tab by then,
 * so a null here means the labs gate is off rather than a missing row.
 */
const tab = computed<FileTab | null>(
  () => files.tabs.find((entry) => entry.id === files.activeTabId) ?? null,
);

/**
 * True while the middle column cannot hold a listing and a preview side by
 * side. Below the threshold the preview covers the listing instead of
 * squeezing both into a pair of slivers.
 */
const narrow = ref(false);

// The middle column is the element that decides whether a listing and a
// preview fit side by side; its width is what a panel drag changes.
let narrowObserver: ResizeObserver | null = null;
onMounted(() => {
  const host = document.querySelector(".main-col");
  if (host) {
    narrowObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      narrow.value = width > 0 && width < 640;
    });
    narrowObserver.observe(host);
  }
  window.addEventListener("keydown", onReadingKeys);
});
onBeforeUnmount(() => {
  narrowObserver?.disconnect();
  narrowObserver = null;
  window.removeEventListener("keydown", onReadingKeys);
  if (splitDrag) {
    window.removeEventListener("mousemove", splitDrag.move);
    window.removeEventListener("mouseup", splitDrag.up);
    splitDrag = null;
  }
});

/**
 * Reading mode owns the arrows while it is on. The listing it folded away
 * held the only arrow handlers, and once its rows are display:none the focus
 * sits on the document — so the keys are caught at the window instead. The
 * boxes that use the arrows themselves (quick filter, path box) keep theirs.
 */
function onReadingKeys(event: KeyboardEvent): void {
  if (!tab.value?.reading) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable]")) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    stepReading(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    stepReading(-1);
  }
}

/**
 * Drag the divider between the listing and the preview. The width is held
 * by the tab, so a tab comes back at the width it was left at. The body
 * width is measured live so the listing keeps its floor however the window
 * is resized mid-drag.
 */
interface SplitDrag {
  move: (event: MouseEvent) => void;
  up: () => void;
}

let splitDrag: SplitDrag | null = null;

const previewStyle = computed(() => ({
  "--fb-preview-width": `${tab.value?.previewWidth ?? 340}px`,
}));

function startSplitDrag(event: MouseEvent): void {
  if (event.button !== 0 || splitDrag) return;
  event.preventDefault();
  const body = (event.currentTarget as HTMLElement).parentElement;
  if (!body) return;
  const rect = body.getBoundingClientRect();
  const move = (moveEvent: MouseEvent): void => {
    setPreviewWidth(Math.round(rect.right - moveEvent.clientX), rect.width);
  };
  const up = (): void => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    splitDrag = null;
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  splitDrag = { move, up };
}

/** Middle-click closes, like the canvas tabs. */
function onTabAuxClick(tabId: string, event: MouseEvent): void {
  if (event.button === 1) void closeFileTab(tabId);
}

/** Drag-to-reorder: the strip order is the tab order, browsing stays put. */
const tabDrag = createTabDrag(() => files.tabs.map((tab) => tab.id), reorderFileTab);

/** Active / dragged / drop-marker classes for one tab. */
function tabClass(tab: FileTab): Record<string, boolean> {
  const marker = tabDrag.marker.value;
  return {
    on: tab.id === files.activeTabId,
    dragging: tabDrag.draggingId.value === tab.id,
    "drop-before": marker?.id === tab.id && marker.side === "before",
    "drop-after": marker?.id === tab.id && marker.side === "after",
  };
}

// ── path drops ────────────────────────────────────────────────────────
// The whole browser is one drop target: a path dragged out of the sidebar
// (or in from the Finder) opens in its own new tab. The middle-column tab
// strip already switches to this view mid-drag, so the gesture is "drag,
// hover the 文件 tab, drop anywhere here".

const pathDragOver = ref(false);

function onPathDragOver(event: DragEvent): void {
  if (!isPathDrag(event)) return;
  // preventDefault is what makes this element a drop target at all.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  pathDragOver.value = true;
}

function onPathDragLeave(event: DragEvent): void {
  // Leaving for a child (a row, the preview) is not leaving the browser.
  const related = event.relatedTarget as Node | null;
  const root = event.currentTarget as HTMLElement | null;
  if (related && root?.contains(related)) return;
  pathDragOver.value = false;
}

async function onPathDrop(event: DragEvent): Promise<void> {
  pathDragOver.value = false;
  const drop = readPathDrop(event);
  if (!drop) return;
  // Declared a drop target in dragover; without this the browser default
  // (open the file) would navigate the renderer away.
  event.preventDefault();
  if (drop.paths.length === 0) {
    // Files arrived but the OS would not name them — say so, and never
    // invent a path or open a tab on nothing.
    flashNotice(t("files.dropNoPath"));
    return;
  }
  await openPathsInNewTabs(drop.paths);
}

/** ↑ / ↓ walk the rows and preview the file the focus lands on. */
function stepSelection(offset: number): void {
  const rowsNow = rows.value;
  if (rowsNow.length === 0) return;
  const current = rowsNow.findIndex((row) => row.entry.path === tab.value?.selectedPath);
  const next = Math.min(Math.max((current < 0 ? 0 : current) + offset, 0), rowsNow.length - 1);
  const target = rowsNow[next];
  if (target) selectOrPreviewEntry(target.entry);
}

const entriesEl = ref<HTMLDivElement | null>(null);

/** ↑/↓ walk the rows, Enter opens the selection, Backspace goes up. */
function onEntriesKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    stepSelection(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    stepSelection(-1);
    return;
  }
  if (event.key === "Enter") {
    const selected = tab.value?.selectedPath;
    const entry = rows.value.find((row) => row.entry.path === selected)?.entry;
    if (entry) {
      event.preventDefault();
      void openEntry(entry);
    }
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    void goUp();
  }
}

/** The listing's scroll offset, parked on the tab so switching restores it. */
function onEntriesScroll(event: Event): void {
  const el = event.target as HTMLElement | null;
  if (el) setListingScroll(el.scrollTop);
}

// The path box mirrors the browsing directory until the user edits it.
watch(
  () => tab.value?.browsing,
  (dir) => {
    pathInput.value = dir ?? "";
  },
);

// A tab switch must also bring its own filter and quick-query text back to
// the boxes — otherwise the listing is filtered by one tab while the box
// still shows the other's text, and the filter looks broken.
watch(
  () => files.activeTabId,
  () => {
    filterInput.value = tab.value?.filter ?? "";
    quickInput.value = tab.value?.quickQuery ?? "";
  },
);

// The listing scrolls back where the tab left it once its rows are rendered.
watch(
  () => tab.value?.id,
  async () => {
    const top = tab.value?.scrollTop ?? 0;
    await nextTick();
    if (entriesEl.value) entriesEl.value.scrollTop = top;
  },
);

// Reading mode folds the listing away; leaving it puts the rows back, so the
// saved offset is re-applied (a display:none listing cannot keep its own).
watch(
  () => tab.value?.reading,
  async (reading) => {
    if (reading) return;
    const top = tab.value?.scrollTop ?? 0;
    await nextTick();
    if (entriesEl.value) entriesEl.value.scrollTop = top;
  },
);

watch(filterInput, (value) => setFilter(value));
watch(quickInput, (value) => {
  if (value.trim() === "") clearQuickSearch();
});
watch(quickHiddenInput, (value) => setQuickIncludeHidden(value));

// The first time the file view is shown, land somewhere useful — the open
// project, else the home directory. Afterwards the browsing position
// belongs to the user and survives view switches. Waiting for boot keeps
// the project root (which loads asynchronously) ahead of the home dir.
watch(
  [mainView, () => store.booted],
  () => {
    if (mainView.value === "files" && store.booted) {
      void ensureBrowsing(store.selectedDirectory);
    }
  },
  { immediate: true },
);

const crumbs = computed(() => {
  if (tab.value === null || tab.value.browsing === null) return [];
  const segments = pathSegments(tab.value.browsing);
  return segments.map((segment, index) => ({
    label: segment,
    path: joinSegments(segments.slice(0, index + 1)),
  }));
});

const canGoUp = computed(
  () => tab.value !== null && tab.value.browsing !== null && parentOf(tab.value.browsing) !== null,
);

/** The rows the list/grid renders — filter and hidden-files applied. */
const listRows = computed(() => nestedListingRows(visibleEntries()));

/**
 * The grid stays flat: tiles have no room for nesting, so a folder there is
 * still entered with a double-click. Both views render the same entries —
 * only the list view unfolds them.
 */
const gridRows = computed(() =>
  visibleEntries().map((entry) => ({ entry, depth: 0, expanded: false })),
);

/** Whatever the current view renders; the arrow keys walk exactly that. */
const rows = computed(() => (files.view === "list" ? listRows.value : gridRows.value));

/** One phrasing per filesystem failure, shared by the listing and a folder
 *  that would not unfold. */
function describeFsError(error: FileError): string {
  switch (error.code) {
    case "not-found":
      return t("files.errNotFound");
    case "not-a-directory":
      return t("files.errNotADirectory");
    case "permission":
      return t("files.errPermission");
    default:
      return error.message ? `${t("files.errUnknown")}：${error.message}` : t("files.errUnknown");
  }
}

const listError = computed(() => {
  const error = tab.value?.error ?? null;
  if (!error) return null;
  return describeFsError(error);
});

const quickErrorText = computed(() => {
  const error = tab.value?.quickError ?? null;
  if (!error) return "";
  switch (error.code) {
    case "not-found":
      return t("files.quickNoProject");
    case "permission":
      return t("files.errPermission");
    default:
      return t("files.quickFailed");
  }
});

/**
 * Quick search is scoped to the tab's own browsing directory — the person is
 * looking at one directory, and the search box should say so. The project
 * root only fills in before the first browse has landed.
 */
const quickScope = computed(() => tab.value?.browsing ?? store.selectedDirectory);
const quickScopeLabel = computed(() => (quickScope.value ? displayName(quickScope.value) : ""));

const quickPlaceholder = computed(() =>
  quickScope.value ? t("files.quickPlaceholder") : t("files.quickNoProject"),
);

const quickOpen = computed(() => (tab.value?.quickQuery ?? "").trim() !== "");

function runQuickSearch(): void {
  const root = quickScope.value;
  if (!root) {
    flashNotice(t("files.quickNoProject"));
    return;
  }
  void quickSearch(root, quickInput.value);
}

function pickQuick(entry: FileEntry): void {
  void revealEntry(entry);
}

async function pickFirstQuick(): Promise<void> {
  const first = tab.value?.quickResults[0];
  if (!first) return;
  await revealEntry(first);
}

function focusFirstQuick(): void {
  void nextTick(() => quickItems.value[0]?.focus());
}

function parentLabel(path: string): string {
  const parent = parentOf(path);
  return parent === null ? "" : displayName(parent);
}

function submitPath(): void {
  const value = pathInput.value.trim();
  if (value === "") return;
  void goToPath(value);
}

function toggleView(): void {
  setView(files.view === "list" ? "grid" : "list");
}
</script>
