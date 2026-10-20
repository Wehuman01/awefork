<template>
  <button
    v-if="!open && marks.length > 0"
    type="button"
    class="panel-pill marks"
    :title="t('marks.countTitle', { n: marks.length })"
    @click="open = true"
  >
    {{ t("marks.label") }}
    <span class="marks-count">{{ marks.length }}</span>
  </button>
  <button
    v-else-if="!open"
    type="button"
    class="panel-pill"
    :title="t('marks.listTitle')"
    @click="open = true"
  >
    {{ t("marks.label") }}
  </button>
  <div v-else class="marks-panel">
    <div class="marks-head">
      <span>{{ t("marks.head", { n: marks.length }) }}</span>
      <button type="button" :title="t('marks.collapse')" @click="open = false">✕</button>
    </div>
    <div v-if="marks.length > 0" class="marks-list">
      <button
        v-for="node in marks"
        :key="node.id"
        type="button"
        class="mark-row"
        @click="jump(node)"
      >
        <span class="mark-star" aria-hidden="true">★</span>
        <span class="mark-body">
          <span class="mark-title" :title="node.title">{{ node.title }}</span>
          <span class="mark-preview">{{
            node.preview ||
            (node.error
              ? `⚠ ${node.error}`
              : node.toolNames.length > 0
                ? t("marks.toolCallsOnly", { n: node.toolNames.length })
                : t("marks.noText"))
          }}</span>
          <span class="mark-meta">{{ relTime(node.createdAt) }}</span>
        </span>
      </button>
    </div>
    <p v-else class="marks-empty">{{ t("marks.empty") }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { TurnNode } from "../../../shared/canvas-graph";
import { relTime } from "../format";
import { t } from "../i18n";
import { markedTurnNodes, selectTurn } from "../state";

const emit = defineEmits<{ jump: [node: TurnNode] }>();

const open = ref(false);
const marks = markedTurnNodes;

function jump(node: TurnNode): void {
  void selectTurn(node, { focusCanvas: true });
  emit("jump", node);
}
</script>
