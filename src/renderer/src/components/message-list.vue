<template>
  <section class="message-list" ref="listEl">
    <slot name="context" />
    <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
      <template v-if="message.role === 'user'">
        <div class="message-row user-row">
          <div class="user-body">
            <MarkdownView :source="message.text" user />
            <p v-if="message.attachmentNames.length > 0" class="att-row">
              <span v-for="(name, i) in message.attachmentNames" :key="i" class="att-chip">
                📎 {{ name }}
              </span>
            </p>
          </div>
          <span class="avatar user">🍑</span>
        </div>
      </template>
      <template v-else>
        <div class="message-row">
          <span class="avatar bot">✨</span>
          <div class="message-body">
            <button
              v-if="message.text"
              type="button"
              class="msg-copy"
              :title="copiedId === message.id ? '已复制' : '复制这条回复'"
              @click="copyMessage(message)"
            >{{ copiedId === message.id ? "✓" : "⧉" }}</button>
            <TaskCallCard
              v-for="call in message.taskCalls ?? []"
              :key="call.partId"
              :call="call"
              @open="(call) => emit('openSubagent', call)"
            />
            <p v-if="chipNamesOf(message).length > 0" class="tool-row">
              <span v-for="name in chipNamesOf(message)" :key="name" class="tool-chip lav">{{
                name
              }}</span>
            </p>
            <details v-if="message.thinking" class="thought">
              <summary class="thought-toggle">Thought</summary>
              <div class="thought-body"><MarkdownView :source="message.thinking" /></div>
            </details>
            <MarkdownView v-if="message.text" :source="message.text" />
            <p v-else-if="message.error" class="message-text run-error">
              ⚠ 运行失败：{{ message.error }}
            </p>
            <button
              v-if="message.error"
              type="button"
              class="retry-now"
              title="重跑这个回合（预填原文，可先换模型/档位）"
              @click="emit('retry')"
            >↻ 换模型重跑</button>
          </div>
        </div>
      </template>
    </article>
    <article v-if="running" class="message assistant">
      <div class="message-row">
        <span class="avatar bot">✨</span>
        <div class="message-body">
          <p v-if="toolCalls.length === 0" class="tool-row">
            <span class="tool-chip running">running…</span>
          </p>
          <TaskCallCard
            v-for="row in toolCalls"
            :key="row.call.partId"
            :call="row.call"
            @open="(call) => emit('openSubagent', call)"
          />
          <template v-for="row in liveRows" :key="row.part.partId">
            <details
              v-if="row.part.kind === 'thinking'"
              class="thought streaming-thought"
              :class="{ done: row.part.endedAt !== null }"
              :open="row.part.endedAt === null"
            >
              <summary class="thought-toggle">
                <span v-if="row.part.endedAt === null" class="spinner" aria-hidden="true"></span>
                <span class="thought-title">{{ row.title }}</span>
                <span v-if="row.duration" class="thought-meta">· {{ row.duration }}</span>
              </summary>
              <div class="thought-body">
                <MarkdownView :source="row.part.text" />
                <span v-if="row.part.endedAt === null" class="stream-caret"></span>
              </div>
            </details>
            <template v-else>
              <MarkdownView :source="row.part.text" class="stream" />
              <span v-if="row.caret" class="stream-caret"></span>
            </template>
          </template>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import type { SessionSummary, SubagentCall } from "../../../shared/types";
import { isSamePaneStart, promptAnchorScrollTop, shouldFollowStream } from "../message-list-scroll";
import type { LivePart, LiveToolCall, ReadonlyChatMessage } from "../state";
import { thoughtSummary } from "../thought";
import { MarkdownView } from "./markdown-view";
import TaskCallCard from "./task-call-card.vue";

const props = defineProps<{
  session: SessionSummary | null;
  messages: readonly ReadonlyChatMessage[];
  running: boolean;
  /** The run's live parts in arrival order — each step's thinking and reply interleaved. */
  streamParts: readonly LivePart[];
  /** The run's live Task-tool cards in call order. */
  toolCalls: readonly LiveToolCall[];
  error: string | null;
}>();

/** A failed reply row offers its own retry jump; the host opens the draft. */
const emit = defineEmits<{ retry: []; openSubagent: [call: SubagentCall] }>();

/**
 * Chips keep every tool name except the ones the cards above them already
 * represent — the task entry stays in toolNames for backends without cards.
 */
function chipNamesOf(message: ReadonlyChatMessage): readonly string[] {
  const calls = message.taskCalls;
  if (!calls || calls.length === 0) return message.toolNames;
  const cardTools = new Set(calls.map((call) => call.tool));
  return message.toolNames.filter((name) => !cardTools.has(name));
}

/** Per-part render models: collapse-header summary plus the streaming caret flag. */
const liveRows = computed(() => {
  const parts = props.streamParts;
  const last = parts[parts.length - 1];
  const caretPartId =
    last != null && last.kind === "text" && last.endedAt === null ? last.partId : null;
  return parts.map((part) => ({
    part,
    ...thoughtSummary(part),
    caret: part.partId === caretPartId,
  }));
});

const listEl = ref<HTMLElement | null>(null);

// Follow the stream only while the reader was at the bottom before the DOM
// changes. Once they scroll up to reread, every subsequent frame leaves their
// position alone.
watch(
  () => [props.messages.length, props.streamParts.map((p) => p.text.length).join(",")],
  () => {
    const list = listEl.value;
    if (!list) return;
    const shouldFollow = shouldFollowStream(list.scrollHeight - list.scrollTop - list.clientHeight);
    if (!shouldFollow) return;
    void nextTick(() => {
      const current = listEl.value;
      if (current) current.scrollTo({ top: current.scrollHeight });
    });
  },
);

// Switching a turn or session lands on the turn's opening prompt, so the
// question stays visible even when the reply below it overflows the pane; the
// chain context above scrolls out of view. A server refresh can replace an
// optimistic local prompt with its persisted counterpart; that is still the
// same pane view, so preserve the reader's scroll position.
let hasPreviousPane = false;
let previousSessionId: string | undefined;
let previousFirstMessage: ReadonlyChatMessage | undefined;
watch(
  () => [props.session?.id, props.messages[0]] as const,
  ([sessionId, firstMessage]) => {
    const shouldReset =
      !props.running &&
      (!hasPreviousPane ||
        sessionId !== previousSessionId ||
        !isSamePaneStart(previousFirstMessage, firstMessage));
    hasPreviousPane = true;
    previousSessionId = sessionId;
    previousFirstMessage = firstMessage;
    if (!shouldReset) return;
    void nextTick(() => {
      const list = listEl.value;
      if (!list) return;
      const prompt = list.querySelector<HTMLElement>(".message.user");
      if (!prompt) {
        list.scrollTo({ top: 0 });
        return;
      }
      list.scrollTo({
        top: promptAnchorScrollTop(
          list.getBoundingClientRect().top,
          prompt.getBoundingClientRect().top,
          list.scrollTop,
        ),
      });
    });
  },
);

const copiedId = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyMessage(message: ReadonlyChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.text);
    copiedId.value = message.id;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedId.value = null;
    }, 1500);
  } catch {
    // Clipboard denied — the text is still selectable; nothing to recover to.
  }
}

// The pane can unmount (session cleared) inside the copied-state window; the
// timer must not fire into the dead component.
onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>
