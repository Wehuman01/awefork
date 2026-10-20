<template>
  <aside class="context" :class="{ comparing: compare }">
    <!-- ── ⇄ dual-pane comparison: aligned at a fork, or free side-by-side ── -->
    <template v-if="compare">
      <div class="cmp-head">
        <span class="cmp-head-title">{{ compare.plan ? t("branch.compareTitle") : t("branch.freeTitle") }}</span>
        <div v-if="compare.plan" class="cmp-pager">
          <button
            type="button"
            class="nav-btn"
            :title="t('branch.prevPair')"
            :disabled="pagerPos === 0"
            @click="stepPager(-1)"
          >‹</button>
          <span class="cmp-pager-pos">{{
            pairRows.length === 0 ? "0 / 0" : `${pagerPos + 1} / ${pairRows.length}`
          }}</span>
          <button
            type="button"
            class="nav-btn"
            :title="t('branch.nextPair')"
            :disabled="pagerPos >= pairRows.length - 1"
            @click="stepPager(1)"
          >›</button>
        </div>
        <button
          type="button"
          class="nav-btn"
          :title="t('branch.exitCompare')"
          @click="exitCompare()"
        >✕</button>
      </div>

      <div class="cmp-body" :class="{ free: !compare.plan }">
        <div class="cmp-cols">
          <div class="cmp-colcard left">
            <span v-if="store.selectedId === compare.pair.leftId" class="cmp-now">{{ t("branch.current") }}</span>
            <span class="cmp-colname" :title="sideTitle(compare.pair.leftId)">{{
              sideTitle(compare.pair.leftId)
            }}</span>
            <span class="cmp-colmeta">{{ colMeta(0) }}</span>
          </div>
          <div class="cmp-colcard right">
            <span v-if="store.selectedId === compare.pair.rightId" class="cmp-now">{{ t("branch.current") }}</span>
            <span class="cmp-colname" :title="sideTitle(compare.pair.rightId)">{{
              sideTitle(compare.pair.rightId)
            }}</span>
            <span class="cmp-colmeta">{{ colMeta(1) }}</span>
          </div>
        </div>

        <!-- 同源: aligned pairs from the shared fork anchor -->
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

          <div v-if="pairRows.length === 0" class="cmp-empty">
            {{ t("branch.emptyAfterFork") }}
          </div>
          <div v-else class="cmp-pairs">
            <div
              v-for="(row, i) in pairRows"
              :key="i"
              :ref="(el) => setPairEl(i, el)"
              class="pair"
            >
              <CmpCell
                v-for="side in sides"
                :key="side"
                :cell="row[side]"
                :side="side"
              />
            </div>
          </div>
        </template>

        <!-- 不同源: two independent timelines, no pairing -->
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
              :class="sides[ci]"
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
              />
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
          <div class="ctx-title">{{ t("branch.contextTitle") }}</div>
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

      <div v-if="store.messagesError" class="banner banner-error">{{ store.messagesError }}</div>

      <MessageList
        v-if="selectedSession"
        :session="selectedSession"
        :messages="paneMessages"
        :running="isRunning"
        :stream-parts="store.streamParts"
        :error="null"
        @retry="retry"
      >
        <template v-if="contextTurns.length > 0 || omittedCount > 0" #context>
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
        :model="paneModel"
        :models="store.models"
        :favorite-models="store.favoriteModels"
        :recent-models="store.recentModels"
        :allow-attachments="store.capabilities.attachments"
        @send="send"
        @abort="abort"
        @set-model="onSetModel"
        @toggle-favorite="toggleFavoriteModel"
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { TurnNode } from "../../../shared/canvas-graph";
import { buildTurns, type Turn } from "../../../shared/turns";
import type { ModelChoice, PromptAttachment, SessionSummary } from "../../../shared/types";
import { formatDuration, formatTokens } from "../format";
import { t } from "../i18n";
import {
  abortRun,
  abortRunFor,
  activeChain,
  cancelComparePick,
  comparePlan,
  compareWithParent,
  composerModelFor,
  compressSession,
  exitCompare,
  exportBranchMarkdown,
  inlineHostVisible,
  isTurnMarked,
  paneComposerModel,
  paneMessages,
  paneTurn,
  retryTurn,
  selectedSession,
  selectSession,
  selectTurn,
  sendComparePrompt,
  sendPanePrompt,
  setPaneModel,
  stepTurn,
  store,
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
import FileChangesCard from "./file-changes-card.vue";
import InteractionInline from "./interaction-inline.vue";
import MessageList from "./message-list.vue";

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
// 新增对话 landed: the fresh session is selected and mounted by now — put the
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
 * 不同源 renders as two free side-by-side timelines instead of aligned pairs.
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

const pairRows = computed(() => {
  const current = compare.value;
  if (!current?.plan) return [];
  const plan = current.plan;
  const cell = (node: TurnNode, side: (typeof sides)[number]): DisplayCell => ({
    id: node.id,
    title: node.title,
    preview: node.preview,
    toolNames: node.toolNames,
    modelIds: node.modelIds,
    durationMs: node.durationMs,
    outputTokens: node.outputTokens,
    error: node.error,
    badge: badgeOf(node),
    flag: node.sessionId !== current.pair[side === "left" ? "leftId" : "rightId"] ? "up" : null,
  });
  const rows: { left: DisplayCell | null; right: DisplayCell | null }[] = [];
  for (let i = 0; i < Math.max(plan.left.length, plan.right.length); i += 1) {
    const l = plan.left[i];
    const r = plan.right[i];
    rows.push({ left: l ? cell(l, "left") : null, right: r ? cell(r, "right") : null });
  }
  return rows;
});

const samePrompt = computed(() => {
  const plan = compare.value?.plan;
  if (!plan) return false;
  const [l, r] = [plan.left[0], plan.right[0]];
  return l != null && r != null && l.title !== "" && l.title === r.title;
});

/** Leading turns copied from the 母本 — none for roots and empty-context forks. */
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
 * The free side-by-side columns (不同源): each session's whole timeline from
 * its own messages — no canvas graph needed, so the pair may cross stories.
 */
const freeColumns = computed<FreeColumn[] | null>(() => {
  const current = compare.value;
  if (!current || current.plan) return null;
  return [current.pair.leftId, current.pair.rightId].map((id) => {
    const turns = buildTurns(id, store.messagesBySession[id] ?? []);
    const inherited = inheritedTurns(id, turns);
    const cells: DisplayCell[] = turns.map((turn, i) => ({
      id: `${id}:${turn.messageId}`,
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
    const tokens = turns.reduce((sum, t) => sum + t.outputTokens, 0);
    const errors = turns.filter((t) => t.error !== null).length;
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

const pagerPos = ref(0);
const pairEls = new Map<number, Element>();

function setPairEl(index: number, el: unknown): void {
  if (el) pairEls.set(index, el as Element);
  else pairEls.delete(index);
}

function stepPager(delta: number): void {
  const count = pairRows.value.length;
  if (count === 0) return;
  pagerPos.value = Math.min(count - 1, Math.max(0, pagerPos.value + delta));
  pairEls.get(pagerPos.value)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const colEls = new Map<number, Element>();

function setColEl(index: number, el: unknown): void {
  if (el) colEls.set(index, el as Element);
  else colEls.delete(index);
}

function scrollLatest(index: number): void {
  const el = colEls.get(index);
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

/** Jump into one of the compared sessions — a fresh selection tears the lens down. */
function selectColumn(sessionId: string): void {
  void selectSession(sessionId);
}

// A new pair (or compare closing) starts the lens from scratch; watching the
// state pair rather than the plan keeps graph re-layouts from resetting it.
watch(
  () => store.compare,
  () => {
    pagerPos.value = 0;
    prefixOpen.value = false;
    pairEls.clear();
    colEls.clear();
  },
);

/** The selected branch's 母本, when it sits on this canvas — the ⇄ entry. */
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

function jumpTo(node: TurnNode): void {
  void selectTurn(node, { focusCanvas: true });
}

const isRunning = computed(() => {
  const id = store.selectedId;
  return id != null && Boolean(store.running[id]);
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
  if (id) void compressSession(id);
}

const paneModel = paneComposerModel;

function onSetModel(model: ModelChoice | null): void {
  if (store.selectedId) setPaneModel(store.selectedId, model);
}

// ←/→ walk turns without leaving the pane — but never while typing somewhere.
// During an aligned comparison they page the pair rows; free side-by-side has
// no pairing, so they do nothing there. Esc leaves the comparison (or cancels
// a pending pick).
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
  if (store.compare) {
    event.preventDefault();
    if (compare.value?.plan) stepPager(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (!pane.value) return;
  event.preventDefault();
  stepTurn(event.key === "ArrowLeft" ? -1 : 1);
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>
