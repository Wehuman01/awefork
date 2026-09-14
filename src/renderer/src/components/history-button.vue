<template>
  <button
    type="button"
    class="icon-btn history-btn"
    :class="{ 'history-btn-open': history.panelOpen }"
    title="操作历史（⌘/Ctrl+Shift+H）"
    aria-label="操作历史"
    @click="togglePanel()"
  >
    <span class="history-btn-icon">⟲</span>
    <span class="history-btn-text">历史</span>
    <span v-if="depth > 0" class="history-btn-count">{{ depth > 99 ? "99+" : depth }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { history, togglePanel, undoDepth } from "../history";

const depth = computed(() => undoDepth());
</script>
