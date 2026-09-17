<template>
  <aside class="context" :class="{ comparing: compare }">
    <!-- ── ⇄ dual-pane branch comparison ─────────────────────────────── -->
    <template v-if="compare">
      <div class="cmp-head">
        <span class="cmp-head-title">⇄ 分支对比</span>
        <div class="cmp-pager">
          <button
            type="button"
            class="nav-btn"
            title="上一对（←）"
            :disabled="pagerPos === 0"
            @click="stepPager(-1)"
          >‹</button>
          <span class="cmp-pager-pos">{{
            pairRows.length === 0 ? "0 / 0" : `${pagerPos + 1} / ${pairRows.length}`
          }}</span>
          <button
            type="button"
            class="nav-btn"
            title="下一对（→）"
            :disabled="pagerPos >= pairRows.length - 1"
            @click="stepPager(1)"
          >›</button>
        </div>
        <button
          type="button"
          class="nav-btn"
          title="退出对比（Esc）"
          @click="exitCompare()"
        >✕</button>
      </div>

      <div class="cmp-body">
        <div class="cmp-cols">
          <div class="cmp-colcard left">
            <span class="cmp-colname" :title="sideTitle(compare.pair.leftId)">{{
              sideTitle(compare.pair.leftId)
            }}</span>
            <span class="cmp-colmeta">{{ sideMeta(compare.pair.leftId) }}</span>
          </div>
          <div class="cmp-colcard right">
            <span v-if="store.selectedId === compare.pair.rightId" class="cmp-now">当前</span>
            <span class="cmp-colname" :title="sideTitle(compare.pair.rightId)">{{
              sideTitle(compare.pair.rightId)
            }}</span>
            <span class="cmp-colmeta">{{ sideMeta(compare.pair.rightId) }}</span>
          </div>
        </div>

        <button
          v-if="compare.plan.common.length > 0"
          type="button"
          class="cmp-prefix"
          @click="prefixOpen = !prefixOpen"
        >{{ prefixOpen ? "▾" : "▸" }} 共同前缀 · {{ compare.plan.common.length }} 个回合</button>
        <div v-if="prefixOpen" class="cmp-prefix-list">
          <div v-for="node in compare.plan.common" :key="node.id" class="cmp-prefix-row">
            <span class="cmp-prefix-title" :title="node.title">{{ node.title }}</span>
          </div>
        </div>

        <div class="cmp-forkline">
          <span class="cmp-fork-glyph">⑂</span>
          <span class="cmp-fork-text">此后分叉 · 『{{ compare.plan.anchor.title }}』</span>
          <span
            v-if="samePrompt"
            class="cmp-same"
            title="两条分支分叉后的第一个提示词相同 — 看起来是同一步的重试"
          >同题</span>
        </div>

        <div v-if="pairRows.length === 0" class="cmp-empty">
          分叉点之后两条分支都还没有自己的回合。
        </div>
        <div v-else class="cmp-pairs">
          <div
            v-for="(row, i) in pairRows"
            :key="i"
            :ref="(el) => setPairEl(i, el)"
            class="pair"
          >
            <div
              v-for="side in sides"
              :key="side"
              class="cell"
              :class="[side, { blank: !row[side], open: row[side] && openCells.has(row[side].id) }]"
              @click="row[side] && toggleCell(row[side])"
            >
              <template v-if="row[side]">
                <div class="cell-top">
                  <span class="cell-idx">{{ badgeOf(row[side]) }}</span>
                  <span class="cell-title" :title="row[side].title">{{ row[side].title }}</span>
                </div>
                <div class="cell-chips">
                  <span
                    v-if="row[side].sessionId !== compare.pair[side === 'left' ? 'leftId' : 'rightId']"
                    class="cell-up"
                    title="上游分支的回合 — 通往这条分支的路上经过的岔路"
                  >⎇ 上游</span>
                  <span
                    v-if="row[side].modelIds.length > 0"
                    class="cell-chip model"
                    :title="row[side].modelIds.join('\n')"
                  >{{ row[side].modelIds[0] }}<template v-if="row[side].modelIds.length > 1">
                    +{{ row[side].modelIds.length - 1 }}</template></span>
                  <span
                    v-if="row[side].durationMs !== null"
                    class="cell-chip"
                  >⏱ {{ formatDuration(row[side].durationMs) }}</span>
                  <span
                    v-if="row[side].outputTokens > 0"
                    class="cell-chip"
                  >{{ formatTokens(row[side].outputTokens) }}</span>
                  <span
                    v-if="row[side].toolNames.length > 0"
                    class="cell-chip"
                  >🔧 {{ row[side].toolNames.length }}</span>
                  <span
                    v-if="row[side].error"
                    class="cell-chip err"
                    :title="row[side].error"
                  >⚠ 失败</span>
                </div>
                <p
                  class="cell-preview"
                  :class="{ errored: !row[side].preview && row[side].error }"
                >{{ previewOf(row[side]) }}</p>
              </template>
              <p v-else class="cell-blank">{{ side === "left" ? "左栏已到尾" : "右栏已到尾" }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── normal pane ───────────────────────────────────────────────── -->
    <template v-else>
      <div class="ctx-head">
        <span class="ctx-icon">💬</span>
        <div class="ctx-headings">
          <div class="ctx-title">分支上下文</div>
          <div class="ctx-sub" :title="selectedSession?.title ?? ''">
            <template v-if="turnMeta">{{ turnMeta }} · </template>{{ selectedSession?.title || "在画布上选一个节点" }}
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
            :title="`与母本分支「${sideTitle(compareParentId)}」并排对比`"
            @click="openCompareParent"
          >⇄ 对比母本</button>
          <button
            v-if="paneTurnNode"
            type="button"
            class="nav-btn"
            :class="{ 'mark-on': isTurnMarked(paneTurnNode.id) }"
            :title="isTurnMarked(paneTurnNode.id) ? '取消关键标记' : '标记为关键对话'"
            @click="toggleMark"
          >{{ isTurnMarked(paneTurnNode.id) ? "★" : "☆" }}</button>
          <button
            v-if="pane?.turn.error"
            type="button"
            class="nav-btn"
            title="重跑这个回合（预填原文，可先换模型/档位）"
            @click="retry"
          >↻</button>
          <button
            v-if="pane"
            type="button"
            class="nav-btn"
            title="导出这条分支为 Markdown（含模型/耗时/token）"
            @click="exportMd"
          >⤓</button>
          <template v-if="pane">
            <button
              type="button"
              class="nav-btn"
              title="上一回合（←）"
              :disabled="pane.index === 0"
              @click="stepTurn(-1)"
            >‹</button>
            <button
              type="button"
              class="nav-btn"
              title="下一回合（→）"
              :disabled="pane.index === pane.total - 1"
              @click="stepTurn(1)"
            >›</button>
          </template>
        </div>
        <span v-if="isRunning" class="ctx-running">○ 运行中</span>
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
            <div class="chain-label">上文链路</div>
            <p v-if="omittedCount > 0" class="chain-omitted">…更早 {{ omittedCount }} 个回合</p>
            <button
              v-for="(node, i) in contextTurns"
              :key="node.id"
              type="button"
              class="chain-card"
              title="跳到这个回合"
              @click="jumpTo(node)"
            >
              <span class="chain-step">{{ chainStart + i }}</span>
              <span class="chain-body">
                <span class="chain-title">
                  <span
                    v-if="node.sessionId !== store.selectedId"
                    class="chain-fork"
                    title="来自上游分支"
                  >⎇</span>
                  {{ node.title }}
                </span>
                <span class="chain-preview">{{
                  node.preview ||
                    (node.error
                      ? `⚠ ${node.error}`
                      : node.toolNames.length > 0
                        ? `(${node.toolNames.length} 个工具调用，无文本回复)`
                        : "(无文本回复)")
                }}</span>
              </span>
            </button>
          </div>
        </template>
      </MessageList>
      <FileChangesCard v-if="selectedSession && store.capabilities.fileChanges" />
      <div v-if="!selectedSession" class="ctx-empty">
        <p>左侧选会话，或在画布上点一张卡片。</p>
      </div>

      <ChatInput
        v-if="selectedSession"
        ref="chatInputEl"
        :running="isRunning"
        :model="paneModel"
        :models="store.models"
        :allow-attachments="store.capabilities.attachments"
        @send="send"
        @abort="abort"
        @set-model="onSetModel"
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { TurnNode } from "../../../shared/canvas-graph";
import type { ModelChoice, PromptAttachment, SessionSummary } from "../../../shared/types";
import { formatDuration, formatTokens } from "../format";
import {
  abortRun,
  activeChain,
  cancelComparePick,
  comparePlan,
  compareWithParent,
  exitCompare,
  exportBranchMarkdown,
  isTurnMarked,
  paneComposerModel,
  paneMessages,
  paneTurn,
  retryTurn,
  selectedSession,
  selectTurn,
  sendPanePrompt,
  setPaneModel,
  stepTurn,
  store,
  tagBg,
  tagColor,
  tagsOf,
  toggleTurnMark,
  turnGraph,
} from "../state";
import ChatInput from "./chat-input.vue";
import FileChangesCard from "./file-changes-card.vue";
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

/** The open comparison with its alignment plan, or null = normal pane. */
const compare = computed(() => {
  const pair = store.compare;
  if (!pair) return null;
  const plan = comparePlan.value;
  return plan ? { pair, plan } : null;
});

const sides = ["left", "right"] as const;

const pairRows = computed(() => {
  const plan = compare.value?.plan;
  if (!plan) return [];
  const rows: { left: TurnNode | null; right: TurnNode | null }[] = [];
  for (let i = 0; i < Math.max(plan.left.length, plan.right.length); i += 1) {
    rows.push({ left: plan.left[i] ?? null, right: plan.right[i] ?? null });
  }
  return rows;
});

const samePrompt = computed(() => {
  const plan = compare.value?.plan;
  if (!plan) return false;
  const [l, r] = [plan.left[0], plan.right[0]];
  return l != null && r != null && l.title !== "" && l.title === r.title;
});

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
  const bits = [`${own.length} 个回合`];
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

function previewOf(node: TurnNode): string {
  return (
    node.preview ||
    (node.error
      ? `⚠ ${node.error}`
      : node.toolNames.length > 0
        ? "(工具调用，无文本回复)"
        : "(无文本回复)")
  );
}

const openCells = ref(new Set<string>());

function toggleCell(node: TurnNode): void {
  const next = new Set(openCells.value);
  if (next.has(node.id)) next.delete(node.id);
  else next.add(node.id);
  openCells.value = next;
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

// A new pair (or compare closing) starts the lens from scratch; watching the
// state pair rather than the plan keeps graph re-layouts from resetting it.
watch(
  () => store.compare,
  () => {
    pagerPos.value = 0;
    prefixOpen.value = false;
    openCells.value = new Set();
    pairEls.clear();
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
  const bits = [`回合 ${current.index + 1}/${current.total}`];
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

const paneModel = paneComposerModel;

function onSetModel(model: ModelChoice | null): void {
  if (store.selectedId) setPaneModel(store.selectedId, model);
}

// ←/→ walk turns without leaving the pane — but never while typing somewhere.
// During a comparison they page the pair rows instead, and Esc leaves the
// comparison (or cancels a pending pick).
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
    stepPager(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (!pane.value) return;
  event.preventDefault();
  stepTurn(event.key === "ArrowLeft" ? -1 : 1);
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>
