<template>
  <button
    v-if="!open && marks.length > 0"
    type="button"
    class="panel-pill marks"
    :title="`当前画布上 ${marks.length} 条关键对话`"
    @click="open = true"
  >
    ★ 关键节点
    <span class="marks-count">{{ marks.length }}</span>
  </button>
  <button
    v-else-if="!open"
    type="button"
    class="panel-pill"
    title="标记过的关键对话列表"
    @click="open = true"
  >
    ★ 关键节点
  </button>
  <div v-else class="marks-panel">
    <div class="marks-head">
      <span>★ 关键节点 · {{ marks.length }}</span>
      <button type="button" title="收起" @click="open = false">✕</button>
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
                  ? `(${node.toolNames.length} 个工具调用，无文本回复)`
                  : "(无文本回复)")
          }}</span>
          <span class="mark-meta">{{ relTime(node.createdAt) }}</span>
        </span>
      </button>
    </div>
    <p v-else class="marks-empty">还没有标记 — 在卡片或右侧回合上点 ★ 标记关键对话</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { TurnNode } from "../../../shared/canvas-graph";
import { relTime } from "../format";
import { markedTurnNodes, selectTurn } from "../state";

const emit = defineEmits<{ jump: [node: TurnNode] }>();

const open = ref(false);
const marks = markedTurnNodes;

function jump(node: TurnNode): void {
  void selectTurn(node, { focusCanvas: true });
  emit("jump", node);
}
</script>
