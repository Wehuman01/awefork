<template>
  <aside class="context" :class="{ comparing: compare }">
    <!-- ── ⇄ dual-pane comparison: aligned at a fork, or free side-by-side ── -->
    <template v-if="compare">
      <div class="cmp-head">
        <span class="cmp-head-title">{{ compare.plan ? t("branch.compareTitle") : t("branch.freeTitle") }}</span>
        <button
          type="button"
          class="nav-btn"
          :class="{ 'sync-on': allCellsOpen }"
          :title="allCellsOpen ? t('branch.collapseAllTitle') : t('branch.expandAllTitle')"
          :aria-pressed="allCellsOpen"
          @click="toggleAllCells"
        >{{ allCellsOpen ? "⤡" : "⤢" }}</button>
        <button
          type="button"
          class="nav-btn"
          :class="{ 'sync-on': syncScroll }"
          :title="t('branch.syncScrollTitle')"
          @click="syncScroll = !syncScroll"
        >{{ syncScroll ? "⇅" : "↕" }}</button>
        <button
          type="button"
          class="nav-btn"
          :title="t('branch.exitCompare')"
          @click="exitCompare()"
        >✕</button>
      </div>

      <div class="cmp-body">
        <div class="cmp-cols">
          <div
            class="cmp-colcard left"
            :class="{ 'empty-ctx': isEmptyContext(compare.pair.leftId) }"
          >
            <span v-if="store.selectedId === compare.pair.leftId" class="cmp-now">{{ t("branch.current") }}</span>
            <span class="cmp-colname" :title="sideTitle(compare.pair.leftId)">
              <span v-if="isEmptyContext(compare.pair.leftId)" class="cut-glyph">✂</span>
              {{ sideTitle(compare.pair.leftId) }}
            </span>
            <span class="cmp-colmeta">{{ colMeta(0) }}</span>
            <span v-if="isEmptyContext(compare.pair.leftId)" class="cmp-cutnote">{{
              t("cut.compareNote")
            }}</span>
          </div>
          <div
            class="cmp-colcard right"
            :class="{ 'empty-ctx': isEmptyContext(compare.pair.rightId) }"
          >
            <span v-if="store.selectedId === compare.pair.rightId" class="cmp-now">{{ t("branch.current") }}</span>
            <span class="cmp-colname" :title="sideTitle(compare.pair.rightId)">
              <span v-if="isEmptyContext(compare.pair.rightId)" class="cut-glyph">✂</span>
              {{ sideTitle(compare.pair.rightId) }}
            </span>
            <span class="cmp-colmeta">{{ colMeta(1) }}</span>
            <span v-if="isEmptyContext(compare.pair.rightId)" class="cmp-cutnote">{{
              t("cut.compareNote")
            }}</span>
          </div>
        </div>

        <!-- same-origin: aligned pairs from the shared fork anchor -->
        <template v-if="compare.plan">
          <button
            v-if="compare.plan.common.length > 0"
            type="button"
            class="cmp-prefix"
            @click="prefixOpen = !prefixOpen"
          >{{ prefixOpen ? "▾" : "▸" }} {{ t("branch.commonPrefix", { n: compare.plan.common.length }) }}</button>
          <div v-if="prefixOpen" class="cmp-prefix-list">
            <div v-for="node in compare.plan.common" :key="node.id" class="cmp-prefix-row">
              <span class="cmp-prefix-title" :title="node.title">{{ node.title }}</span>
            </div>
          </div>

          <div class="cmp-forkline">
            <span class="cmp-fork-glyph">⑂</span>
            <span class="cmp-fork-text">{{ t("branch.forkAt", { title: compare.plan.anchor.title }) }}</span>
            <span
              v-if="samePrompt"
              class="cmp-same"
              :title="t('branch.sameRetryTitle')"
            >{{ t("branch.samePrompt") }}</span>
          </div>

          <div v-if="pairColumns.length === 0" class="cmp-empty">
            {{ t("branch.emptyAfterFork") }}
          </div>
          <div v-else class="cmp-free">
            <div
              v-for="(col, ci) in pairColumns"
              :key="col.id"
              :ref="(el) => setColEl(ci, el)"
              class="cmp-fcol"
              :class="sideOf(ci)"
              @scroll="onColScroll(ci, $event)"
            >
              <!-- No column head here: the aligned header cards above already
                   name both sides and mark the current one, and "selected" would
                   tear the lens down mid-comparison. -->
              <CmpCell
                v-for="cell in col.cells"
                :key="cell.id"
                :cell="cell"
                :side="sideOf(ci)"
                :expand-signal="allCellsSignal"
                :expand-open="allCellsOpen"
              />
              <button
                v-if="colIsAway(ci) && colNewTurnsOf(ci) > 0"
                type="button"
                class="cmp-jump"
                :title="t('branch.jumpLatest')"
                @click="pinColBottom(ci, true)"
              >{{ t("branch.newTurns", { n: colNewTurnsOf(ci) }) }}</button>
            </div>
          </div>
        </template>

        <!-- different-origin: two independent timelines, no pairing -->
        <template v-else>
          <div class="cmp-forkline">
            <span class="cmp-fork-glyph">⇄</span>
            <span class="cmp-fork-text">{{ t("branch.unrelated") }}</span>
            <span
              v-if="freeSamePrompt"
              class="cmp-same"
              :title="t('branch.sameApproachTitle')"
            >{{ t("branch.samePrompt") }}</span>
          </div>
          <div class="cmp-free">
            <div
              v-for="(col, ci) in freeColumns"
              :key="col.id"
              :ref="(el) => setColEl(ci, el)"
              class="cmp-fcol"
              :class="sideOf(ci)"
              @scroll="onColScroll(ci, $event)"
            >
              <div class="cmp-fcol-head">
                <button
                  type="button"
                  :title="t('branch.selectColumn', { title: col.title })"
                  @click="selectColumn(col.id)"
                >{{ t("branch.select") }}</button>
                <button
                  type="button"
                  :title="t('branch.jumpLatest')"
                  @click="scrollLatest(ci)"
                >{{ t("branch.latest") }}</button>
              </div>
              <div v-if="col.cells.length === 0" class="cmp-empty">{{ t("branch.emptySession") }}</div>
              <CmpCell
                v-for="cell in col.cells"
                :key="cell.id"
                :cell="cell"
                :side="sideOf(ci)"
                :expand-signal="allCellsSignal"
                :expand-open="allCellsOpen"
              />
              <button
                v-if="colIsAway(ci) && colNewTurnsOf(ci) > 0"
                type="button"
                class="cmp-jump"
                :title="t('branch.jumpLatest')"
                @click="pinColBottom(ci, true)"
              >{{ t("branch.newTurns", { n: colNewTurnsOf(ci) }) }}</button>
            </div>
          </div>
        </template>
      </div>
      <CompareComposer
        :targets="compareTargets"
        :models="store.models"
        :favorite-models="store.favoriteModels"
        :recent-models="store.recentModels"
        :allow-attachments="store.capabilities.attachments"
        :send="sendCompare"
        :abort="abortCompare"
        @set-model="setPaneModel"
        @toggle-favorite="toggleFavoriteModel"
      />
    </template>

    <!-- ── normal pane ───────────────────────────────────────────────── -->
    <template v-else>
      <div class="ctx-head">
        <span class="ctx-icon">💬</span>
        <div class="ctx-headings">
          <div class="ctx-title">{{ parallelRoundGroup && showParallelResults ? pt("title") : digestGroup && showDigestResults ? dt("panelTitle") : t("branch.contextTitle") }}</div>
          <div class="ctx-sub" :title="selectedSession?.title ?? ''">
            <template v-if="turnMeta">{{ turnMeta }} · </template>{{ selectedSession?.title || t("branch.pickNode") }}
          </div>
          <div v-if="selectedTags.length > 0" class="ctx-tags">
            <span
              v-for="tag in selectedTags"
              :key="tag"
              class="tag-chip"
              :style="{ color: tagColor(tag), background: tagBg(tag) }"
            >{{ tag }}</span>
          </div>
        </div>
        <div class="ctx-nav">
          <button
            v-if="compareParentId"
            type="button"
            class="nav-cmp"
            :title="t('branch.compareParent', { title: sideTitle(compareParentId) })"
            @click="openCompareParent"
          >{{ t("branch.compareParentBtn") }}</button>
          <button
            v-if="paneTurnNode"
            type="button"
            class="nav-btn"
            :class="{ 'mark-on': isTurnMarked(paneTurnNode.id) }"
            :title="isTurnMarked(paneTurnNode.id) ? t('canvas.unmarkTitle') : t('canvas.markTitle')"
            @click="toggleMark"
          >{{ isTurnMarked(paneTurnNode.id) ? "★" : "☆" }}</button>
          <button
            v-if="pane?.turn.error"
            type="button"
            class="nav-btn"
            :title="t('msg.retryTitle')"
            @click="retry"
          >↻</button>
          <button
            v-if="pane"
            type="button"
            class="nav-btn"
            :title="t('branch.exportTitle')"
            @click="exportMd"
          >⤓</button>
          <button
            v-if="store.capabilities.compress && pane"
            type="button"
            class="nav-btn"
            :title="t('branch.compressTitle')"
            :disabled="isRunning"
            @click="compress"
          >🗜</button>
          <template v-if="pane">
            <button
              type="button"
              class="nav-btn"
              :title="t('branch.prevTurn')"
              :disabled="pane.index === 0"
              @click="stepTurn(-1)"
            >‹</button>
            <button
              type="button"
              class="nav-btn"
              :title="t('branch.nextTurn')"
              :disabled="pane.index === pane.total - 1"
              @click="stepTurn(1)"
            >›</button>
          </template>
        </div>
        <span v-if="isRunning" class="ctx-running">{{ t("branch.running") }}</span>
      </div>

      <!-- The marker's meaning in words, on its own row: the head is already
           tight with the nav buttons, and squeezing this in turned the title
           into a vertical strip on a narrow pane. -->
      <div v-if="isEmptyContext(store.selectedId) && !(parallelRoundGroup && showParallelResults) && !(digestGroup && showDigestResults)" class="ctx-cut-note">
        <span class="ctx-cut-glyph">✂</span>
        <span>{{ t("cut.paneNote") }}</span>
      </div>

      <div v-if="store.messagesError" class="banner banner-error">{{ store.messagesError }}</div>

      <div v-if="parallelRoundGroup" class="parallel-reading-tabs">
        <button type="button" :class="{ on: showParallelResults }" :aria-pressed="showParallelResults" @click="showParallelResults = true">✦ {{ pt("summaryTab") }}</button>
        <button type="button" :class="{ on: !showParallelResults }" :aria-pressed="!showParallelResults" @click="showParallelResults = false">{{ pt("conversationTab") }}</button>
      </div>
      <div v-else-if="digestGroup" class="parallel-reading-tabs">
        <button type="button" :class="{ on: showDigestResults }" :aria-pressed="showDigestResults" @click="showDigestResults = true">✦ {{ dt("summaryTab") }}</button>
        <button type="button" :class="{ on: !showDigestResults }" :aria-pressed="!showDigestResults" @click="showDigestResults = false">{{ dt("conversationTab") }}</button>
      </div>
      <ParallelResults
        v-if="parallelRoundGroup && showParallelResults"
        :group="parallelRoundGroup"
        :summary-model-label="parallelSummaryModelLabel"
        :viewing-session-id="store.selectedId"
        @open="openParallelSource"
        @compare="compareParallelSources"
        @summarize="summarizeCurrentGroup"
        @retry="retryParallelSource"
        @stop="stopParallelSource"
      />
      <DigestResults
        v-else-if="digestGroup && showDigestResults"
        :group="digestGroup"
        :viewing-session-id="store.selectedId"
        @open="openDigestSource"
        @resummarize="resummarizeCurrentDigest"
      />
      <MessageList
        v-else-if="selectedSession"
        :session="selectedSession"
        :messages="paneMessages"
        :collapsed-user-message-id="parallelSummaryInputId ?? digestSummaryInputId"
        :collapsed-user-message-label="digestGroup ? dt('summaryInput') : pt('summaryInput')"
        :running="isRunning"
        :stream-parts="store.streamParts"
        :error="null"
        @retry="retry"
      >
        <template v-if="isEmptyContext(store.selectedId)" #context>
          <!-- An empty-context branch carries none of these ancestors, so the
               pane does not list them as numbered context steps at all: it
               names where the branch split off and stops there. -->
          <div class="chain">
            <div class="chain-label">{{ t("cut.chainLabel") }}</div>
            <div class="chain-lineage">
              <span class="chain-lineage-glyph">⎇</span>
              <span class="chain-lineage-body">
                <span class="chain-title">{{ t("cut.splitFrom", { title: cutParentTitle }) }}</span>
                <span class="chain-preview">{{ t("cut.chainGhost") }}</span>
              </span>
            </div>
          </div>
        </template>
        <template v-else-if="contextTurns.length > 0 || omittedCount > 0" #context>
          <div class="chain">
            <div class="chain-label">{{ t("branch.chainLabel") }}</div>
            <p v-if="omittedCount > 0" class="chain-omitted">{{ t("branch.chainOmitted", { n: omittedCount }) }}</p>
            <button
              v-for="(node, i) in contextTurns"
              :key="node.id"
              type="button"
              class="chain-card"
              :title="t('branch.jumpToTurn')"
              @click="jumpTo(node)"
            >
              <span class="chain-step">{{ chainStart + i }}</span>
              <span class="chain-body">
                <span class="chain-title">
                  <span
                    v-if="node.sessionId !== store.selectedId"
                    class="chain-fork"
                    :title="t('branch.fromUpstream')"
                  >⎇</span>
                  {{ node.title }}
                </span>
                <span class="chain-preview">{{
                  node.preview ||
                    (node.error
                      ? `⚠ ${node.error}`
                      : node.toolNames.length > 0
                        ? t("branch.toolOnlyPreview", { n: node.toolNames.length })
                        : t("cmp.noText"))
                }}</span>
              </span>
            </button>
          </div>
        </template>
      </MessageList>
      <InteractionInline v-if="inlineHostVisible" />
      <FileChangesCard v-if="selectedSession && store.capabilities.fileChanges" />
      <div v-if="!selectedSession" class="ctx-empty">
        <p>{{ t("branch.emptyHint") }}</p>
      </div>

      <ChatInput
        v-if="selectedSession"
        ref="chatInputEl"
        :running="isRunning"
        :queued-count="queuedCount"
        :parallel-sending="parallelSending || (showParallelResults && parallelRoundBusy)"
        :backend="store.activeBackend"
        :model="paneModel"
        :models="store.models"
        :favorite-models="store.favoriteModels"
        :recent-models="store.recentModels"
        :allow-attachments="store.capabilities.attachments"
        :context="paneContextUsage"
        :can-compress="store.capabilities.compress"
        :send-parallel="settings.labs.parallelModels ? sendParallel : undefined"
        @send="send"
        @interrupt="interrupt"
        @abort="abort"
        @set-model="onSetModel"
        @toggle-favorite="toggleFavoriteModel"
        @compress="compress"
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { TurnNode } from "../../../shared/canvas-graph";
import type { DigestGroup } from "../../../shared/digest-types";
import { buildTurns, type Turn } from "../../../shared/turns";
import type { ModelChoice, PromptAttachment, SessionSummary } from "../../../shared/types";
import { dt } from "../digest-i18n";
import { formatDuration, formatTokens } from "../format";
import { t } from "../i18n";
import {
  type ParallelGroup,
  type ParallelSummarySettings,
  parallelGroupBusy,
} from "../parallel-groups";
import { pt } from "../parallel-i18n";
import { settings } from "../settings";
import {
  abortRun,
  abortRunFor,
  activeChain,
  cancelComparePick,
  comparePlan,
  compareWithParent,
  composerModelFor,
  compressSession,
  digestGroupForSession,
  enterCompare,
  exitCompare,
  exportBranchMarkdown,
  inlineHostVisible,
  interruptPanePrompt,
  isEmptyContext,
  isTurnMarked,
  paneComposerModel,
  paneContextUsage,
  paneMessages,
  paneTurn,
  parallelGroupForSession,
  parallelRoundOwner,
  queuedPromptCount,
  resummarizeDigest,
  retryParallelTarget,
  retryTurn,
  selectedSession,
  selectSession,
  selectTurn,
  sendComparePrompt,
  sendPanePrompt,
  sendParallelPrompt,
  setPaneModel,
  stepTurn,
  stopParallelTarget,
  store,
  summarizeParallelGroup,
  tagBg,
  tagColor,
  tagsOf,
  toggleFavoriteModel,
  toggleTurnMark,
  turnGraph,
} from "../state";
import ChatInput from "./chat-input.vue";
import CmpCell, { type DisplayCell } from "./cmp-cell.vue";
import CompareComposer from "./compare-composer.vue";
import DigestResults from "./digest-results.vue";
import FileChangesCard from "./file-changes-card.vue";
import InteractionInline from "./interaction-inline.vue";
import MessageList from "./message-list.vue";
import ParallelResults from "./parallel-results.vue";

