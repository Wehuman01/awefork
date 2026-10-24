<template>
  <div class="fb">
    <div class="fb-toolbar">
      <div class="fb-nav">
        <button
          type="button"
          class="fb-btn"
          :disabled="files.history.length === 0"
          :title="t('files.back')"
          :aria-label="t('files.back')"
          @click="goBack"
        >
          ‹</button
        >
        <button
          type="button"
          class="fb-btn"
          :disabled="files.forward.length === 0"
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
          :disabled="files.browsing === null"
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
      <span v-if="files.quickLoading" class="fb-quick-status">{{ t("files.searching") }}</span>
      <span v-else-if="quickErrorText" class="fb-quick-status err">{{ quickErrorText }}</span>
      <span v-else-if="files.quickResults.length > 0" class="fb-quick-status">{{
        t("files.quickCount", { n: files.quickResults.length })
      }}</span>
    </div>
    <div v-if="quickOpen && files.quickResults.length > 0" class="fb-quick-results">
      <button
        v-for="entry in files.quickResults"
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

    <div class="fb-body" :class="{ 'fb-body-narrow': narrow }">
      <div class="fb-entries" :class="files.view" @contextmenu.prevent>
        <p v-if="files.loading" class="fb-state">{{ t("files.loading") }}</p>
        <p v-else-if="listError" class="fb-state err">{{ listError }}</p>
        <p v-else-if="files.entries.length === 0" class="fb-state">{{ t("files.dirEmpty") }}</p>
        <p v-else-if="rows.length === 0" class="fb-state">
          {{ t("files.noMatch") }}
        </p>
        <template v-else-if="files.view === 'list'">
          <div class="fb-list-head">
            <span class="fb-col-name">{{ t("files.colName") }}</span>
            <span class="fb-col-size">{{ t("files.colSize") }}</span>
            <span class="fb-col-mtime">{{ t("files.colModified") }}</span>
          </div>
          <button
            v-for="entry in rows"
            :key="entry.path"
            type="button"
            class="fb-row"
            :class="{ selected: entry.path === files.selectedPath }"
            draggable="true"
            @dragstart="startPathDrag($event, [entry.path])"
            @click="selectOrPreviewEntry(entry)"
            @dblclick="openEntry(entry)"
            @keydown.enter.prevent="openEntry(entry)"
            @contextmenu.prevent="openFileMenu(entry, $event.clientX, $event.clientY)"
          >
            <span class="fb-row-icon" aria-hidden="true">{{
              entry.isDir ? "📁" : entry.isSymlink ? "🔗" : "📄"
            }}</span>
            <span class="fb-row-name" :title="entry.path">{{ entry.name }}</span>
            <span class="fb-row-size">{{
              entry.isDir ? t("files.dirSizeDash") : formatBytes(entry.size ?? 0)
            }}</span>
            <span class="fb-row-mtime">{{
              entry.mtime === null ? "" : formatTimestamp(entry.mtime)
            }}</span>
          </button>
        </template>
        <template v-else>
          <button
            v-for="entry in rows"
            :key="entry.path"
            type="button"
            class="fb-tile"
            :class="{ selected: entry.path === files.selectedPath }"
            draggable="true"
            @dragstart="startPathDrag($event, [entry.path])"
            @click="selectOrPreviewEntry(entry)"
            @dblclick="openEntry(entry)"
            @keydown.enter.prevent="openEntry(entry)"
            @contextmenu.prevent="openFileMenu(entry, $event.clientX, $event.clientY)"
          >
            <span class="fb-tile-icon" aria-hidden="true">{{
              entry.isDir ? "📁" : entry.isSymlink ? "🔗" : "📄"
            }}</span>
            <span class="fb-tile-name" :title="entry.path">{{ entry.name }}</span>
          </button>
        </template>
        <p v-if="files.capped" class="fb-capped">{{ t("files.capped", { n: MAX_ENTRIES }) }}</p>
      </div>
      <div v-if="files.preview !== null && !narrow" class="fb-split" @mousedown="startSplitDrag"></div>
      <aside
        v-if="files.preview !== null"
        class="fb-preview"
        :class="{ 'fb-preview-overlay': narrow }"
        :style="previewStyle"
      >
        <FilePreview :preview="files.preview" />
      </aside>
    </div>

    <p v-if="files.notice" class="fb-notice">{{ files.notice }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { displayName, joinSegments, parentOf, pathSegments } from "../../../shared/file-paths";
import type { FileEntry } from "../../../shared/file-types";
import { MAX_ENTRIES } from "../../../shared/file-types";
import { openFileMenu } from "../file-menu";
import {
  browseTo,
  clearQuickSearch,
  ensureBrowsing,
  files,
  flashNotice,
  goBack,
  goForward,
  goToPath,
  goUp,
  openEntry,
  quickSearch,
  refresh,
  revealEntry,
  selectEntry,
  selectOrPreviewEntry,
  setFilter,
  setQuickIncludeHidden,
  setView,
  startPathDrag,
  toggleHidden,
  visibleEntries,
} from "../files";
import { formatBytes, formatTimestamp } from "../format";
import { t } from "../i18n";
import { mainView } from "../layout";
import { store } from "../state";
import FilePreview from "./file-preview.vue";

const pathInput = ref("");
const filterInput = ref("");
const quickInput = ref("");
const quickHiddenInput = ref(false);
const quickItems = ref<HTMLButtonElement[]>([]);

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
  if (!host) return;
  narrowObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    narrow.value = width > 0 && width < 640;
  });
  narrowObserver.observe(host);
});
onBeforeUnmount(() => {
  narrowObserver?.disconnect();
  narrowObserver = null;
  if (splitDrag) {
    window.removeEventListener("mousemove", splitDrag.move);
    window.removeEventListener("mouseup", splitDrag.up);
    splitDrag = null;
  }
});

