<template>
  <div v-if="visible" class="story-tabs" role="tablist" :aria-label="t('canvas.tabsLabel')">
    <button
      v-for="tab in store.canvasTabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="story-tab"
      :class="tabClass(tab)"
      :aria-selected="tab.id === store.activeCanvasTabId"
      :title="titleOf(tab)"
      draggable="true"
      @dragstart="tabDrag.onDragStart(tab.id, $event)"
      @dragover="tabDrag.onDragOver(tab.id, $event)"
      @dragleave="tabDrag.onDragLeave(tab.id, $event)"
      @drop="tabDrag.onDrop(tab.id, $event)"
      @dragend="tabDrag.onDragEnd()"
      @click="activate(tab.id)"
      @auxclick="onAuxClick(tab.id, $event)"
    >
      <span class="story-tab-title">{{ titleOf(tab) }}</span>
      <span
        class="story-tab-x"
        role="button"
        :aria-label="t('canvas.tabClose')"
        :title="t('canvas.tabClose')"
        @click.stop="close(tab.id)"
        >×</span
      >
    </button>
    <button
      type="button"
      class="story-tab story-tab-new"
      :title="t('canvas.tabNewSession')"
      :aria-label="t('canvas.tabNewSession')"
      @click="newSession()"
      >＋</button
    >
    <button
      v-if="digestEnabled"
      type="button"
      class="story-tab story-tab-digest"
      :title="t('canvas.digestEntry')"
      :aria-label="t('canvas.digestEntry')"
      @click="openDigest()"
      >✦</button
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n";
import {
  activateCanvasTab,
  type CanvasTab,
  closeCanvasTab,
  createSession,
  digestEnabled,
  reorderCanvasTab,
  setDigestDialogOpen,
  store,
  tabRootSession,
} from "../state";
import { createTabDrag } from "../tab-drag";

/**
 * Browser-style story tabs over the canvas: one tab per fork-tree story. The
 * bar stays hidden while there is exactly one blank tab (a fresh install
 * looks unchanged) and appears as soon as a second story — or any story at
 * all — is open. ＋ starts a new session in the open project — the same
 * createSession path the sidebar's per-directory new session uses.
 */
const visible = computed(() => {
  const tabs = store.canvasTabs;
  if (tabs.length > 1) return true;
  const only = tabs[0];
  return Boolean(only && (only.rootId || only.selectedId));
});

function titleOf(tab: CanvasTab): string {
  return tabRootSession(tab)?.title || t("canvas.tabBlank");
}

/** Drag-to-reorder: the strip order is the tab order, nothing else moves. */
const tabDrag = createTabDrag(() => store.canvasTabs.map((tab) => tab.id), reorderCanvasTab);

/** Active / dragged / drop-marker classes for one tab. */
function tabClass(tab: CanvasTab): Record<string, boolean> {
  const marker = tabDrag.marker.value;
  return {
    on: tab.id === store.activeCanvasTabId,
    dragging: tabDrag.draggingId.value === tab.id,
    "drop-before": marker?.id === tab.id && marker.side === "before",
    "drop-after": marker?.id === tab.id && marker.side === "after",
  };
}

async function activate(id: string): Promise<void> {
  await activateCanvasTab(id);
}

async function close(id: string): Promise<void> {
  await closeCanvasTab(id);
}

async function newSession(): Promise<void> {
  await createSession();
}

/** The after-the-fact digest entry: pick the open stories, summarize them. */
function openDigest(): void {
  setDigestDialogOpen(true);
}

/** Middle-click closes, like a browser tab. */
function onAuxClick(id: string, event: MouseEvent): void {
  if (event.button === 1) void closeCanvasTab(id);
}
</script>
