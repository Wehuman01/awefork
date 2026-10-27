<template>
  <section class="digest-results" :aria-label="dt('panelTitle')">
    <header class="dg-head">
      <span class="dg-title">✦ {{ dt("panelTitle") }}</span>
      <span v-if="shownVersion > 1" class="dg-version">{{ dt("version", { n: shownVersion }) }}</span>
      <span v-if="historical" class="dg-historical" :title="dt('historical')">{{ dt("historical") }}</span>
    </header>

    <p v-if="group.status === 'running'" class="dg-running">{{ dt("running") }}</p>
    <template v-else-if="group.status === 'failed'">
      <p class="dg-error">{{ group.error ?? dt("failed") }}</p>
      <p class="dg-hint">{{ dt("failed") }}</p>
    </template>
    <p v-else-if="group.status === 'unknown'" class="dg-hint">{{ dt("unknown") }}</p>
    <template v-else>
      <p v-if="!shownText" class="dg-hint">{{ dt("noText") }}</p>
      <MarkdownView v-else class="dg-text" :source="shownText" />
    </template>

    <p v-if="metaLine" class="dg-meta">{{ metaLine }}</p>

    <div v-if="group.sources.length > 0" class="dg-sources">
      <span class="dg-sources-label">{{ dt("sources") }}</span>
      <button
        v-for="source in group.sources"
        :key="source.sessionId"
        type="button"
        class="dg-source"
        :title="dt('openStory')"
        @click="emit('open', source.storyRootId)"
      >
        <span class="dg-source-name">{{ source.title }}</span>
        <span class="dg-source-meta">{{ sourceMeta(source) }}</span>
      </button>
    </div>

    <footer v-if="group.status !== 'running'" class="dg-foot">
      <button type="button" class="dg-again" :disabled="busy" @click="emit('resummarize')">
        {{ dt("resummarize") }}
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DigestGroup, DigestStorySource } from "../../../shared/digest-types";
import { dt } from "../digest-i18n";
import { t } from "../i18n";
import { store } from "../state";
import { MarkdownView } from "./markdown-view";

const props = defineProps<{
  group: DigestGroup;
  /** Session of the summary version in view; null/absent = the newest one. */
  viewingSessionId?: string | null;
}>();

const emit = defineEmits<{
  open: [sessionId: string];
  resummarize: [];
}>();

/**
 * The version the pane was sent to. The group's own text always describes
 * its newest digest, so selecting an older version's session reads that
 * version back from its native rows instead.
 */
const viewedVersion = computed(() => {
  const id = props.viewingSessionId;
  if (!id) return null;
  return props.group.versions.find((version) => version.sessionId === id) ?? null;
});

const historical = computed(
  () =>
    viewedVersion.value !== null && viewedVersion.value.sessionId !== props.group.summarySessionId,
);

const shownVersion = computed(
  () =>
    viewedVersion.value?.version ??
    props.group.versions.at(-1)?.version ??
    props.group.versions.length,
);

const shownText = computed(() => {
  if (!historical.value) return props.group.text;
  // The canvas already loaded every version session's rows to draw its
  // cards; reading them back keeps an older version's text on screen
  // without a fetch.
  const version = viewedVersion.value;
  if (!version) return "";
  const rows = store.messagesBySession[version.sessionId] ?? [];
  const firstUser = rows.find((message) => message.role === "user");
  if (!firstUser) return "";
  const reply = rows
    .filter(
      (message) =>
        message.role === "assistant" &&
        message.createdAt >= firstUser.createdAt &&
        message.completedAt !== null &&
        message.finish !== "tool-calls",
    )
    .at(-1);
  return reply?.text.trim() ?? "";
});

/** Sources as the viewed version recorded them, not as the newest run saw them. */
const shownSources = computed<DigestStorySource[]>(() =>
  historical.value ? (viewedVersion.value?.sources ?? []) : props.group.sources,
);

const busy = computed(() => props.group.status === "running");

const metaLine = computed(() => {
  const model = props.group.settings.model;
  const label = model
    ? (store.models.find(
        (item) => item.providerId === model.providerId && item.modelId === model.modelId,
      )?.modelName ?? model.modelId)
    : t("input.parallelDefaultSummaryModel");
  return dt("by", { model: label, n: shownSources.value.length });
});

function sourceMeta(source: DigestStorySource): string {
  const parts: string[] = [];
  if (source.turnCount === 1) parts.push(dt("sourceScopeTurn"));
  else parts.push(dt("sourceMeta", { turns: source.turnCount, chars: source.chars }));
  if (source.omittedTurns > 0) parts.push(dt("sourceOmitted", { n: source.omittedTurns }));
  return parts.join(" · ");
}
</script>

<style scoped>
.digest-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  color: var(--ink);
  font-size: 12px;
}

.dg-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.dg-title {
  font-size: 12.5px;
  font-weight: 800;
}

.dg-version {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--primary-deep);
  background: var(--primary-soft);
  border-radius: 999px;
  padding: 1px 8px;
}

.dg-historical {
  font-size: 10.5px;
  color: var(--ink-faint);
}

.dg-running {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--primary-deep);
}

.dg-error {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--danger, #b42318);
}

.dg-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--ink-faint);
}

.dg-text {
  font-size: 12.5px;
  line-height: 1.65;
}

.dg-meta {
  margin: 10px 0 0;
  font-size: 10.5px;
  color: var(--ink-faint);
}

.dg-sources {
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dg-sources-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-faint);
}

.dg-source {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: none;
  color: inherit;
  cursor: pointer;
}

.dg-source:hover {
  background: var(--primary-soft);
}

.dg-source-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dg-source-meta {
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--ink-faint);
}

.dg-foot {
  margin-top: 12px;
}

.dg-again {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--ink-faint);
  cursor: pointer;
}

.dg-again:hover:not(:disabled) {
  color: var(--primary);
  border-color: var(--primary-border);
}

.dg-again:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