/**
 * Drag the divider between the listing and the preview. The width lives in
 * a CSS variable on the browser root so the pane and the divider read the
 * same number, and it survives view switches within this boot.
 */
const previewWidth = ref(340);
const PREVIEW_MIN = 220;
const PREVIEW_MAX = 640;
interface SplitDrag {
  move: (event: MouseEvent) => void;
  up: () => void;
}

let splitDrag: SplitDrag | null = null;

const previewStyle = computed(() => ({ "--fb-preview-width": `${previewWidth.value}px` }));

function startSplitDrag(event: MouseEvent): void {
  if (event.button !== 0 || splitDrag) return;
  event.preventDefault();
  const body = (event.currentTarget as HTMLElement).parentElement;
  if (!body) return;
  // The rect is captured once: the body's right edge is fixed for the drag,
  // so a window resize mid-drag cannot make the width jump.
  const rect = body.getBoundingClientRect();
  const move = (moveEvent: MouseEvent): void => {
    const width = Math.round(rect.right - moveEvent.clientX);
    previewWidth.value = Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, width));
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

/** ↑ / ↓ walk the rows and preview the file the focus lands on. */
function stepSelection(offset: number): void {
  const rowsNow = rows.value;
  if (rowsNow.length === 0) return;
  const current = rowsNow.findIndex((entry) => entry.path === files.selectedPath);
  const next = Math.min(Math.max((current < 0 ? 0 : current) + offset, 0), rowsNow.length - 1);
  const target = rowsNow[next];
  if (target) selectOrPreviewEntry(target);
}

// The path box mirrors the browsing directory until the user edits it.
watch(
  () => files.browsing,
  (dir) => {
    pathInput.value = dir ?? "";
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
  if (files.browsing === null) return [];
  const segments = pathSegments(files.browsing);
  return segments.map((segment, index) => ({
    label: segment,
    path: joinSegments(segments.slice(0, index + 1)),
  }));
});

const canGoUp = computed(() => files.browsing !== null && parentOf(files.browsing) !== null);

/** The rows the list/grid renders — filter and hidden-files applied. */
const rows = computed(() => visibleEntries());

const listError = computed(() => {
  const error = files.error;
  if (!error) return null;
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
});

const quickErrorText = computed(() => {
  const error = files.quickError;
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

/** Quick search is scoped to the project, never to the browsing directory. */
const projectRoot = computed(() => store.selectedDirectory);

const quickPlaceholder = computed(() =>
  projectRoot.value ? t("files.quickPlaceholder") : t("files.quickNoProject"),
);

const quickOpen = computed(() => files.quickQuery.trim() !== "");

function runQuickSearch(): void {
  const root = projectRoot.value;
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
  const first = files.quickResults[0];
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
