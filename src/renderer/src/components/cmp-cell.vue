<template>
  <div
    class="cell"
    :class="[side, { blank: !cell, open: cell && open }]"
    @click="cell && emit('toggle')"
  >
    <template v-if="cell">
      <div class="cell-top">
        <span v-if="cell.badge !== null" class="cell-idx">{{ cell.badge }}</span>
        <span class="cell-title" :title="cell.title">{{ cell.title }}</span>
      </div>
      <div class="cell-chips">
        <span v-if="cell.flag" class="cell-up" :title="flagTitle">
          ⎇ {{ cell.flag === "up" ? "上游" : "继承" }}</span
        >
        <span
          v-if="cell.modelIds.length > 0"
          class="cell-chip model"
          :title="cell.modelIds.join('\n')"
        >{{ cell.modelIds[0] }}<template v-if="cell.modelIds.length > 1">
          +{{ cell.modelIds.length - 1 }}</template></span>
        <span v-if="cell.durationMs !== null" class="cell-chip">⏱ {{ formatDuration(cell.durationMs) }}</span>
        <span v-if="cell.outputTokens > 0" class="cell-chip">{{ formatTokens(cell.outputTokens) }}</span>
        <span v-if="cell.toolNames.length > 0" class="cell-chip">🔧 {{ cell.toolNames.length }}</span>
        <span v-if="cell.error" class="cell-chip err" :title="cell.error">⚠ 失败</span>
      </div>
      <p class="cell-preview" :class="{ errored: !cell.preview && cell.error }">{{ previewOf(cell) }}</p>
    </template>
    <p v-else class="cell-blank">{{ side === "left" ? "左栏已到尾" : "右栏已到尾" }}</p>
  </div>
</template>

<script lang="ts">
/**
 * One turn card in a comparison column, normalized so the aligned mode
 * (graph TurnNodes) and the free side-by-side mode (message-built Turns)
 * render through exactly the same template.
 */
export interface DisplayCell {
  /** Stable key — `${sessionId}:${messageId}` in both modes. */
  id: string;
  title: string;
  preview: string;
  toolNames: string[];
  modelIds: string[];
  durationMs: number | null;
  outputTokens: number;
  error: string | null;
  /** 1-based index badge among the column's own turns; null = no badge. */
  badge: number | null;
  /** "up" = an upstream branch's turn on the way to this one; "inherited" = copied 母本 prefix. */
  flag: "up" | "inherited" | null;
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { formatDuration, formatTokens } from "../format";

const props = defineProps<{
  cell: DisplayCell | null;
  side: "left" | "right";
  open: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const flagTitle = computed(() =>
  props.cell?.flag === "inherited"
    ? "母本复制来的回合 — 这条分支的起点上下文"
    : "上游分支的回合 — 通往这条分支的路上经过的岔路",
);

function previewOf(cell: DisplayCell): string {
  return (
    cell.preview ||
    (cell.error
      ? `⚠ ${cell.error}`
      : cell.toolNames.length > 0
        ? "(工具调用，无文本回复)"
        : "(无文本回复)")
  );
}
</script>
