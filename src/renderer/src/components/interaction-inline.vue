<template>
  <section v-if="request" class="inline-interaction" role="group" aria-live="polite">
    <p class="inline-interaction-kicker">⏸ 等待你的确认 · {{ request.permission }}</p>
    <pre v-if="request.command" class="inline-interaction-command">{{ request.command }}</pre>
    <p class="inline-interaction-meta">匹配规则：{{ ruleLabel }}</p>
    <div class="inline-interaction-actions">
      <button type="button" class="interaction-deny" @click="deny">拒绝</button>
      <button type="button" class="interaction-allow" @click="allow">允许本次</button>
      <button type="button" class="interaction-always" @click="allowAlways">
        {{ alwaysButtonLabel }}
      </button>
    </div>
    <p v-if="queueDepth > 0" class="inline-interaction-queue">
      同会话还有 {{ queueDepth }} 个待确认
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, type DeepReadonly } from "vue";
import type { AgentInteractionRequest } from "../../../shared/types";
import { pickInlineInteraction, respondInteraction, store } from "../state";

/** The opencode-permission variant, as components read it out of the store. */
type PermissionAsk = DeepReadonly<
  Extract<AgentInteractionRequest, { kind: "opencode-permission" }>
>;

/**
 * The opencode permission ask for the session on screen, rendered at the tail
 * of the message flow instead of as a modal. It reads the same queue the modal
 * does through the shared dispatch split, so the two never both show the same
 * request. Deliberately registers no global key handler — the modal's own
 * listener owns Esc/Enter while it is up, and a second one here would fight it.
 */
const request = computed<PermissionAsk | null>(() => {
  const picked = pickInlineInteraction(store.activeBackend, store.interactions, store.selectedId);
  return picked?.kind === "opencode-permission" ? (picked as PermissionAsk) : null;
});

/** The rule "always" would save — patterns when present, else the permission class. */
const ruleLabel = computed(() =>
  request.value && request.value.patterns.length > 0
    ? request.value.patterns.join("、")
    : (request.value?.permission ?? ""),
);
const alwaysButtonLabel = computed(() =>
  ruleLabel.value ? `总是允许 ${ruleLabel.value}` : "总是允许",
);

/** Other inline asks for this same session still waiting behind this one. */
const queueDepth = computed(() => {
  const selectedId = store.selectedId;
  if (!selectedId) return 0;
  const inline = (store.interactions[store.activeBackend] ?? []).filter(
    (item) => item.kind === "opencode-permission" && item.sessionId === selectedId,
  );
  return Math.max(0, inline.length - 1);
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
</script>
