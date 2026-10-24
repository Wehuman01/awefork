<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { type ParallelGroup, type ParallelTarget, parallelGroupBusy } from "../parallel-groups";
import { pt } from "../parallel-i18n";
import { MarkdownView } from "./markdown-view";

const props = defineProps<{ group: ParallelGroup; summaryModelLabel: string }>();
const emit = defineEmits<{
  open: [sessionId: string];
  compare: [sessionIds: [string, string]];
  summarize: [];
  retry: [targetId: string];
}>();
const selected = ref<string[]>([]);
const doneTargets = computed(() =>
  props.group.targets.filter((target) => target.status === "done"),
);
const busy = computed(() => parallelGroupBusy(props.group));
const sourcesRunning = computed(() =>
  props.group.targets.some(
    (target) => target.status === "preparing" || target.status === "running",
  ),
);
const summaryRunning = computed(() => props.group.summaryStatus === "running");
const stale = computed(
  () =>
    props.group.summaryStatus === "done" &&
    (doneTargets.value.length !== props.group.summarySourceIds.length ||
      doneTargets.value.some((target) => !props.group.summarySourceIds.includes(target.id))),
);
const phase = computed(() => {
  if (summaryRunning.value) return pt("summarizing");
  if (sourcesRunning.value) return pt("running");
  if (
    doneTargets.value.length === 0 &&
    props.group.targets.some((target) => target.status === "failed")
  )
    return pt("failed");
  if (props.group.targets.some((target) => target.status !== "done"))
    return doneTargets.value.length ? pt("partial") : pt("unknown");
  if (props.group.summaryStatus === "done") return pt("summaryReady");
  if (props.group.summaryStatus === "failed") return pt("summaryFailed");
  if (props.group.summaryStatus === "unknown") return pt("unknown");
  return pt("waitingSummary");
});
const summaryHint = computed(() => {
  if (summaryRunning.value) return pt("summaryRunning");
  if (props.group.summaryStatus === "failed") return pt("summaryFailed");
  if (props.group.summaryStatus === "unknown") return pt("summaryUnknown");
  if (props.group.summaryStatus === "done") return pt("noSummaryText");
  if (!sourcesRunning.value && doneTargets.value.length === 0) return pt("noSuccess");
  return pt("waitingHint");
});
const summaryAction = computed(() => {
  if (stale.value) return pt("updateSummary");
  if (props.group.summaryStatus === "failed" || props.group.summaryStatus === "unknown")
    return pt("retrySummary");
  return sourcesRunning.value ? pt("earlySummary") : pt("summarize");
});
const canSummarize = computed(
  () =>
    doneTargets.value.length > 0 &&
    !summaryRunning.value &&
    (!(props.group.summaryStatus === "failed" || props.group.summaryStatus === "unknown") ||
      !busy.value) &&
    (props.group.summaryStatus !== "done" || stale.value),
);

watch(
  () => props.group.id,
  () => {
    selected.value = [];
  },
);
watch(
  () => props.group.targets.map((target) => `${target.id}:${target.status}:${target.sessionId}`),
  () => {
    selected.value = selected.value.filter((id) =>
      props.group.targets.some(
        (target) => target.id === id && target.status === "done" && target.sessionId,
      ),
    );
  },
);

function toggleSelected(targetId: string): void {
  if (selected.value.includes(targetId))
    selected.value = selected.value.filter((id) => id !== targetId);
  else if (selected.value.length < 2) selected.value = [...selected.value, targetId];
}

function compare(): void {
  const sessions = selected.value.map(
    (id) => props.group.targets.find((target) => target.id === id)?.sessionId,
  );
  if (sessions.length === 2 && sessions[0] && sessions[1])
    emit("compare", [sessions[0], sessions[1]]);
}

