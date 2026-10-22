<template>
  <section v-if="request" class="inline-interaction" role="group" aria-live="polite">
    <p class="inline-interaction-kicker">{{ kicker }}</p>

    <template v-if="request.kind === 'opencode-permission'">
      <div class="inline-interaction-body">
        <pre v-if="request.command" class="inline-interaction-command">{{ request.command }}</pre>
        <p class="inline-interaction-meta">{{ t("interaction.matchedRule", { rule: ruleLabel }) }}</p>
      </div>
    </template>

    <template v-else-if="request.kind === 'command-approval'">
      <div class="inline-interaction-body">
        <p class="inline-interaction-title">{{ t(request.title) }}</p>
        <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
        <pre class="inline-interaction-command">{{ request.command }}</pre>
        <p v-if="request.cwd" class="inline-interaction-meta">{{ t("interaction.workingDir", { cwd: request.cwd }) }}</p>
      </div>
    </template>

    <template v-else-if="request.kind === 'file-approval'">
      <div class="inline-interaction-body">
        <p class="inline-interaction-title">{{ t(request.title) }}</p>
        <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
        <p v-if="request.grantRoot" class="inline-interaction-meta">{{ t("interaction.requestWrite", { root: request.grantRoot }) }}</p>
      </div>
    </template>

    <template v-else-if="request.kind === 'permission-approval'">
      <div class="inline-interaction-body">
        <p class="inline-interaction-title">{{ t(request.title) }}</p>
        <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
        <ul class="interaction-list"><li v-for="item in request.requested" :key="item">{{ item }}</li></ul>
      </div>
    </template>

    <template v-else-if="request.kind === 'mcp-elicitation'">
      <div class="inline-interaction-body">
        <p class="inline-interaction-title">{{ t(request.title) }}</p>
        <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
        <p class="inline-interaction-meta">{{ t("interaction.server", { name: request.serverName }) }}</p>
      </div>
    </template>

    <template v-else-if="request.kind === 'user-input'">
      <div class="inline-interaction-body">
        <p class="inline-interaction-title">{{ t(request.title) }}</p>
        <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
        <label v-for="question in request.questions" :key="question.id" class="interaction-question">
          <b>{{ question.header }}</b>
          <span>{{ question.question }}</span>
          <select v-if="question.options?.length" v-model="answers[question.id]">
            <option disabled value="">{{ t("interaction.selectPlaceholder") }}</option>
            <option v-for="option in question.options" :key="option.label" :value="option.label">{{ option.label }}</option>
          </select>
          <input v-else v-model="answers[question.id]" :type="question.isSecret ? 'password' : 'text'" />
        </label>
      </div>
    </template>

    <!-- ── form ask: fill the fields right here in the context pane ── -->
    <template v-else>
      <div class="inline-interaction-body">
        <p class="inline-interaction-title">{{ t(request.title) }}</p>
        <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
        <InteractionForm ref="formRef" :fields="request.fields" />
      </div>
    </template>

    <div class="inline-interaction-actions">
      <button type="button" class="interaction-deny" @click="deny">
        {{ request.kind === "opencode-form" ? t("interaction.cancel") : t("interaction.deny") }}
      </button>
      <button
        v-if="request.kind === 'user-input' || request.kind === 'opencode-form'"
        type="button"
        class="interaction-allow"
        @click="submitAnswers"
      >{{ t("interaction.submit") }}</button>
      <button v-else type="button" class="interaction-allow" @click="allow">{{ t("interaction.allowOnce") }}</button>
      <button
        v-if="request.kind === 'opencode-permission'"
        type="button"
        class="interaction-always"
        @click="allowAlways"
      >{{ alwaysButtonLabel }}</button>
    </div>

    <p v-if="hasDeadline" class="interaction-timeout">{{ t("interaction.autoDeny", { seconds: secondsLeft }) }}</p>
    <p v-if="queueDepth > 0" class="inline-interaction-queue">
      {{ t("interaction.inlineQueueDepth", { n: queueDepth }) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, type DeepReadonly, onUnmounted, reactive, ref, watch } from "vue";
import type { AgentInteractionRequest } from "../../../shared/types";
import { listSep, t } from "../i18n";
import {
  countPendingInline,
  INTERACTION_TIMEOUT_MS,
  inlineHostVisible,
  pickInlineInteraction,
  respondInteraction,
  store,
} from "../state";
// biome-ignore lint/style/useImportType: rendered in the template below
import InteractionForm from "./interaction-form.vue";

/**
 * The queued ask the context pane owns, rendered at the tail of the message
 * flow — every kind, never a global modal. An ask for the session on screen
 * shows here; one parked on another session waits for its own pane; a
 * sessionless ask rides whatever pane is visible. Deliberately registers no
 * global key handler — Enter inside the inputs must behave normally, and the
 * buttons are the explicit actions.
 */
const request = computed<DeepReadonly<AgentInteractionRequest> | null>(() =>
  pickInlineInteraction(
    store.activeBackend,
    store.interactions,
    store.selectedId,
    inlineHostVisible.value,
  ),
);

const kicker = computed(() => {
  const value = request.value;
  if (!value) return "";
  if (value.kind === "opencode-permission")
    return t("interaction.inlineWaitConfirm", { perm: value.permission });
  if (value.kind === "opencode-form") return t("interaction.inlineWaitInput");
  return t("interaction.inlineWaitDecision");
});

const answers = reactive<Record<string, string>>({});
/** The form component, whose `collect` validates + builds the answer map. */
const formRef = ref<InstanceType<typeof InteractionForm> | null>(null);

/** Other asks waiting behind this one for the same pane. */
const queueDepth = computed(() =>
  countPendingInline(
    store.activeBackend,
    store.interactions,
    store.selectedId,
    inlineHostVisible.value,
  ),
);

/** The rule "always" would save — patterns when present, else the permission class. */
const ruleLabel = computed(() =>
  request.value?.kind === "opencode-permission" && request.value.patterns.length > 0
    ? request.value.patterns.join(listSep.value)
    : request.value?.kind === "opencode-permission"
      ? request.value.permission
      : "",
);
const alwaysButtonLabel = computed(() =>
  ruleLabel.value
    ? t("interaction.allowAlwaysWith", { rule: ruleLabel.value })
    : t("interaction.allowAlways"),
);

// Ticks only while an ask with an auto-deny deadline is up (the codex kinds;
// opencode permission and form asks wait indefinitely).
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
    if (
      value &&
      store.interactionDeadlines[`${store.activeBackend}:${value.requestId}`] !== undefined
    ) {
      ticker = setInterval(() => (now.value = Date.now()), 1000);
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

const hasDeadline = computed(() => {
  if (!request.value) return false;
  return (
    store.interactionDeadlines[`${store.activeBackend}:${request.value.requestId}`] !== undefined
  );
});

function deny(): void {
  if (!request.value) return;
  // An abandoned form is cancelled (opencode has no deny for forms); every
  // other ask denies.
  if (request.value.kind === "opencode-form") {
    respondInteraction(request.value, { decision: "cancel" });
    return;
  }
  respondInteraction(request.value, { decision: "deny" });
}

function allow(): void {
  if (request.value) respondInteraction(request.value, { decision: "allow" });
}

function allowAlways(): void {
  if (request.value) respondInteraction(request.value, { decision: "always" });
}

function submitAnswers(): void {
  if (!request.value) return;
  if (request.value.kind === "opencode-form") {
    // collect() validates and narrows each field's type; null = blocked (the
    // component shows why) so a doomed POST never goes out.
    const collected = formRef.value?.collect();
    if (collected) respondInteraction(request.value, { decision: "answers", answers: collected });
    return;
  }
  if (request.value.kind !== "user-input") return;
  respondInteraction(request.value, { decision: "answers", answers: { ...answers } });
}
</script>
