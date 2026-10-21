<template>
  <section v-if="request" class="inline-interaction" role="group" aria-live="polite">
    <!-- ── opencode permission ask: allow / deny / always ── -->
    <template v-if="request.kind === 'opencode-permission'">
      <p class="inline-interaction-kicker">{{ t("interaction.inlineWaitConfirm", { perm: request.permission }) }}</p>
      <pre v-if="request.command" class="inline-interaction-command">{{ request.command }}</pre>
      <p class="inline-interaction-meta">{{ t("interaction.matchedRule", { rule: ruleLabel }) }}</p>
      <div class="inline-interaction-actions">
        <button type="button" class="interaction-deny" @click="deny">{{ t("interaction.deny") }}</button>
        <button type="button" class="interaction-allow" @click="allow">{{ t("interaction.allowOnce") }}</button>
        <button type="button" class="interaction-always" @click="allowAlways">
          {{ alwaysButtonLabel }}
        </button>
      </div>
    </template>

    <!-- ── codex approvals / input: same bodies as the modal, inline ── -->
    <template v-else-if="request.kind !== 'opencode-form'">
      <p class="inline-interaction-kicker">{{ t("interaction.inlineWaitConfirmCodex") }}</p>
      <p class="inline-interaction-title">{{ t(request.title) }}</p>
      <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
      <pre v-if="request.kind === 'command-approval'" class="inline-interaction-command">{{ request.command }}</pre>
      <p v-if="request.kind === 'command-approval' && request.cwd" class="inline-interaction-meta">
        {{ t("interaction.workingDir", { cwd: request.cwd }) }}
      </p>
      <p v-if="request.kind === 'file-approval' && request.grantRoot" class="inline-interaction-meta">
        {{ t("interaction.requestWrite", { root: request.grantRoot }) }}
      </p>
      <ul v-if="request.kind === 'permission-approval'" class="interaction-list">
        <li v-for="item in request.requested" :key="item">{{ item }}</li>
      </ul>
      <p v-if="request.kind === 'mcp-elicitation'" class="inline-interaction-meta">
        {{ t("interaction.server", { name: request.serverName }) }}
      </p>
      <label
        v-if="request.kind === 'user-input'"
        v-for="question in request.questions"
        :key="question.id"
        class="interaction-question"
      >
        <b>{{ question.header }}</b>
        <span>{{ question.question }}</span>
        <select v-if="question.options?.length" v-model="answers[question.id]">
          <option disabled value="">{{ t("interaction.selectPlaceholder") }}</option>
          <option v-for="option in question.options" :key="option.label" :value="option.label">{{ option.label }}</option>
        </select>
        <input v-else v-model="answers[question.id]" :type="question.isSecret ? 'password' : 'text'" />
      </label>
      <div class="inline-interaction-actions">
        <button type="button" class="interaction-deny" @click="deny">{{ t("interaction.deny") }}</button>
        <button
          v-if="request.kind === 'user-input'"
          type="button"
          class="interaction-allow"
          @click="submitAnswers"
        >{{ t("interaction.submit") }}</button>
        <button v-else type="button" class="interaction-allow" @click="allow">{{ t("interaction.allowOnce") }}</button>
      </div>
    </template>

    <!-- ── form ask: fill the fields right here in the context pane ── -->
    <template v-else>
      <p class="inline-interaction-kicker">{{ t("interaction.inlineWaitInput") }}</p>
      <p class="inline-interaction-title">{{ t(request.title) }}</p>
      <p v-if="request.detail" class="inline-interaction-meta">{{ t(request.detail, request.vars) }}</p>
      <InteractionForm ref="formRef" :fields="request.fields" />
      <div class="inline-interaction-actions">
        <button type="button" class="interaction-deny" @click="cancel">{{ t("interaction.cancel") }}</button>
        <button type="button" class="interaction-allow" @click="submit">{{ t("interaction.submit") }}</button>
      </div>
    </template>

    <p v-if="queueDepth > 0" class="inline-interaction-queue">
      {{ t("interaction.inlineQueueDepth", { n: queueDepth }) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, type DeepReadonly, reactive, ref, watch } from "vue";
import type { AgentInteractionRequest } from "../../../shared/types";
import { listSep, t } from "../i18n";
import {
  countPendingInline,
  inlineHostVisible,
  pickInlineInteraction,
  respondInteraction,
  store,
} from "../state";
// biome-ignore lint/style/useImportType: rendered in the template below
import InteractionForm from "./interaction-form.vue";

/**
 * The queued ask for the session on screen, rendered at the tail of the
 * message flow instead of as a modal — opencode permission/form asks and every
 * codex approval/input kind. It reads the same queue the modal does through
 * the shared dispatch split, so the two never both show the same request.
 * Deliberately registers no global key handler — the modal's own listener owns
 * Esc/Enter while it is up, and a second one here would fight it.
 */
const request = computed<DeepReadonly<AgentInteractionRequest> | null>(() =>
  pickInlineInteraction(
    store.activeBackend,
    store.interactions,
    store.selectedId,
    inlineHostVisible.value,
  ),
);

/** The rule "always" would save — patterns when present, else the permission class. */
const ruleLabel = computed(() =>
  request.value && request.value.kind === "opencode-permission" && request.value.patterns.length > 0
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

/** Other inline asks for this same session still waiting behind this one. */
const queueDepth = computed(() =>
  countPendingInline(
    store.activeBackend,
    store.interactions,
    store.selectedId,
    inlineHostVisible.value,
  ),
);

/** The form component, whose `collect` validates + builds the answer map. */
const formRef = ref<InstanceType<typeof InteractionForm> | null>(null);
/** Free-text/select answers for a codex user-input ask, keyed by question id. */
const answers = reactive<Record<string, string>>({});

// Reset the answer map whenever a different ask takes the card.
watch(request, (value) => {
  for (const key of Object.keys(answers)) delete answers[key];
  for (const question of value?.kind === "user-input" ? value.questions : []) {
    answers[question.id] = "";
  }
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
function cancel(): void {
  // An abandoned form is cancelled (opencode has no deny for forms).
  if (request.value) respondInteraction(request.value, { decision: "cancel" });
}
function submit(): void {
  if (request.value?.kind !== "opencode-form") return;
  // collect() validates and narrows each field's type; null = blocked (the
  // component shows why) so a doomed POST never goes out.
  const collected = formRef.value?.collect();
  if (collected) respondInteraction(request.value, { decision: "answers", answers: collected });
}
function submitAnswers(): void {
  if (request.value?.kind !== "user-input") return;
  respondInteraction(request.value, { decision: "answers", answers: { ...answers } });
}
</script>