const pane = computed(() => paneTurn.value);

/** The canvas node backing the pane's current turn — the ★ mark target. */
const paneTurnNode = computed(() => {
  const current = pane.value;
  if (!current || !store.selectedId || !current.turn.messageId) return null;
  const id = `${store.selectedId}:${current.turn.messageId}`;
  return turnGraph.value.nodes.find((n) => n.id === id) ?? null;
});

function toggleMark(): void {
  const node = paneTurnNode.value;
  if (node) void toggleTurnMark(node);
}

/** The selected session's tags — identity chips under the pane header. */
const selectedTags = computed(() => (store.selectedId ? tagsOf(store.selectedId) : []));

const chatInputEl = ref<{ focus: () => void } | null>(null);
const parallelSending = ref(false);
const currentParallelGroup = computed(() =>
  parallelGroupForSession(store.activeBackend, store.selectedId),
);
/**
 * The round's reading view is the anchor's and the summary's. A per-model
 * answer branch is that model's own conversation, so it reads as one — the
 * round's tabs there only repeated the same round on every branch.
 */
const parallelRoundGroup = computed<ParallelGroup | null>(() => {
  const group = currentParallelGroup.value;
  return group && parallelRoundOwner(group, store.selectedId) ? group : null;
});
const showParallelResults = ref(true);
const parallelSummaryInputId = computed(() => {
  const group = currentParallelGroup.value;
  const version = group?.summaryVersions.find((item) => item.sessionId === store.selectedId);
  if (!version || !store.selectedId) return null;
  return (
    store.messagesBySession[store.selectedId]?.find((message) => message.role === "user")?.id ??
    null
  );
});
const parallelRoundBusy = computed(() =>
  Boolean(currentParallelGroup.value && parallelGroupBusy(currentParallelGroup.value)),
);
const parallelSummaryModelLabel = computed(() => {
  const model = currentParallelGroup.value?.settings.model;
  if (!model) return t("input.parallelDefaultSummaryModel");
  return (
    store.models.find(
      (item) => item.providerId === model.providerId && item.modelId === model.modelId,
    )?.modelName ?? model.modelId
  );
});
watch(
  () => [store.selectedId, currentParallelGroup.value?.id] as const,
  () => {
    const group = currentParallelGroup.value;
    // A summary session of ANY version opens the reading view, not just the
    // newest one: the canvas draws every version as its own summary card, so
    // landing on an older card must show what that card promised.
    showParallelResults.value = group ? parallelRoundOwner(group, store.selectedId) : false;
  },
  { immediate: true },
);
async function openParallelSource(sessionId: string): Promise<void> {
  await selectSession(sessionId);
  showParallelResults.value = false;
}
function compareParallelSources(sessionIds: [string, string]): void {
  void enterCompare(sessionIds[0], sessionIds[1]);
}
function summarizeCurrentGroup(): void {
  const group = currentParallelGroup.value;
  if (group) void summarizeParallelGroup(group.id);
}
function retryParallelSource(targetId: string): void {
  const group = currentParallelGroup.value;
  if (group) void retryParallelTarget(group.id, targetId);
}
function stopParallelSource(targetId: string): void {
  const group = currentParallelGroup.value;
  if (group) void stopParallelTarget(group.id, targetId);
}

