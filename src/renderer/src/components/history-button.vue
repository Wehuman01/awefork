<template>
  <button
    type="button"
    class="icon-btn history-btn"
    :class="{ 'history-btn-open': history.panelOpen }"
    :title="t('histpanel.buttonTitle')"
    :aria-label="t('histpanel.title')"
    @click="togglePanel()"
  >
    <span class="history-btn-icon">⟲</span>
    <span class="history-btn-text">{{ t("histpanel.buttonText") }}</span>
    <span v-if="depth > 0" class="history-btn-count">{{ depth > 99 ? "99+" : depth }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { history, togglePanel, undoDepth } from "../history";
import { t } from "../i18n";

const depth = computed(() => undoDepth());
</script>
