<template>
  <div v-if="request" class="interaction-backdrop" role="presentation">
    <section
      class="interaction-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="request.title"
      tabindex="-1"
      ref="dialogRoot"
    >
      <p class="interaction-kicker">{{ backendLabel }} 正在等待你的决定</p>
      <h2>{{ request.title }}</h2>
      <p v-if="request.detail" class="interaction-detail">{{ request.detail }}</p>

      <template v-if="request.kind === 'command-approval'">
        <pre class="interaction-command">{{ request.command }}</pre>
        <p v-if="request.cwd" class="interaction-meta">运行目录：{{ request.cwd }}</p>
      </template>
      <template v-else-if="request.kind === 'file-approval'">
        <p v-if="request.grantRoot" class="interaction-meta">请求写入：{{ request.grantRoot }}</p>
      </template>
      <template v-else-if="request.kind === 'permission-approval'">
        <ul class="interaction-list"><li v-for="item in request.requested" :key="item">{{ item }}</li></ul>
      </template>
      <template v-else-if="request.kind === 'mcp-elicitation'">
        <p class="interaction-meta">服务：{{ request.serverName }}</p>
      </template>
      <template v-else-if="request.kind === 'opencode-permission'">
        <pre v-if="request.command" class="interaction-command">{{ request.command }}</pre>
        <p class="interaction-meta">
          匹配规则：{{ request.patterns.length > 0 ? request.patterns.join("、") : request.permission }}
        </p>
      </template>
      <template v-else-if="request.kind === 'user-input'">
        <label v-for="question in request.questions" :key="question.id" class="interaction-question">
          <b>{{ question.header }}</b>
          <span>{{ question.question }}</span>
          <select v-if="question.options?.length" v-model="answers[question.id]">
            <option disabled value="">请选择</option>
            <option v-for="option in question.options" :key="option.label" :value="option.label">{{ option.label }}</option>
          </select>
          <input v-else v-model="answers[question.id]" :type="question.isSecret ? 'password' : 'text'" />
        </label>
      </template>

      <div class="interaction-actions">
        <button type="button" class="interaction-deny" @click="deny">拒绝</button>
        <button v-if="request.kind === 'user-input'" type="button" class="interaction-allow" @click="submitAnswers">提交</button>
        <button v-else type="button" class="interaction-allow" @click="allow">允许本次</button>
        <button
          v-if="request.kind === 'opencode-permission'"
          type="button"
          class="interaction-always"
          @click="allowAlways"
        >{{ alwaysButtonLabel }}</button>
      </div>
      <p v-if="hasDeadline" class="interaction-timeout">{{ secondsLeft }} 秒内未响应将自动拒绝</p>
      <p v-if="queueDepth > 0" class="interaction-queue">还有 {{ queueDepth }} 个待确认</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, type DeepReadonly, onUnmounted, reactive, ref, watch } from "vue";
import { BACKEND_LABELS } from "../../../shared/backend";
import type { AgentInteractionRequest } from "../../../shared/types";
import {
  INTERACTION_TIMEOUT_MS,
  inlineHostVisible,
  pickModalInteraction,
  respondInteraction,
  store,
} from "../state";

// The modal owns every ask the pane cannot show inline — including opencode
// asks that would be inline while the pane is off screen (compare mode, no
// visible session selected), so a pending ask never renders nowhere.
const request = computed<DeepReadonly<AgentInteractionRequest> | null>(() =>
  pickModalInteraction(
    store.activeBackend,
    store.interactions,
    store.selectedId,
    inlineHostVisible.value,
  ),
);
const answers = reactive<Record<string, string>>({});
/** Dialog root, focused on open so keyboard shortcuts need no pre-click. */
const dialogRoot = ref<HTMLElement | null>(null);

const backendLabel = computed(() => BACKEND_LABELS[store.activeBackend]);
const queueDepth = computed(() =>
  Math.max(0, (store.interactions[store.activeBackend]?.length ?? 0) - 1),
);
/** The rule "always" would save — shown on the button so it is never misclicked. */
const alwaysLabel = computed(() =>
  request.value?.kind === "opencode-permission" && request.value.patterns.length > 0
    ? request.value.patterns.join("、")
    : null,
);
const alwaysButtonLabel = computed(() =>
  alwaysLabel.value ? `总是允许 ${alwaysLabel.value}` : "总是允许",
);

// Ticks only while a dialog is up, so the auto-deny countdown reads live.
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

watch(
  request,
  (value) => {
    for (const key of Object.keys(answers)) delete answers[key];
    for (const question of value?.kind === "user-input" ? value.questions : []) {
      answers[question.id] = "";
    }
    stopTicker();
    if (value) {
      ticker = setInterval(() => (now.value = Date.now()), 1000);
      dialogRoot.value?.focus();
    }
  },
  { immediate: true },
);

onUnmounted(stopTicker);

const secondsLeft = computed(() => {
  if (!request.value) return INTERACTION_TIMEOUT_MS / 1000;
  const deadline = store.interactionDeadlines[`${store.activeBackend}:${request.value.requestId}`];
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now.value) / 1000));
});

// Only requests with an auto-deny timer show the countdown; the inline-only
// opencode asks carry none, and the modal would otherwise read "0 秒".
const hasDeadline = computed(() => {
  if (!request.value) return false;
  return (
    store.interactionDeadlines[`${store.activeBackend}:${request.value.requestId}`] !== undefined
  );
});

function deny(): void {
  if (request.value) respondInteraction(request.value, { decision: "deny" });
}

function allow(): void {
  if (request.value) respondInteraction(request.value, { decision: "allow" });
}

function allowAlways(): void {
  if (request.value) respondInteraction(request.value, { decision: "always" });
}

function submitAnswers(): void {
  if (request.value?.kind !== "user-input") return;
  respondInteraction(request.value, { decision: "answers", answers: { ...answers } });
}

// Keyboard: Esc denies, Enter takes the primary action, Shift+Enter saves the
// rule. Window-level while the modal is up — nothing else reads these keys.
function onKeydown(event: KeyboardEvent): void {
  if (!request.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    deny();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (event.shiftKey && request.value.kind === "opencode-permission") {
    allowAlways();
    return;
  }
  if (request.value.kind === "user-input") submitAnswers();
  else allow();
}

window.addEventListener("keydown", onKeydown);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>