// ── ✦ story digest reading view (事后总结) ───────────────────────────
/**
 * The digest whose summary the pane is showing. Unlike a round, only the
 * summary session itself is a digest surface — the anchor story is an
 * ordinary story the user was reading, and its pane keeps showing it.
 */
const digestGroup = computed<DigestGroup | null>(() =>
  digestGroupForSession(store.activeBackend, store.selectedId),
);
const showDigestResults = ref(true);
/** The digest prompt is this summary session's first user row; the
 *  conversation tab collapses it like a round's summary input. */
const digestSummaryInputId = computed(() => {
  if (!digestGroup.value || !store.selectedId) return null;
  return (
    store.messagesBySession[store.selectedId]?.find((message) => message.role === "user")?.id ??
    null
  );
});
watch(
  () => [store.selectedId, digestGroup.value?.id] as const,
  () => {
    // Landing on any version's summary opens the digest view, so an older
    // card the canvas sent the user to shows what that card promised.
    showDigestResults.value = digestGroup.value !== null;
  },
  { immediate: true },
);
function openDigestSource(sessionId: string): Promise<void> {
  // A source story is a story, not a digest surface: its pane reads as the
  // conversation it is.
  showDigestResults.value = false;
  return selectSession(sessionId);
}
function resummarizeCurrentDigest(): void {
  const group = digestGroup.value;
  if (group) void resummarizeDigest(group.id);
}
// a new conversation landed: the fresh session is selected and mounted by now — put the
// caret in the pane composer so its first prompt starts with a keystroke.
watch(
  () => store.composerFocusRequest,
  (nonce) => {
    if (nonce === null) return;
    void nextTick(() => chatInputEl.value?.focus());
  },
);

