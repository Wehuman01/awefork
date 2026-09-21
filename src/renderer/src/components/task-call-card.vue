<template>
  <div class="task-call" :class="[{ running: isActive, open: expanded }, call.status]">
    <div
      role="button"
      tabindex="0"
      class="task-call-head"
      :title="expanded ? '收起详情' : '展开派发指令与结果'"
      @click="expanded = !expanded"
      @keydown.enter.prevent="expanded = !expanded"
    >
      <span class="task-call-dot" :class="call.status" aria-hidden="true"></span>
      <span v-if="agentLabel" class="task-call-agent">{{ agentLabel }}</span>
      <span class="task-call-title">{{ titleLabel }}</span>
      <span v-if="isActive" class="task-call-meta">
        <span class="spinner" aria-hidden="true"></span>已运行 {{ elapsedLabel }}
      </span>
      <span v-else class="task-call-meta">{{ settledMeta }}</span>
      <button
        v-if="call.childSessionId && !isActive"
        type="button"
        class="task-call-open"
        title="查看这个子代理的会话（只读）"
        @click.stop="emit('open', call)"
        >打开子会话 ↗</button
      >
    </div>
    <div v-if="expanded" class="task-call-body">
      <p v-if="call.prompt" class="task-call-k">派发指令</p>
      <p v-if="call.prompt" class="task-call-prompt">{{ call.prompt }}</p>
      <p v-if="resultLabel" class="task-call-k">{{ call.status === "error" ? "失败原因" : "执行结果" }}</p>
      <p v-if="resultLabel" class="task-call-result" :class="{ danger: call.status === 'error' }">
        {{ resultLabel }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { SubagentCall } from "../../../shared/types";
import { formatDuration } from "../format";

const props = defineProps<{ call: SubagentCall }>();
const emit = defineEmits<{ open: [call: SubagentCall] }>();

/** pending and running both render as in-flight; completed/error settle. */
const isActive = computed(() => props.call.status === "pending" || props.call.status === "running");

const agentLabel = computed(() => props.call.agent);
const titleLabel = computed(
  () =>
    props.call.title ??
    (props.call.prompt ? props.call.prompt.split("\n")[0]?.slice(0, 60) : null) ??
    "子任务",
);
const resultLabel = computed(() => props.call.result?.trim() || null);

const settledMeta = computed(() => {
  const bits: string[] = [];
  if (props.call.startedAt !== null && props.call.endedAt !== null) {
    bits.push(formatDuration(props.call.endedAt - props.call.startedAt));
  }
  if (props.call.status === "error") bits.push("失败");
  if (props.call.modelId) bits.push(props.call.modelId);
  return bits.length > 0 ? bits.join(" · ") : props.call.status;
});

// Elapsed ticks only while the card is live; settled cards read time.end.
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
watch(
  isActive,
  (active) => {
    if (active && ticker === null) {
      ticker = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    } else if (!active && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  if (ticker !== null) clearInterval(ticker);
});

const elapsedLabel = computed(() => {
  const startedAt = props.call.startedAt ?? Date.now();
  return formatDuration(Math.max(0, now.value - startedAt));
});

const expanded = ref(false);
</script>
