<template>
  <div v-if="request" class="interaction-backdrop" role="presentation">
    <section
      class="interaction-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t(request.title)"
      tabindex="-1"
      ref="dialogRoot"
    >
      <p class="interaction-kicker">{{ t("interaction.waitingDecision", { backend: backendLabel }) }}</p>
      <h2>{{ t(request.title) }}</h2>
      <p v-if="request.detail" class="interaction-detail">{{ t(request.detail, request.vars) }}</p>

      <template v-if="request.kind === 'command-approval'">
        <pre class="interaction-command">{{ request.command }}</pre>
        <p v-if="request.cwd" class="interaction-meta">{{ t("interaction.workingDir", { cwd: request.cwd }) }}</p>
      </template>
      <template v-else-if="request.kind === 'file-approval'">
        <p v-if="request.grantRoot" class="interaction-meta">{{ t("interaction.requestWrite", { root: request.grantRoot }) }}</p>
      </template>
      <template v-else-if="request.kind === 'permission-approval'">
        <ul class="interaction-list"><li v-for="item in request.requested" :key="item">{{ item }}</li></ul>
      </template>
      <template v-else-if="request.kind === 'mcp-elicitation'">
        <p class="interaction-meta">{{ t("interaction.server", { name: request.serverName }) }}</p>
      </template>
      <template v-else-if="request.kind === 'opencode-permission'">
        <pre v-if="request.command" class="interaction-command">{{ request.command }}</pre>
        <p class="interaction-meta">
          {{ t("interaction.matchedRule", { rule: ruleLabel }) }}
        </p>
      </template>
      <template v-else-if="request.kind === 'user-input'">
        <label v-for="question in request.questions" :key="question.id" class="interaction-question">
          <b>{{ question.header }}</b>
          <span>{{ question.question }}</span>
          <select v-if="question.options?.length" v-model="answers[question.id]">
            <option disabled value="">{{ t("interaction.selectPlaceholder") }}</option>
            <option v-for="option in question.options" :key="option.label" :value="option.label">{{ option.label }}</option>
          </select>
          <input v-else v-model="answers[question.id]" :type="question.isSecret ? 'password' : 'text'" />
        </label>
      </template>
      <template v-else-if="request.kind === 'opencode-form'">
        <InteractionForm ref="formRef" :fields="request.fields" />
      </template>

      <div class="interaction-actions">
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
      <p v-if="queueDepth > 0" class="interaction-queue">{{ t("interaction.queueDepth", { n: queueDepth }) }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, type DeepReadonly, onUnmounted, reactive, ref, watch } from "vue";
import { BACKEND_LABELS } from "../../../shared/backend";
import type { AgentInteractionRequest } from "../../../shared/types";
import { listSep, t } from "../i18n";
import {
  INTERACTION_TIMEOUT_MS,
  inlineHostVisible,
  pickModalInteraction,
  respondInteraction,
  store,
} from "../state";
// A value import, not `import type`: the template renders this component, and
// a type-only import erases the runtime binding (the dialog then emits an
// unresolved <interactionform> element with no fields).
// biome-ignore lint/style/useImportType: rendered in the template below
import InteractionForm from "./interaction-form.vue";

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
/** The form component, whose `collect` validates + builds the answer map. */
const formRef = ref<InstanceType<typeof InteractionForm> | null>(null);

const backendLabel = computed(() => BACKEND_LABELS[store.activeBackend]);
const queueDepth = computed(() =>
  Math.max(0, (store.interactions[store.activeBackend]?.length ?? 0) - 1),
);
/** The rule "always" would save — shown on the button so it is never misclicked. */
const alwaysLabel = computed(() =>
  request.value?.kind === "opencode-permission" && request.value.patterns.length > 0
    ? request.value.patterns.join(listSep.value)
    : null,
);
const alwaysButtonLabel = computed(() =>
  alwaysLabel.value
    ? t("interaction.allowAlwaysWith", { rule: alwaysLabel.value })
    : t("interaction.allowAlways"),
);
/** The matched rule in the meta line: patterns when present, else the permission class. */
const ruleLabel = computed(() =>
  request.value?.kind === "opencode-permission"
    ? request.value.patterns.length > 0
      ? request.value.patterns.join(listSep.value)
      : request.value.permission
    : "",
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
// opencode asks carry none, and the modal would otherwise read "0s".
const hasDeadline = computed(() => {
  if (!request.value) return false;
  return (
    store.interactionDeadlines[`${store.activeBackend}:${request.value.requestId}`] !== undefined
  );
});

function deny(): void {
  // An abandoned form is cancelled (opencode has no deny for forms); every
  // other ask denies.
  if (request.value?.kind === "opencode-form") {
    respondInteraction(request.value, { decision: "cancel" });
    return;
  }
  if (request.value) respondInteraction(request.value, { decision: "deny" });
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
  // A form is multi-field: Enter in one input must not fire the whole form
  // (that would submit unfilled required fields). The user submits explicitly.
  else if (request.value.kind !== "opencode-form") allow();
}

window.addEventListener("keydown", onKeydown);
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>