// ── ⇄ branch comparison ─────────────────────────────────────────────

/**
 * The open comparison. `plan` is null when the two sessions never meet —
 * A different-origin pair renders as two free side-by-side timelines instead of
 * aligned pairs.
 */
const compare = computed(() => {
  const pair = store.compare;
  if (!pair) return null;
  return { pair, plan: comparePlan.value };
});

const sides = ["left", "right"] as const;

const compareTargets = computed(() => {
  const current = compare.value;
  if (!current) return [];
  return [current.pair.leftId, current.pair.rightId].map((id, index) => ({
    id,
    side: sideOf(index),
    title: sideTitle(id),
    model: composerModelFor(id),
    running: Boolean(store.running[id]),
  }));
});

async function sendCompare(
  ids: readonly string[],
  text: string,
  models: Readonly<Record<string, ModelChoice | null>>,
  attachments: PromptAttachment[],
) {
  return sendComparePrompt(ids, text, models, attachments);
}

async function abortCompare(sessionId: string): Promise<string | null> {
  return abortRunFor(sessionId);
}

function sideOf(index: number): (typeof sides)[number] {
  return index === 0 ? "left" : "right";
}

/**
 * The aligned mode's two columns. Each side's divergent turns become one
 * column, so the lists flow independently: opening a card on one side never
 * stretches the other side's row or pushes its next turn out of view. The
 * pairing is kept as the "up" flag — a turn that belongs to the upstream
 * branch rather than this side's own.
 */
