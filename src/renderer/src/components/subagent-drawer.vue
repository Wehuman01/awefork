<template>
  <template v-if="view">
    <div class="subagent-backdrop" @click="closeSubagentSession()"></div>
    <aside class="subagent-drawer" role="dialog" :aria-label="t('task.drawerLabel')">
      <header class="subagent-drawer-head">
        <div class="subagent-drawer-title">
          <span v-if="view.call.agent" class="task-call-agent">{{ view.call.agent }}</span>
          <strong>{{ view.call.title ?? view.call.agent ?? t("task.fallbackTitle") }}</strong>
        </div>
        <button
          type="button"
          class="subagent-drawer-close"
          :title="t('task.drawerClose')"
          @click="closeSubagentSession()"
          >✕</button
        >
      </header>
      <p class="subagent-drawer-meta">
        {{ t("task.drawerMeta") }}
        <template v-if="summary"> · {{ t('task.drawerParent', { title: summary.title }) }}</template>
        <template v-if="view.call.modelId"> · {{ view.call.modelId }}</template>
      </p>
      <div v-if="error" class="banner banner-error">{{ error }}</div>
      <p v-else-if="loading" class="subagent-drawer-loading">{{ t("task.drawerLoading") }}</p>
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
import { t } from "../i18n";
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
    load(next.sessionId);
  },
  { immediate: true },
);

/** Read the child session's transcript; a slow read cannot outlive its view. */
function load(sessionId: string): void {
  window.awefork
    .messages(store.activeBackend, sessionId)
    .then((rows) => {
      if (view.value?.sessionId === sessionId) messages.value = rows;
    })
    .catch((cause: unknown) => {
      if (view.value?.sessionId === sessionId) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    })
    .finally(() => {
      if (view.value?.sessionId === sessionId) loading.value = false;
    });
}

// A subagent still running keeps writing into its own session, so an open
// drawer polls rather than showing a frozen snapshot. The parent's run ending
// settles the card, which closes the drawer — no poll outlives the view.
let poll: ReturnType<typeof setInterval> | null = null;
watch(
  () => (view.value ? store.liveToolCalls.some((row) => row.call.childSessionId === view.value?.sessionId) : false),
  (running) => {
    if (poll !== null) {
      clearInterval(poll);
      poll = null;
    }
    const sessionId = view.value?.sessionId;
    if (running && sessionId) {
      poll = setInterval(() => load(sessionId), 2000);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (poll !== null) clearInterval(poll);
});

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
