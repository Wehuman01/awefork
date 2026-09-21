<template>
  <template v-if="view">
    <div class="subagent-backdrop" @click="closeSubagentSession()"></div>
    <aside class="subagent-drawer" role="dialog" aria-label="子会话（只读）">
      <header class="subagent-drawer-head">
        <div class="subagent-drawer-title">
          <span v-if="view.call.agent" class="task-call-agent">{{ view.call.agent }}</span>
          <strong>{{ view.call.title ?? view.call.agent ?? "子任务" }}</strong>
        </div>
        <button
          type="button"
          class="subagent-drawer-close"
          title="返回父会话（Esc）"
          @click="closeSubagentSession()"
          >✕</button
        >
      </header>
      <p class="subagent-drawer-meta">
        子会话 · 只读
        <template v-if="summary"> · 由「{{ summary.title }}」的 task 工具派生</template>
        <template v-if="view.call.modelId"> · {{ view.call.modelId }}</template>
      </p>
      <div v-if="error" class="banner banner-error">{{ error }}</div>
      <p v-else-if="loading" class="subagent-drawer-loading">载入子会话…</p>
      <MessageList
        v-else
        :session="summary"
        :messages="messages"
        :running="false"
        :stream-parts="[]"
        :tool-calls="[]"
        :error="null"
      />
    </aside>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ChatMessage, SessionSummary } from "../../../shared/types";
import { closeSubagentSession, store } from "../state";
import MessageList from "./message-list.vue";

/**
 * The subagent drill-in: a read-only transcript of the child session the
 * clicked card named. Selection is untouched — closing the drawer lands back
 * on exactly the pane the user left.
 */
const view = computed(() => store.subagentView);
const messages = ref<readonly ChatMessage[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

/** The child session row, when the list refresh has seen it yet. */
const summary = computed<SessionSummary | null>(
  () => store.sessions.find((s) => s.id === view.value?.sessionId) ?? null,
);

watch(
  view,
  (next) => {
    error.value = null;
    if (!next) {
      messages.value = [];
      return;
    }
    loading.value = true;
    messages.value = [];
    window.awefork
      .messages(store.activeBackend, next.sessionId)
      .then((rows) => {
        // A slow load can race a close; only the view still naming this
        // session may publish into the drawer.
        if (view.value?.sessionId === next.sessionId) messages.value = rows;
      })
      .catch((cause: unknown) => {
        if (view.value?.sessionId === next.sessionId) {
          error.value = cause instanceof Error ? cause.message : String(cause);
        }
      })
      .finally(() => {
        if (view.value?.sessionId === next.sessionId) loading.value = false;
      });
  },
  { immediate: true },
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && store.subagentView) closeSubagentSession();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>