function excerpt(target: ParallelTarget): string {
  if (!target.text.trim())
    return target.status === "unknown" ? pt("sourceUnknown") : pt("noAnswer");
  return (
    target.text
      .trim()
      .split(/\n/)
      .find((line) => line.trim())
      ?.replace(/^\s*[#>*-]+\s*/, "")
      .slice(0, 180) ?? ""
  );
}
</script>

<template>
  <section class="parallel-results" :aria-label="pt('title')">
    <header class="round-header">
      <div class="round-title"><strong>{{ pt('title') }}</strong><span>{{ pt('completed', { done: doneTargets.length, total: group.targets.length }) }}</span></div>
      <span class="round-phase" role="status">{{ phase }}</span>
    </header>

    <details :key="group.id" class="round-prompt">
      <summary>{{ pt('prompt') }}<span class="prompt-excerpt">{{ group.prompt }}</span></summary>
      <p>{{ group.prompt }}</p>
      <span v-if="group.attachments.length" class="muted">{{ pt('attachments', { n: group.attachments.length }) }} · {{ group.attachments.map((item) => item.filename).join(' · ') }}</span>
    </details>

    <section class="summary-card" :aria-label="pt('summary')" :aria-busy="summaryRunning">
      <div class="summary-heading"><strong>{{ pt('summary') }}</strong><span v-if="summaryRunning" class="running-dot" aria-hidden="true"></span></div>
      <p class="summary-meta">{{ group.summarySourceIds.length ? pt('summaryBy', { model: summaryModelLabel, n: group.summarySourceIds.length }) : pt('pendingBy', { model: summaryModelLabel }) }}</p>
      <p v-if="group.summarySourceIds.length && group.summarySourceIds.length < group.targets.length" class="partial-note">{{ pt('partialSummary') }}</p>
      <MarkdownView v-if="group.summaryText" :source="group.summaryText" />
      <p v-else class="empty-summary" role="status">{{ summaryHint }}</p>
      <p v-if="group.summaryText && (group.summaryStatus === 'failed' || group.summaryStatus === 'unknown')" class="error-note">{{ summaryHint }}</p>
      <p v-if="group.summaryError" class="error-note">{{ group.summaryError }}</p>
      <p v-if="stale" class="update-note">{{ pt('stale') }}</p>
      <div class="summary-actions">
        <button v-if="canSummarize" class="summary-button" type="button" @click="emit('summarize')">{{ summaryAction }}</button>
        <button v-if="group.summarySessionId" class="text-button" type="button" @click="emit('open', group.summarySessionId)">{{ pt('openSummary') }}</button>
      </div>
    </section>

    <section class="sources-section" :aria-label="pt('sources')">
      <div class="sources-heading"><strong>{{ pt('sources') }}</strong><button type="button" class="compare-button" :disabled="selected.length !== 2" @click="compare">{{ pt('compare', { n: selected.length }) }}</button></div>
      <p class="compare-hint">{{ pt('compareHint') }}</p>
      <article v-for="target in group.targets" :key="`${group.id}:${target.id}`" class="source-card">
        <div class="source-header">
          <input type="checkbox" :checked="selected.includes(target.id)" :disabled="target.status !== 'done' || !target.sessionId || (selected.length === 2 && !selected.includes(target.id))" :aria-label="pt('selectCompare', { model: target.label })" @change="toggleSelected(target.id)" />
          <strong class="model-label" :title="target.label">{{ target.label }}</strong>
          <span class="source-status" :class="target.status">{{ pt(target.status) }}</span>
        </div>
        <div class="source-variant">{{ target.model?.variant || pt('defaultVariant') }}</div>
        <details class="source-answer">
          <summary :title="excerpt(target)">{{ excerpt(target) }}</summary>
          <MarkdownView v-if="target.text" :source="target.text" />
          <p v-else class="muted">{{ excerpt(target) }}</p>
        </details>
        <p v-if="target.error" class="error-note">{{ target.error }}</p>
        <div class="source-actions">
          <button v-if="target.sessionId" class="text-button" type="button" @click="emit('open', target.sessionId)">{{ pt('openBranch') }}</button>
          <button v-if="target.status === 'failed' || target.status === 'unknown'" class="text-button" type="button" :disabled="busy" @click="emit('retry', target.id)">{{ pt('retry') }}</button>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.parallel-results { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; color: var(--ink); font-size: 12px; }
.round-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 12px; }
.round-title { display: flex; align-items: center; gap: 10px; }
.round-title strong { font-size: 13px; }
.round-title span, .round-phase, .muted, .summary-meta, .compare-hint, .source-variant { color: var(--ink-soft); font-size: 11px; }
.round-phase { max-width: 100%; }
.round-prompt { margin-bottom: 14px; color: var(--ink-soft); }
.round-prompt > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 11px; }
.round-prompt > summary::before { content: '▸'; }
.round-prompt[open] > summary::before { content: '▾'; }
.prompt-excerpt { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.round-prompt[open] .prompt-excerpt { display: none; }
.round-prompt p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; color: var(--ink); }
.summary-card { padding: 15px; border: 1px solid var(--primary-border); border-radius: 12px; background: var(--panel); }
.summary-heading { display: flex; align-items: center; gap: 8px; color: var(--primary-deep); font-size: 13px; }
.summary-meta { line-height: 1.6; margin: 6px 0 12px; overflow-wrap: anywhere; }
.partial-note, .empty-summary { font-size: 12px; color: var(--ink-soft); line-height: 1.7; }
.partial-note { margin-top: -5px; font-size: 11px; }
.summary-actions, .source-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.summary-actions:not(:empty) { margin-top: 12px; }
.summary-button, .compare-button { border: 1px solid var(--primary-border); border-radius: 7px; background: var(--primary-soft); color: var(--primary-deep); padding: 6px 9px; font-size: 11px; font-weight: 650; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: 0.45; }
button:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.text-button { font-size: 11px; color: var(--primary-deep); padding: 3px 0; background: none; border: 0; }
.text-button:hover:not(:disabled) { text-decoration: underline; }
.error-note { color: var(--danger-deep); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.update-note { color: var(--primary-deep); font-size: 11px; line-height: 1.6; }
.running-dot { width: 6px; height: 6px; background: var(--sky); border-radius: 50%; }
.sources-section { margin-top: 20px; }
.sources-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sources-heading strong { font-size: 12px; }
.compare-hint { line-height: 1.5; margin: 6px 0 10px; }
.source-card { border: 1px solid var(--line); border-radius: 10px; padding: 11px; margin-bottom: 8px; background: var(--card); min-width: 0; }
.source-header { display: flex; align-items: center; gap: 7px; }
.source-header input { accent-color: var(--primary); margin: 0; flex-shrink: 0; }
.model-label { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.source-status { flex-shrink: 0; font-size: 10px; color: var(--ink-soft); }
.source-status.running, .source-status.preparing { color: var(--sky-deep); }
.source-status.done { color: var(--mint-deep); }
.source-status.failed { color: var(--danger-deep); }
.source-variant { margin: 4px 0 8px 20px; }
.source-answer > summary { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; color: var(--ink-soft); line-height: 1.7; }
.source-answer[open] > summary { margin-bottom: 10px; }
.source-actions:not(:empty) { margin-top: 8px; }
:deep(.md) { font-size: 12px; line-height: 1.75; overflow-wrap: anywhere; min-width: 0; }
:deep(.md-h) { font-size: 13px; margin-top: 14px; }
:deep(.md-h:first-child) { margin-top: 0; }
:deep(.md-table-wrap) { max-width: 100%; overflow-x: auto; }
:deep(.code-block) { max-width: 100%; }
</style>
