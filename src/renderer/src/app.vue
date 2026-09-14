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
        title="拖拽调宽 · 双击折叠/展开"
        @mousedown="startDrag('sidebar', $event)"
        @dblclick="togglePanel('sidebar')"
      ></div>
      <SessionCanvas />
      <div
        class="col-handle"
        title="拖拽调宽 · 双击折叠/展开"
        @mousedown="startDrag('context', $event)"
        @dblclick="togglePanel('context')"
      ></div>
      <BranchContext :style="panelStyle('context')" />
    </div>
    <CommandPalette />
    <InteractionDialog />
    <HistoryPanel />
    <div
      v-if="store.actionError"
      class="toast banner-error"
      role="alert"
      @click="dismissActionError"
    >
      {{ store.actionError }}（点击关闭）
    </div>
    <div v-if="store.deletedToast" class="toast banner-undo" role="status" aria-live="polite">
      <span class="undo-text">已删除「{{ store.deletedToast.title }}」（⌘/Ctrl+Z 或历史面板可撤销）</span>
      <button
        type="button"
        class="undo-btn"
        title="把会话放回来"
        @click="undoTo(store.deletedToast.entryId)"
      >撤销</button>
    </div>
    <div v-if="store.tagDeletedToast" class="toast banner-undo tag-undo" role="status" aria-live="polite">
      <span class="undo-text">已删除标签「{{ store.tagDeletedToast.tag }}」</span>
      <button
        type="button"
        class="undo-btn"
        title="把标签加回所有会话"
        @click="undoTo(store.tagDeletedToast.entryId)"
      >撤销</button>
    </div>
    <div v-if="store.updateToast" class="toast banner-update" role="status" aria-live="polite">
      {{ store.updateToast }}
    </div>
    <div v-if="historyStore.toast" class="toast banner-update" role="status" aria-live="polite">
      {{ historyStore.toast }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import BranchContext from "./components/branch-context.vue";
import CommandPalette from "./components/command-palette.vue";
import HistoryPanel from "./components/history-panel.vue";
import InteractionDialog from "./components/interaction-dialog.vue";
import SessionCanvas from "./components/session-canvas.vue";
import SideBar from "./components/side-bar.vue";
import TopBar from "./components/top-bar.vue";
import {
  history as historyStore,
  redoSteps,
  togglePanel as toggleHistoryPanel,
  undoSteps,
  undoTo,
} from "./history";
import { PANEL_LIMITS, panelStyle, panels, persistLayout, togglePanel } from "./layout";
import {
  dismissActionError,
  dismissUpdateBanner,
  init,
  openReleaseNotes,
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

onMounted(() => {
  void init();
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (activeDrag) {
    window.removeEventListener("mousemove", activeDrag.move);
    window.removeEventListener("mouseup", activeDrag.up);
  }
});

// ── Ctrl/⌘+Z: undo the most recent history entry. While typing, the
// keystroke stays a native text undo. ⌘/Ctrl+Shift+H toggles the history panel.
function onKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
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