const pairColumns = computed<FreeColumn[]>(() => {
  const current = compare.value;
  if (!current?.plan) return [];
  const plan = current.plan;
  return sides.map((side) => {
    const sideId = current.pair[side === "left" ? "leftId" : "rightId"];
    const cells: DisplayCell[] = plan[side].map((node) => ({
      id: node.id,
      title: node.title,
      preview: node.preview,
      toolNames: node.toolNames,
      modelIds: node.modelIds,
      durationMs: node.durationMs,
      outputTokens: node.outputTokens,
      error: node.error,
      badge: badgeOf(node),
      flag: node.sessionId !== sideId ? "up" : null,
    }));
    const tokens = plan[side].reduce((sum, n) => sum + n.outputTokens, 0);
    const errors = plan[side].filter((n) => n.error !== null).length;
    const bits = [t("branch.turnsCount", { n: cells.length })];
    if (tokens > 0) bits.push(formatTokens(tokens));
    if (errors > 0) bits.push(`⚠ ${errors}`);
    return { id: sideId, title: sideTitle(sideId), meta: bits.join(" · "), cells };
  });
});

const samePrompt = computed(() => {
  const plan = compare.value?.plan;
  if (!plan) return false;
  const [l, r] = [plan.left[0], plan.right[0]];
  return l != null && r != null && l.title !== "" && l.title === r.title;
});

