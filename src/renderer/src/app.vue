<template>
  <div class="app">
    <TopBar />
    <div
      v-if="store.updateLatest && !store.updateBannerDismissed"
      class="update-banner"
      role="status"
    >
      <span class="update-banner-icon">⬆</span>
      <span
        class="update-banner-text"
        :class="{ 'update-banner-error-text': store.updateDownloadError }"
      >
        <template v-if="store.updateDownloadError">
          Update failed: {{ store.updateDownloadError }}
        </template>
        <template v-else-if="store.downloadingUpdate">
          Downloading v{{ store.updateLatest }}…
        </template>
        <template v-else>
          v{{ store.updateLatest }} available · current v{{ store.currentVersion }}
        </template>
      </span>
      <div class="update-banner-actions">
        <template v-if="store.downloadingUpdate">
          <span class="update-banner-progress">{{ downloadSummary }}</span>
        </template>
        <template v-else>
          <button type="button" class="update-banner-btn update-now" @click="startUpdateDownload()">
            Update &amp; Restart
          </button>
          <button type="button" class="update-banner-btn" @click="openReleaseNotes()">Release Notes ↗</button>
          <button type="button" class="update-banner-btn" @click="skipUpdateVersion()">Skip this version</button>
          <button type="button" class="update-banner-x" @click="dismissUpdateBanner()">✕</button>
        </template>
      </div>
    </div>
    <div class="shell">
      <SideBar :style="panelStyle('sidebar')" />
      <div
        class="col-handle"
        :title="t('app.dragHandle')"
        @mousedown="startDrag('sidebar', $event)"
        @dblclick="togglePanel('sidebar')"
      >
        <button
          type="button"
          class="edge-toggle left-edge"
          :title="panels.sidebar.collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')"
          :aria-label="panels.sidebar.collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')"
          @mousedown.stop
          @click.stop="togglePanel('sidebar')"
          @dblclick.stop
        >{{ panels.sidebar.collapsed ? "›" : "‹" }}</button>
      </div>
      <div class="main-col">
        <nav v-if="mainView !== 'preview'" class="main-tabs" :aria-label="t('files.mainViewLabel')">
          <button
            type="button"
            class="main-tab"
            :class="{ on: mainView === 'canvas' }"
            :aria-pressed="mainView === 'canvas'"
            @click="setMainView('canvas')"
            @dragenter="onTabDragEnter('canvas', $event)"
            @dragover.prevent="onTabDragOver('canvas', $event)"
            @dragleave="onTabDragLeave"
            @drop="onTabDrop"
            >{{ t("files.tabCanvas") }}</button
          >
          <button
            v-if="fileBrowserEnabled && middleBrowserEnabled"
            type="button"
            class="main-tab"
            :class="{ on: mainView === 'files' }"
            :aria-pressed="mainView === 'files'"
            @click="setMainView('files')"
            @dragenter="onTabDragEnter('files', $event)"
            @dragover.prevent="onTabDragOver('files', $event)"
            @dragleave="onTabDragLeave"
            @drop="onTabDrop"
            >{{ t("files.tabFiles") }}</button
          >
        </nav>
        <CanvasTabs v-show="mainView === 'canvas'" class="story-tabs-slot" />
        <SessionCanvas v-show="mainView === 'canvas'" class="main-body" />
        <FileBrowser v-if="mainView === 'files' && fileBrowserEnabled && middleBrowserEnabled" class="main-body" />
        <FilePreview
          v-if="mainView === 'preview'"
          class="main-body"
          :preview="files.preview"
          :reading="false"
          standalone
          @close="closeStandalonePreview"
        />
      </div>
      <div
        class="col-handle"
        :title="t('app.dragHandle')"
        @mousedown="startDrag('context', $event)"
        @dblclick="togglePanel('context')"
      >
        <button
          type="button"
          class="edge-toggle right-edge"
          :title="panels.context.collapsed ? t('app.expandContext') : t('app.collapseContext')"
          :aria-label="panels.context.collapsed ? t('app.expandContext') : t('app.collapseContext')"
          @mousedown.stop
          @click.stop="togglePanel('context')"
          @dblclick.stop
        >{{ panels.context.collapsed ? "‹" : "›" }}</button>
      </div>
      <BranchContext :style="panelStyle('context')" />
    </div>
    <CommandPalette />
    <ForkTagDialog />
    <CompressDialog />
    <DigestDialog />
    <WelcomeDialog />
    <HistoryPanel />
    <FileMenu />
    <SettingsPage />
    <AttachmentPreview />
    <div
      v-if="store.actionError"
      class="toast banner-error"
      role="alert"
      @click="dismissActionError"
    >
      {{ store.actionError }}{{ t("app.clickToClose") }}
    </div>
    <div v-if="store.deletedToast" class="toast banner-undo" role="status" aria-live="polite">
      <span class="undo-text">{{ t("app.sessionDeleted", { title: store.deletedToast.title }) }}</span>
      <button
        type="button"
        class="undo-btn"
        :title="t('app.undoDeleteSession')"
        @click="undoTo(store.deletedToast.entryId)"
      >{{ t("app.undo") }}</button>
    </div>
    <div v-if="store.tagDeletedToast" class="toast banner-undo tag-undo" role="status" aria-live="polite">
      <span class="undo-text">{{ t("app.tagDeleted", { tag: store.tagDeletedToast.tag }) }}</span>
      <button
        type="button"
        class="undo-btn"
        :title="t('app.undoTagDelete')"
        @click="undoTo(store.tagDeletedToast.entryId)"
      >{{ t("app.undo") }}</button>
    </div>
    <div v-if="store.updateToast" class="toast banner-update" role="status" aria-live="polite">
      {{ store.updateToast }}
    </div>
    <div v-if="store.compressedToast" class="toast banner-update" role="status" aria-live="polite">
      {{ store.compressedToast }}
    </div>
    <div v-if="store.infoToast" class="toast banner-update" role="status" aria-live="polite">
      {{ store.infoToast }}
    </div>
    <div v-if="historyStore.toast" class="toast banner-update" role="status" aria-live="polite">
      {{ historyStore.toast }}
    </div>
    <!-- The files notice is flashed from the canvas drop handler as often as
         from the browser, so it lives here rather than inside the panel —
         a notice nobody can see is not a notice. -->
    <div v-if="files.notice" class="toast banner-files" role="status" aria-live="polite">
      {{ files.notice }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import AttachmentPreview from "./components/attachment-preview.vue";
import BranchContext from "./components/branch-context.vue";
import CanvasTabs from "./components/canvas-tabs.vue";
import CommandPalette from "./components/command-palette.vue";
import CompressDialog from "./components/compress-dialog.vue";
import DigestDialog from "./components/digest-dialog.vue";
import FileBrowser from "./components/file-browser.vue";
import FileMenu from "./components/file-menu.vue";
import FilePreview from "./components/file-preview.vue";
import ForkTagDialog from "./components/fork-tag-dialog.vue";
import HistoryPanel from "./components/history-panel.vue";
import SessionCanvas from "./components/session-canvas.vue";
import SettingsPage from "./components/settings-page.vue";
import SideBar from "./components/side-bar.vue";
import TopBar from "./components/top-bar.vue";
import WelcomeDialog from "./components/welcome-dialog.vue";
import { clearPreview, files, isPathDrag, stepPreview } from "./files";
import {
  history as historyStore,
  redoSteps,
  togglePanel as toggleHistoryPanel,
  undoSteps,
  undoTo,
} from "./history";
import { t } from "./i18n";
import {
  fileBrowserEnabled,
  leavePreviewView,
  type MainView,
  mainView,
  middleBrowserEnabled,
  PANEL_LIMITS,
  panelStyle,
  panels,
  persistLayout,
  setMainView,
  togglePanel,
  toggleSettings,
} from "./layout";
import {
  dismissActionError,
  dismissUpdateBanner,
  init,
  openReleaseNotes,
  refreshBackendListIfStale,
  skipUpdateVersion,
  startUpdateDownload,
  store,
} from "./state";

/** "12.3 / 28.5 MB" while a total is known, else "12.3 MB" so far. */
const downloadSummary = computed(() => {
  const progress = store.updateDownloadProgress;
  if (!progress) return "";
  const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)}`;
  return progress.total
    ? `${mb(progress.downloaded)} / ${mb(progress.total)} MB`
    : `${mb(progress.downloaded)} MB`;
});

/**
 * ✕ (and Esc) on the standalone preview: drop the preview and return to
 * the canvas. Clearing both holders is deliberate — with the browser
 * folded away there is one preview to speak of.
 */
function closeStandalonePreview(): void {
  clearPreview();
  leavePreviewView();
}

onMounted(() => {
  void init();
  window.addEventListener("keydown", onKeydown);
  // A drag that ends anywhere (a cancel, a drop outside) must not leave a
  // pending tab switch armed.
  window.addEventListener("dragend", cancelTabHover);
  // Coming back from a terminal where a CLI was just installed: the
  // switcher's rows re-probe (throttled) instead of waiting for a restart.
  window.addEventListener("focus", onWindowFocus);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("dragend", cancelTabHover);
  window.removeEventListener("focus", onWindowFocus);
  cancelTabHover();
  if (activeDrag) {
    window.removeEventListener("mousemove", activeDrag.move);
    window.removeEventListener("mouseup", activeDrag.up);
  }
});

function onWindowFocus(): void {
  void refreshBackendListIfStale();
}

// ── Ctrl/⌘+Z: undo the most recent history entry. While typing, the
// keystroke stays a native text undo. ⌘/Ctrl+Shift+H toggles the history panel.
function onKeydown(event: KeyboardEvent): void {
  // The standalone preview owns Esc and the arrows while it is up: Esc
  // returns to the canvas, ↑/↓ step through the file's siblings. A key
  // typed into a box (a stray focus, not the preview's own surface) is
  // left to that box.
  if (mainView.value === "preview") {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeStandalonePreview();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void stepPreview(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
  }
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  // ⌘, is the platform convention for settings and works from anywhere,
  // including while the panel's own search box has focus.
  if (key === ",") {
    event.preventDefault();
    toggleSettings();
    return;
  }
  if (key === "h" && event.shiftKey) {
    event.preventDefault();
    toggleHistoryPanel();
    return;
  }
  if (key !== "z" || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  void (event.shiftKey ? redoSteps(1) : undoSteps(1));
}

// ── panel drag handles ───────────────────────────────────────────────

// The in-flight drag's window listeners; only one drag can be live at a time,
// and an unmount mid-drag must drop them instead of leaking the closures.
let activeDrag: { move: (event: MouseEvent) => void; up: () => void } | null = null;

/**
 * Dragging a file over a middle-column tab switches to that view after a
 * beat, so a file dragged out of the file panel can reach a canvas draft
 * without dropping it first. Plain drags (text, links) never trigger this.
 */
const TAB_HOVER_MS = 650;
let tabHoverTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTabHover(): void {
  if (tabHoverTimer === null) return;
  clearTimeout(tabHoverTimer);
  tabHoverTimer = null;
}

function onTabDragEnter(view: MainView, event: DragEvent): void {
  if (!isPathDrag(event)) return;
  cancelTabHover();
  tabHoverTimer = setTimeout(() => {
    tabHoverTimer = null;
    setMainView(view);
  }, TAB_HOVER_MS);
}

function onTabDragOver(view: MainView, event: DragEvent): void {
  if (!isPathDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  // The pointer moved within the tab; restart the beat so the switch only
  // fires for a deliberate hover.
  if (tabHoverTimer === null) {
    tabHoverTimer = setTimeout(() => {
      tabHoverTimer = null;
      setMainView(view);
    }, TAB_HOVER_MS);
  }
}

function onTabDragLeave(): void {
  cancelTabHover();
}

function onTabDrop(event: DragEvent): void {
  // The tab declared itself a drop target in dragover; without this the
  // browser default (open the file) would navigate the renderer away.
  event.preventDefault();
  cancelTabHover();
}

function startDrag(side: "sidebar" | "context", event: MouseEvent): void {
  if (event.button !== 0) return;
  const panel = panels[side];
  panel.collapsed = false;
  const startX = event.clientX;
  // Collapse only hides the panel; width keeps the live value.
  const startWidth = panel.width;
  const growRight = side === "sidebar";
  const { min, max } = PANEL_LIMITS[side];
  const move = (moveEvent: MouseEvent): void => {
    const delta = (moveEvent.clientX - startX) * (growRight ? 1 : -1);
    panel.width = Math.min(max, Math.max(min, startWidth + delta));
  };
  const up = (): void => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    activeDrag = null;
    persistLayout();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  activeDrag = { move, up };
}
</script>
