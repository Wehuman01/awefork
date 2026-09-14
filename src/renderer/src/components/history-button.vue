<template>
  <button
    type="button"
    class="history-fab"
    :class="{ 'history-fab-open': history.panelOpen }"
    title="操作历史（⌘/Ctrl+Shift+H）"
    aria-label="操作历史"
    @click="togglePanel()"
  >
    <span class="history-fab-icon">⟲</span>
    <span v-if="depth > 0" class="history-fab-badge">{{ depth > 99 ? "99+" : depth }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { history, togglePanel, undoDepth } from "../history";

const depth = computed(() => undoDepth());
</script>