/** Leading turns copied from the original — none for roots and empty-context forks. */
function inheritedTurns(sessionId: string, turns: Turn[]): number {
  const record = store.lineage[sessionId];
  if (!record || record.context === "none" || record.atMessageId == null) return 0;
  const index = turns.findIndex((t) => t.messageId === record.atMessageId);
  return index < 0 ? 0 : index + 1;
}

interface FreeColumn {
  id: string;
  title: string;
  meta: string;
  cells: DisplayCell[];
}

/**
 * The free side-by-side columns (different-origin): each session's whole timeline from
 * its own messages — no canvas graph needed, so the pair may cross stories.
 */
const freeColumns = computed<FreeColumn[] | null>(() => {
  const current = compare.value;
  if (!current || current.plan) return null;
  return [current.pair.leftId, current.pair.rightId].map((id, ci) => {
    const turns = buildTurns(id, store.messagesBySession[id] ?? []);
    const inherited = inheritedTurns(id, turns);
    // The side namespaces the id: two independent stories are free to mint the
    // same message ids, and an unnamespaced collision would let one column's
    // fold state ride on the other's card.
    const side = sides[ci];
    const cells: DisplayCell[] = turns.map((turn, i) => ({
      id: `${side}:${id}:${turn.messageId}`,
      title: turn.title,
      preview: turn.preview,
      toolNames: turn.toolNames,
      modelIds: turn.modelIds,
      durationMs: turn.durationMs,
      outputTokens: turn.outputTokens,
      error: turn.error,
      badge: i < inherited ? null : i - inherited + 1,
      flag: i < inherited ? "inherited" : null,
    }));
    const tokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0);
    const errors = turns.filter((turn) => turn.error !== null).length;
    const bits = [
      inherited > 0
        ? t("branch.turnsMeta", { n: turns.length, m: inherited })
        : t("branch.turnsCount", { n: turns.length }),
    ];
    if (tokens > 0) bits.push(formatTokens(tokens));
    if (errors > 0) bits.push(`⚠ ${errors}`);
    return { id, title: sideTitle(id), meta: bits.join(" · "), cells };
  });
});

const freeSamePrompt = computed(() => {
  const cols = freeColumns.value;
  if (!cols || cols.length < 2) return false;
  const l = cols[0]?.cells[0];
  const r = cols[1]?.cells[0];
  return l != null && r != null && l.title !== "" && l.title === r.title;
});

/** Column summary — own graph turns when aligned, whole timeline when free. */
function colMeta(index: 0 | 1): string {
  const current = compare.value;
  if (!current) return "";
  if (current.plan) {
    return sideMeta(index === 0 ? current.pair.leftId : current.pair.rightId);
  }
  return freeColumns.value?.[index]?.meta ?? "";
}

function sessionOf(id: string): SessionSummary | null {
  return store.sessions.find((s) => s.id === id) ?? null;
}

function sideTitle(id: string): string {
  return sessionOf(id)?.title || id;
}

/** Column summary over the branch's OWN turns — upstream rides in the rows. */
function sideMeta(id: string): string {
  const own = turnGraph.value.nodes.filter((n) => n.sessionId === id && n.kind === "turn");
  const tokens = own.reduce((sum, n) => sum + n.outputTokens, 0);
  const errors = own.filter((n) => n.error !== null).length;
  const bits = [t("branch.turnsCount", { n: own.length })];
  if (tokens > 0) bits.push(formatTokens(tokens));
  if (errors > 0) bits.push(`⚠ ${errors}`);
  return bits.join(" · ");
}

/** 1-based position among the session's own turns — the cell badge. */
function badgeOf(node: TurnNode): number {
  let count = 0;
  for (const other of turnGraph.value.nodes) {
    if (other.sessionId !== node.sessionId || other.kind !== "turn") continue;
    count += 1;
    if (other.id === node.id) break;
  }
  return count;
}

const prefixOpen = ref(false);

/**
 * Expand/collapse every card in both columns at once. Reading two full
 * answers is the comparison's main event, and folding each card open by
 * hand is the chore this replaces. The counter signal applies the command
 * once per click and leaves hand-folded choices alone until the next one
 * (see cmp-cell), and a card that arrives later — a turn streaming in —
 * still starts folded, so a live run does not yank the layout open.
 */
const allCellsOpen = ref(false);
const allCellsSignal = ref(0);

function toggleAllCells(): void {
  allCellsOpen.value = !allCellsOpen.value;
  allCellsSignal.value += 1;
}

const colEls = new Map<number, Element>();

function setColEl(index: number, el: unknown): void {
  if (el) colEls.set(index, el as Element);
  else colEls.delete(index);
}

function scrollLatest(index: number): void {
  pinColBottom(index, true);
}

/**
 * Stream follow, one state per column, on the pane's own constant so a
 * compare column behaves exactly like the message list: a column the
 * reader parked at the bottom keeps up with a run as it streams, and the
 * moment they scroll up to reread it holds their place and counts the
 * turns that land below instead. Comparing two live runs is the case
 * this exists for — one side streams while the other is being read.
 */
