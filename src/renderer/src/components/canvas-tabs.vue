<template>
  <div v-if="visible" class="story-tabs" role="tablist" :aria-label="t('canvas.tabsLabel')">
    <button
      v-for="tab in store.canvasTabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="story-tab"
      :class="{ on: tab.id === store.activeCanvasTabId }"
      :aria-selected="tab.id === store.activeCanvasTabId"
      :title="titleOf(tab)"
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
  store,
  tabRootSession,
} from "../state";

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

async function activate(id: string): Promise<void> {
  await activateCanvasTab(id);
}

async function close(id: string): Promise<void> {
  await closeCanvasTab(id);
}

async function newSession(): Promise<void> {
  await createSession();
}

/** Middle-click closes, like a browser tab. */
function onAuxClick(id: string, event: MouseEvent): void {
  if (event.button === 1) void closeCanvasTab(id);
}
</script>