const BOTTOM_SLACK_PX = 32;
const colAway = ref<[boolean, boolean]>([false, false]);
const colNewTurns = ref<[number, number]>([0, 0]);
let colTurnsSeen: [number, number] = [0, 0];

/** Land a column on its newest content: the follow target, the pill's
 *  jump, and where a compare over an already-running side opens. */
function pinColBottom(index: number, smooth: boolean): void {
  const el = colEls.get(index);
  if (!el) return;
  if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  else el.scrollTop = el.scrollHeight;
  colAway.value[index] = false;
  colNewTurns.value[index] = 0;
}

/** Recompute one column's away state — the scroll listener's job, and the
 *  only writer of the "reading back" flag. */
function syncColAway(index: number): void {
  const el = colEls.get(index);
  if (!el) return;
  const away = el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_SLACK_PX;
  colAway.value[index] = away;
  if (!away) colNewTurns.value[index] = 0;
}

/** Template readers for the per-column state — indexing a tuple with the
 *  loop's plain number reads as possibly-undefined under the project's
 *  tsconfig, and a pill must never render "↓ undefined". */
function colIsAway(index: number): boolean {
  return colAway.value[index] === true;
}

function colNewTurnsOf(index: number): number {
  return colNewTurns.value[index] ?? 0;
}

/**
 * Optional lockstep scrolling. Each column keeps its own height, so the two
 * rarely match — syncing by pixel offset would stop the shorter column at its
 * end while the other still had room. Progress ratio instead: scrolling one
 * column carries the other to the same fraction of its own scrollable range,
 * so both read "about as far along" whichever is longer.
 */
const syncScroll = ref(false);

/** The column currently being dragged by the user, to avoid echo loops. */
let syncingFrom: Element | null = null;

/**
 * The last ratio the relay applied and the column it came from. A card
 * expanding or folding afterwards changes that column's height, so the
 * pair is re-anchored to the same ratio of the new range instead of
 * silently knocked out of step (see the content watch below).
 */
let lastSyncFrom: number | null = null;
let lastSyncRatio = 0;

function onColScroll(index: number, event: Event): void {
  syncColAway(index);
  if (!syncScroll.value) return;
  const source = event.currentTarget as HTMLElement | null;
  if (!source || source === syncingFrom) return;
  const span = source.scrollHeight - source.clientHeight;
  if (span <= 0) return;
  const ratio = source.scrollTop / span;
  lastSyncFrom = index;
  lastSyncRatio = ratio;
  syncingFrom = source;
  for (const [other, el] of colEls) {
    if (other === index) continue;
    const otherSpan = el.scrollHeight - el.clientHeight;
    if (otherSpan <= 0) continue;
    el.scrollTop = ratio * otherSpan;
  }
  // The scroll events this assignment fires land after the current one, so
  // the guard is released on the next frame rather than synchronously.
  requestAnimationFrame(() => {
    syncingFrom = null;
  });
}

/**
 * New content in a column — a streamed delta, a turn that landed, a card
 * that changed height. "Was the reader at the bottom" is answered BEFORE
 * the DOM updates (the pane's rule): afterwards the grown column would
 * make a followed reader look parked mid-column. A followed column is
 * re-pinned; a column being read back keeps its place and counts the
 * turns that arrived below it.
 */
watch([pairColumns, freeColumns], () => {
  const wasAtBottom: boolean[] = [];
  for (const index of [0, 1] as const) {
    const el = colEls.get(index);
    wasAtBottom[index] = el
      ? el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
      : false;
  }
  void nextTick(() => {
    // A synced pair re-anchors first, on the post-update heights: the
    // expanded card's column grew, so the other rides the same ratio of
    // its own new range.
    if (syncScroll.value && lastSyncFrom !== null) {
      const other = lastSyncFrom === 0 ? 1 : 0;
      const el = colEls.get(other);
      if (el) {
        const span = el.scrollHeight - el.clientHeight;
        if (span > 0) el.scrollTop = lastSyncRatio * span;
      }
    }
    const columns = pairColumns.value.length > 0 ? pairColumns.value : freeColumns.value;
    for (const index of [0, 1] as const) {
      const el = colEls.get(index);
      if (!el) continue;
      const turns = columns?.[index]?.cells.length ?? 0;
      if (wasAtBottom[index]) {
        el.scrollTop = el.scrollHeight;
        colNewTurns.value[index] = 0;
      } else if (colAway.value[index] && turns > colTurnsSeen[index]) {
        colNewTurns.value[index] += turns - colTurnsSeen[index];
      }
      colTurnsSeen[index] = turns;
    }
  });
});

/** Jump into one of the compared sessions — a fresh selection tears the lens down. */
function selectColumn(sessionId: string): void {
  void selectSession(sessionId);
}

// A new pair (or compare closing) starts the lens from scratch; watching the
// state pair rather than the plan keeps graph re-layouts from resetting it.
watch(
  () => store.compare,
  () => {
    prefixOpen.value = false;
    // Every card of the new pair starts folded, so the head's toggle offers
    // "expand" again instead of remembering the previous pair's state.
    allCellsOpen.value = false;
    colEls.clear();
    colAway.value = [false, false];
    colNewTurns.value = [0, 0];
    colTurnsSeen = [0, 0];
    lastSyncFrom = null;
    // A side that is already running opens on its newest turn — the stream
    // is why the comparison is open. A settled pair opens at the fork.
    const pair = store.compare;
    if (pair) {
      void nextTick(() => {
        if (store.running[pair.leftId]) pinColBottom(0, false);
        if (store.running[pair.rightId]) pinColBottom(1, false);
      });
    }
  },
);

/** The selected branch's original, when it sits on this canvas — the ⇄ entry. */
const compareParentId = computed(() => {
  const id = store.selectedId;
  if (!id || store.compare) return null;
  const parent = store.lineage[id]?.parentId;
  return parent != null && turnGraph.value.nodes.some((n) => n.sessionId === parent)
    ? parent
    : null;
});

function openCompareParent(): void {
  if (compareParentId.value && store.selectedId) compareWithParent(store.selectedId);
}

// ── context chain: the turns before the pane's current one ──────────

/** Keep the pane readable: at most this many ancestor cards, oldest dropped. */
const MAX_CONTEXT = 12;

const omittedCount = computed(() => Math.max(0, activeChain.value.length - 1 - MAX_CONTEXT));
const contextTurns = computed(() => activeChain.value.slice(0, -1).slice(-MAX_CONTEXT));
const chainStart = computed(() => omittedCount.value + 1);

/**
 * Title of the branch an empty-context fork split off from. It comes from
 * lineage rather than the chain: the chain's ancestors are exactly what this
 * branch does not carry, so the pane names the parent instead of listing them.
 */
const cutParentTitle = computed(() => {
  const id = store.selectedId;
  const parentId = id ? store.lineage[id]?.parentId : undefined;
  const title = parentId ? (store.sessions.find((s) => s.id === parentId)?.title ?? "") : "";
  return title || t("cut.splitFromFallback");
});

function jumpTo(node: TurnNode): void {
  void selectTurn(node, { focusCanvas: true });
}

const isRunning = computed(() => {
  const id = store.selectedId;
  return id != null && Boolean(store.running[id]);
});

/** Prompts already waiting behind this session's run (0 hides the count). */
const queuedCount = computed(() => {
  const id = store.selectedId;
  return id == null ? 0 : queuedPromptCount(store.activeBackend, id);
});

const turnMeta = computed(() => {
  const current = pane.value;
  if (!current) return null;
  const bits = [t("branch.turnPos", { index: current.index + 1, total: current.total })];
  if (current.turn.durationMs !== null) bits.push(formatDuration(current.turn.durationMs));
  if (current.turn.outputTokens > 0) bits.push(formatTokens(current.turn.outputTokens));
  return bits.join(" · ");
});

function send(text: string, attachments: PromptAttachment[]): void {
  void sendPanePrompt(text, attachments);
}

/** Stop the running turn and send this prompt instead of queueing behind it. */
function interrupt(text: string, attachments: PromptAttachment[]): void {
  void interruptPanePrompt(text, attachments);
}

async function sendParallel(
  text: string,
  attachments: PromptAttachment[],
  targets: readonly (ModelChoice | null)[],
  summary: ParallelSummarySettings,
): Promise<boolean> {
  if (parallelSending.value) return false;
  parallelSending.value = true;
  try {
    return await sendParallelPrompt(targets, text, attachments, summary);
  } finally {
    parallelSending.value = false;
  }
}

function abort(): void {
  void abortRun();
}

function retry(): void {
  const current = pane.value;
  if (current) retryTurn(current.turn);
}

function exportMd(): void {
  void exportBranchMarkdown();
}

function compress(): void {
  const id = store.selectedId;
  if (!id) return;
  // Compress at the viewed position: the pane's current turn decides whether
  // the summary forks off or lands in place (null = stub view, treated as tip).
  void compressSession(id, pane.value?.turn.messageId ?? null);
}

const paneModel = paneComposerModel;

function onSetModel(model: ModelChoice | null): void {
  if (store.selectedId) setPaneModel(store.selectedId, model);
}

// ←/→ walk turns without leaving the pane — but never while typing somewhere.
// They do nothing while a comparison is open: both modes render two
// independently scrolling columns, so there is no single list to walk. Esc
// leaves the comparison (or cancels a pending pick).
function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (event.key === "Escape") {
    if (typing) return;
    if (store.comparePickFrom) {
      event.preventDefault();
      cancelComparePick();
      return;
    }
    if (store.compare) {
      event.preventDefault();
      exitCompare();
    }
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (typing) return;
  // Both compare modes are two independently scrolling columns now, so there
  // is no row to page; the arrows keep their pane-only turn walking.
  if (store.compare) return;
  if (!pane.value) return;
  event.preventDefault();
  stepTurn(event.key === "ArrowLeft" ? -1 : 1);
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>
