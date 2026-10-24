<template>
  <main
    ref="viewportEl"
    class="viewport"
    :class="{ panning, 'path-drag-over': pathDragOver }"
    @wheel.prevent="onWheel"
    @mousedown="onMouseDown"
    @dragover.prevent="onPathDragOver"
    @dragleave="onPathDragLeave"
    @drop.prevent="onPathDrop"
  >
    <div class="world" :style="worldStyle">
      <svg class="edges" :width="svgSize.w" :height="svgSize.h">
        <defs>
          <marker
            id="parallel-summary-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" class="parallel-link-arrow" />
          </marker>
        </defs>
        <g v-for="edge in edgesWithPoints" :key="`${edge.from}->${edge.to}`">
          <template v-if="edge.severed">
            <!-- An empty-context fork: the line is cut in two, because context
                 does not cross it. Both halves keep the fork edge's own look. -->
            <path
              :d="edge.headPath"
              class="edge fork severed"
              :class="{
                active: onActivePath(edge),
                dim: hasActivePath && !onActivePath(edge),
                desc: isSubtreeEdge(edge),
                'cmp-el': cmpEdgeRole(edge) === 'l',
                'cmp-er': cmpEdgeRole(edge) === 'r',
                'cmp-edim': cmpEdgeRole(edge) === 'dim',
              }"
            />
            <path
              :d="edge.tailPath"
              class="edge fork severed"
              :class="{
                active: onActivePath(edge),
                dim: hasActivePath && !onActivePath(edge),
                desc: isSubtreeEdge(edge),
                'cmp-el': cmpEdgeRole(edge) === 'l',
                'cmp-er': cmpEdgeRole(edge) === 'r',
                'cmp-edim': cmpEdgeRole(edge) === 'dim',
              }"
            />
          </template>
          <path
            v-else
            :d="edge.path"
            class="edge"
            :class="{
              fork: edge.kind === 'fork',
              active: onActivePath(edge),
              dim: hasActivePath && !onActivePath(edge),
              desc: isSubtreeEdge(edge),
              'cmp-el': cmpEdgeRole(edge) === 'l',
              'cmp-er': cmpEdgeRole(edge) === 'r',
              'cmp-edim': cmpEdgeRole(edge) === 'dim',
            }"
          />
          <circle
            :cx="edge.ex"
            :cy="edge.ey"
            r="3.5"
            class="edge-dot"
            :class="{
              active: onActivePath(edge),
              dim: hasActivePath && !onActivePath(edge),
              desc: isSubtreeEdge(edge),
              'cmp-el': cmpEdgeRole(edge) === 'l',
              'cmp-er': cmpEdgeRole(edge) === 'r',
            }"
          />
        </g>
        <g
          v-for="links in parallelSummaryViews"
          :key="`parallel:${links.node.id}`"
          aria-hidden="true"
        >
          <path
            v-for="source in links.sources"
            :key="`${links.node.id}:${source.node.id}`"
            :d="source.path"
            class="edge parallel-link"
          />
          <path :d="links.trunkPath" class="edge parallel-link parallel-trunk" />
          <path
            :d="links.summaryPath"
            class="edge parallel-link parallel-summary-link"
            marker-end="url(#parallel-summary-arrow)"
          />
        </g>
        <path v-if="draftEdge" :d="draftEdge.path" class="edge draft-edge" />
      </svg>

      <!-- the ✂ badge filling a severed edge's gap; it sits in the world layer,
           so the branch keeps its marker however many turns it grows -->
      <span
        v-for="badge in cutBadges"
        :key="`cut:${badge.id}`"
        class="edge-cut-badge"
        :style="{ left: `${badge.x}px`, top: `${badge.y}px` }"
        :title="t('cut.markerTitle')"
        >✂</span
      >

      <article
        v-for="node in graph.nodes"
        :key="node.id"
        :ref="cardRef"
        :data-node-id="node.id"
        :data-drop="node.kind === 'turn' ? 'turn' : 'tip'"
        :data-session="node.sessionId"
        :data-message="node.messageId ?? ''"
        class="turn"
        :class="{
          'parallel-summary': isParallelSummary(node),
          selected: node.id === selectedTurnId,
          running: isNodeRunning(node),
          recent: isNodeRecent(node),
          stub: node.kind === 'stub',
          dimmed: cmpRole(node) ? cmpRole(node) === 'dim' : isDimmed(node),
          descendant: isSubtreeNode(node),
          hit: searchHitIds.has(node.id),
          marked: isTurnMarked(node.id),
          'cmp-l': cmpRole(node) === 'l',
          'cmp-r': cmpRole(node) === 'r',
          'cmp-anchor': cmpRole(node) === 'anchor',
          pickable: pickArmed,
          'drop-on': isDropTarget(node),
        }"
        :style="{
          left: `${node.x}px`,
          top: `${node.y}px`,
          width: `${NODE_WIDTH}px`,
          '--recent-alpha': recentAlpha(node),
        }"
        @mousedown.stop
        @click="selectNode(node)"
        @contextmenu.prevent="
          requestSessionMenu(
            node.sessionId,
            $event.clientX,
            $event.clientY,
            node.kind === 'turn' && node.messageId ? node.id : null,
          )
        "
      >
        <div
          v-if="node.sessionId === store.selectedId && storyTagColors.length > 0"
          class="story-bands"
          aria-hidden="true"
        >
          <span
            v-for="(color, i) in storyTagColors"
            :key="i"
            class="story-band"
            :style="{ background: color }"
          ></span>
        </div>
        <button
          v-if="isTurnDelete(node) ? store.capabilities.deleteMessage : store.capabilities.deleteSession"
          type="button"
          class="del-chip"
          :title="isTurnDelete(node) ? t('canvas.deleteTurnTitle') : t('canvas.deleteSessionTitle')"
          @click.stop="removeNode(node)"
        >🗑</button>
        <button
          v-if="node.kind === 'turn' && node.messageId"
          type="button"
          class="mark-chip"
          :class="{ on: isTurnMarked(node.id) }"
          :title="isTurnMarked(node.id) ? t('canvas.unmarkTitle') : t('canvas.markTitle')"
          @click.stop="toggleTurnMark(node)"
        >{{ isTurnMarked(node.id) ? "★" : "☆" }}</button>
        <button
          v-if="node.kind === 'turn' && node.error"
          type="button"
          class="retry-chip"
          :title="t('msg.retryTitle')"
          @click.stop="retryNode(node)"
        >↻</button>
        <button
          type="button"
          class="add-chip"
          :title="
            isParallelSummary(node)
              ? t('canvas.parallelContinueHint')
              : isSessionTip(node)
                ? t('canvas.continueBranchHint')
                : t('canvas.newBranchHint')
          "
          @click.stop="openDraft(node)"
        >
          ＋
        </button>
        <template v-if="node.kind === 'turn'">
          <div class="turn-head">
            <span class="avatar user">🍑</span>
            <span class="turn-title" :title="node.title">{{ node.title }}</span>
            <span v-if="isParallelSummary(node)" class="parallel-summary-badge">✦ {{ t("canvas.parallelSummary") }} v{{ parallelSummaryVersion(node) }}</span>
            <button
              v-else-if="parallelSourceOf(node)"
              type="button"
              class="parallel-source-badge"
              :title="
                t('canvas.parallelSourceHint', {
                  round: parallelSourceOf(node)?.round ?? 0,
                  index: parallelSourceOf(node)?.index ?? 0,
                  total: parallelSourceOf(node)?.total ?? 0,
                  model: parallelSourceOf(node)?.label ?? '',
                })
              "
              @click.stop="openParallelRound(parallelSourceOf(node)?.groupId ?? '')"
            >⇄ {{ t("canvas.parallelSource", { round: parallelSourceOf(node)?.round ?? 0, index: parallelSourceOf(node)?.index ?? 0, total: parallelSourceOf(node)?.total ?? 0 }) }}</button>
            <button
              v-if="forkCountOf(node) > 0"
              type="button"
              class="fork-chip"
              :title="t('canvas.turnForks', { n: forkCountOf(node) })"
              @click.stop="focusSubtree"
            >⎇ {{ forkCountOf(node) }}</button>
            <span
              class="turn-time"
              :class="{ recent: isNodeRecent(node) }"
            >{{ relativeTime(node.createdAt) }}</span>
          </div>
          <div class="turn-body">
            <span class="avatar bot">✨</span>
            <p class="turn-preview" :class="{ errored: !node.preview && node.error }">
              {{ previewOf(node) }}
            </p>
          </div>
          <div v-if="parallelSummaryOf(node)" class="parallel-summary-sources">
            <span>{{ t("canvas.parallelSources") }}</span>
            <button
              v-for="source in parallelSummaryOf(node)?.sources ?? []"
              :key="source.node.id"
              type="button"
              :title="t('canvas.parallelOpenSource', { model: source.label })"
              @click.stop="selectNode(source.node)"
            >{{ source.label }}</button>
          </div>
          <div v-if="node.toolNames.length > 0" class="chips">
            <span
              v-for="(name, i) in node.toolNames"
              :key="name"
              class="chip"
              :class="{ lav: i % 2 === 1 }"
            >{{ name }}</span>
          </div>
          <div class="turn-foot">
            <span v-if="isNodeRunning(node)" class="running-flag">{{ t("canvas.running") }}</span>
            <span v-else>{{ footMeta(node) }}</span>
            <span
              class="model"
              :title="modelTitle(node)"
            >{{ modelChip(node) }}</span>
          </div>
          <div v-if="node.error && !isNodeRunning(node)" class="error-acts">
            <button
              type="button"
              class="retry-now"
              :title="t('msg.retryTitle')"
              @click.stop="retryNode(node)"
            >{{ t("msg.retryButton") }}</button>
          </div>
        </template>
        <template v-else>
          <div class="turn-head">
            <span class="avatar user">🌱</span>
            <span class="turn-title" :title="node.title">{{ node.title }}</span>
            <button
              v-if="forkCountOf(node) > 0"
              type="button"
              class="fork-chip"
              :title="t('canvas.stubForks', { n: forkCountOf(node) })"
              @click.stop="focusSubtree"
            >⎇ {{ forkCountOf(node) }}</button>
          </div>
          <p class="stub-hint">{{ t("canvas.stubHint") }}</p>
        </template>
      </article>

      <article
        v-if="draftNode"
        :ref="draftRef"
        class="draft"
        :class="{ 'drop-on': dropTarget?.kind === 'draft' }"
        :style="{ left: `${draftX}px`, top: `${draftY}px` }"
        data-drop="draft"
        :data-session="store.draft?.sessionId ?? ''"
        @mousedown.stop
      >
        <div class="draft-head">
          <span class="draft-tag"
            >{{ t("canvas.draft") }} ·
            {{ store.draft?.atMessageId == null ? t("canvas.continueBranch") : t("canvas.newBranch") }}</span
          >
          <button
            v-if="store.draft?.atMessageId != null"
            type="button"
            class="draft-ctx"
            :class="{ on: store.draft?.contextMode === 'none' }"
            :title="
              store.draft?.contextMode === 'none'
                ? t('canvas.ctxNoneTitle')
                : t('canvas.ctxInheritTitle')
            "
            @click="
              setDraftContextMode(store.draft?.contextMode === 'none' ? 'inherit' : 'none')
            "
          >{{
            store.draft?.contextMode === "none"
              ? `✂ ${t("canvas.ctxNoneLabel")}`
              : `⛓ ${t("canvas.ctxInheritLabel")}`
          }}</button>
          <button type="button" class="close" @click="dismissDraft">✕</button>
        </div>
        <div v-if="(store.draft?.attachments.length ?? 0) > 0" class="draft-atts">
          <span v-for="a in store.draft?.attachments ?? []" :key="a.id" class="att-chip">
            <img
              v-if="a.mime.startsWith('image/')"
              :src="a.dataUrl"
              class="att-thumb"
              alt=""
            />
            <span v-else class="att-ico">📎</span>
            <span class="att-name" :title="a.name">{{ a.name }}</span>
            <button
              type="button"
              class="att-x"
              :title="t('canvas.remove')"
              @click="removeDraftAttachment(a.id)"
            >✕</button>
          </span>
        </div>
        <textarea
          ref="draftTextarea"
          :value="store.draft?.text"
          :placeholder="store.draft?.atMessageId == null ? t('canvas.phContinue') : t('canvas.phNew')"
          @input="setDraftText(($event.target as HTMLTextAreaElement).value)"
          @keydown.meta.enter.prevent="submitDraft"
          @keydown.ctrl.enter.prevent="submitDraft"
          @keydown.esc="onDraftEsc"
          @paste="onDraftPaste"
        ></textarea>
        <div class="draft-foot">
          <ModelPicker
            class="draft-model"
            :model-value="store.draft?.model ?? null"
            :models="store.models"
            :favorite-models="store.favoriteModels"
            :recent-models="store.recentModels"
            :title="t('canvas.branchModelTitle')"
            @update:model-value="setDraftModel"
            @toggle-favorite="toggleFavoriteModel"
          />
          <VariantPicker
            :model="store.draft?.model ?? null"
            :models="store.models"
            @select="setDraftVariant"
          />
          <button
            v-if="canDraftParallel"
            type="button"
            class="draft-parallel"
            :class="{ on: draftParallel }"
            :title="t('input.parallelMode')"
            :aria-pressed="draftParallel"
            @click="toggleDraftParallel"
          >⇄</button>
          <button
            v-if="draftParallel"
            type="button"
            class="draft-parallel-pick"
            :class="{ warn: draftParallelTargets.length < 2 }"
            :title="draftParallelTargets.length < 2 ? t('input.parallelNeedTwo') : undefined"
            @click="draftModelDialogOpen = true"
          >{{ draftParallelTargets.length }} · {{ t("input.parallelAddModel") }}</button>
          <button
            type="button"
            class="send-btn"
            :disabled="!store.draft?.text.trim() || store.draftSending || (draftParallel && draftParallelTargets.length < 2)"
            :title="draftParallel && draftParallelTargets.length < 2 ? t('input.parallelNeedTwo') : undefined"
            @click="submitDraft"
          >{{ store.draftSending ? "…" : "➤" }}</button>
          <span class="hint">{{ draftParallel && draftParallelTargets.length < 2 ? t("input.parallelNeedTwo") : t("canvas.draftHint") }}</span>
        </div>
      </article>
      <ParallelModelDialog
        v-model:open="draftModelDialogOpen"
        :models="store.models"
        :favorite-models="store.favoriteModels"
        :recent-models="store.recentModels"
        :max="MAX_PARALLEL_TARGETS"
        :targets="draftParallelTargets"
        @update:targets="draftParallelTargets = $event"
        @toggle-favorite="toggleFavoriteModel"
      />
    </div>

    <div v-if="graph.nodes.length === 0 && store.connectionError" class="canvas-empty">
      <div class="empty-mascot">🔌</div>
      <p class="empty-title">{{ t("canvas.offlineTitle", { backend: backendLabel }) }}</p>
      <p class="empty-sub">{{ t("canvas.offlineSub") }}</p>
    </div>
    <div
      v-else-if="graph.nodes.length === 0 && !store.booted && !store.loadingMessages"
      class="canvas-loading"
    >{{ t("canvas.connecting", { backend: backendLabel }) }}</div>
    <div
      v-else-if="graph.nodes.length === 0 && !store.loadingMessages && selectedSessionEmpty"
      class="canvas-empty"
    >
      <div class="empty-mascot">✨</div>
      <p class="empty-title">{{ t("canvas.emptyConvTitle") }}</p>
      <p class="empty-sub">{{ t("canvas.emptyConvSub") }}</p>
    </div>
    <div v-else-if="graph.nodes.length === 0 && !store.loadingMessages" class="canvas-empty">
      <div class="empty-mascot">🍑</div>
      <p class="empty-title">{{ t("canvas.noSessionsTitle") }}</p>
      <p class="empty-sub">{{ t("canvas.noSessionsSub", { backend: backendLabel }) }}</p>
    </div>
    <div v-if="store.loadingMessages" class="canvas-loading">{{ t("canvas.layingOut") }}</div>

    <div class="canvas-status">
      {{ t("canvas.status", { nodes: graph.nodes.length, sessions: sequenceCount, forks: forkCount }) }}
    </div>

    <div v-if="pickArmed" class="pick-banner">
      <span>{{ t("canvas.pickBanner", { title: pickFromTitle }) }}</span>
      <button type="button" :title="t('canvas.cancelEsc')" @click="cancelComparePick()">✕</button>
    </div>
    <div class="canvas-tools">
      <div class="zoom-ctl">
        <button type="button" @click="zoomBy(0.85)">−</button>
        <span>{{ Math.round(scale * 100) }}%</span>
        <button type="button" @click="zoomBy(1.18)">＋</button>
      </div>
      <button type="button" class="fit-btn" :title="t('canvas.fitView')" @click="fitView">⛶</button>
    </div>

    <!-- Search & digest overlays: mousedown/wheel stay inside them so pans and
         zooms never fire while the user works the lists. -->
    <div class="canvas-panels" @mousedown.stop @wheel.stop>
      <StorySearch @jump="centerOnNode" />
      <BranchDigest @jump="centerOnNode" />
      <MarksPanel @jump="centerOnNode" />
    </div>

    <div
      v-if="showMinimap"
      ref="minimapEl"
      class="minimap"
      @mousedown.stop.prevent="onMinimapDown"
      @wheel="onMinimapWheel"
    >
      <!-- The layer carries the map's zoom as one transform; the dots keep
           their static fit positions, so panning/zooming never rewrites
           per-node styles (that churn was the jank on large graphs). -->
      <div class="mm-layer" :style="mmLayerStyle">
        <div
          v-for="n in mmNodes"
          :key="`mm-${n.id}`"
          class="mm-node"
          :class="{
            stub: n.kind === 'stub',
            on: activePathIds.has(n.id),
            desc: isMapSubtree(n),
            running: isNodeRunning(n),
            recent: isNodeRecent(n),
            hit: searchHitIds.has(n.id),
            marked: isTurnMarked(n.id),
          }"
          :style="{ ...mmNodeStyle(n), '--recent-alpha': recentAlpha(n) }"
        ></div>
      </div>
      <div class="mm-view" :style="mmViewStyle"></div>
      <div class="mm-hint">{{ t("canvas.mmHint") }}</div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { fileKind } from "../../../shared/attachment-kinds";
import { BACKEND_LABELS } from "../../../shared/backend";
import type { TurnNode } from "../../../shared/canvas-graph";
import { COL_GAP, draftCellFor, NODE_WIDTH } from "../../../shared/canvas-graph";
import type { ModelChoice } from "../../../shared/types";
import { type DraftAttachment, readAttachments } from "../attachments";
import { flashNotice, isPathDrag, readPathDrop } from "../files";
import { formatDuration, formatTokens } from "../format";
import { t } from "../i18n";
import { joinPaths } from "../path-insert";
import { MAX_PARALLEL_TARGETS, settings } from "../settings";
import {
  activeChain,
  cancelComparePick,
  cardHeights,
  childTurnIds,
  comparePlan,
  defaultParallelTargets,
  deleteSession,
  deleteTurn,
  dismissDraft,
  enterCompare,
  forkedFromSelection,
  insertDraftText,
  isSessionTip,
  isTurnDelete,
  isTurnMarked,
  openDraft,
  parallelGroups,
  recentAlphaFor,
  requestSessionMenu,
  retryNode,
  selectSession,
  selectTurn,
  sendDraft,
  sendDraftParallel,
  setActiveCanvasTabView,
  setDraftAttachments,
  setDraftContextMode,
  setDraftModel,
  setDraftText,
  setDraftVariant,
  store,
  storySearchHits,
  tagColor,
  tagsOf,
  toggleFavoriteModel,
  toggleTurnMark,
  turnGraph,
} from "../state";
import BranchDigest from "./branch-digest.vue";
import MarksPanel from "./marks-panel.vue";
import ModelPicker from "./model-picker.vue";
import ParallelModelDialog from "./parallel-model-dialog.vue";
import StorySearch from "./story-search.vue";
import VariantPicker from "./variant-picker.vue";

const viewportEl = ref<HTMLElement | null>(null);
const scale = ref(1);
const tx = ref(0);
const ty = ref(0);
const panning = ref(false);
let loadingAnchorId: string | null = null;
let loadingAnchorFrame: number | null = null;

const graph = computed(() => turnGraph.value);
const selectedTurnId = computed(() => store.selectedTurnId);

/**
 * Zero canvas nodes because the selected session itself is empty (loaded,
 * message-less): a brand-new conversation waiting for its first prompt —
 * distinct from a project with no sessions at all.
 */
const selectedSessionEmpty = computed(() => {
  const id = store.selectedId;
  if (!id) return false;
  const messages = store.messagesBySession[id];
  return messages != null && messages.length === 0;
});

/** Backend whose canvas is (or is coming) on screen — drives the connect /
 *  offline copy, which is otherwise opencode-specific by accident of birth. */
const backendLabel = computed(() => BACKEND_LABELS[store.activeBackend]);

const worldStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}));

/**
 * The selected branch's tag colors — each of its own cards carries one
 * stacked band per tag on its left edge, so a multi-labeled branch reads as
 * a small stripe group instead of an arbitrary "first tag" pick. Bands mark
 * the session's own turns only: child forks and the inherited parent prefix
 * stay unmarked (the template gates on node.sessionId).
 */
const storyTagColors = computed(() => {
  const id = store.selectedId;
  return id ? tagsOf(id).map((tag) => tagColor(tag)) : [];
});

const svgSize = computed(() => {
  const maxX = Math.max(0, ...graph.value.nodes.map((n) => n.x + NODE_WIDTH + 100));
  const maxY = Math.max(0, ...graph.value.nodes.map((n) => n.y + n.height + 100));
  return { w: maxX, h: maxY };
});

const nodeById = computed(() => new Map(graph.value.nodes.map((n) => [n.id, n])));

interface ParallelSourceNode {
  node: TurnNode;
  label: string;
  path: string;
}

interface ParallelSummaryLinks {
  node: TurnNode;
  version: number;
  sources: ParallelSourceNode[];
  trunkPath: string;
  summaryPath: string;
}

/**
 * The first turn of a summary session is the canvas summary card. Its source
 * turns are linked through the open column gap beside the native fork cards,
 * keeping the existing session layout and all normal card actions intact.
 */
const parallelSummaryViews = computed<ParallelSummaryLinks[]>(() => {
  const result: ParallelSummaryLinks[] = [];
  for (const group of parallelGroups) {
    if (group.backend !== store.activeBackend) continue;
    for (const version of group.summaryVersions) {
      const summaryMessage = store.messagesBySession[version.sessionId]?.find(
        (message) => message.role === "user",
      );
      if (!summaryMessage) continue;
      const summaryNode = nodeById.value.get(`${version.sessionId}:${summaryMessage.id}`);
      if (!summaryNode) continue;

      const sources = version.sources.flatMap((source): ParallelSourceNode[] => {
        const baseline = new Set(source.baselineMessageIds);
        const sourceMessage = store.messagesBySession[source.sessionId]?.findLast(
          (message) =>
            message.role === "user" && message.text === group.prompt && !baseline.has(message.id),
        );
        const sourceNode = sourceMessage
          ? nodeById.value.get(`${source.sessionId}:${sourceMessage.id}`)
          : undefined;
        if (!sourceNode) return [];
        return [{ node: sourceNode, label: source.label, path: "" }];
      });

      const busX =
        Math.max(summaryNode.x, ...sources.map((source) => source.node.x)) +
        NODE_WIDTH +
        COL_GAP / 2;
      const summaryY = summaryNode.y + summaryNode.height / 2;
      for (const source of sources) {
        const y = source.node.y + source.node.height / 2;
        source.path = `M ${source.node.x + NODE_WIDTH} ${y} H ${busX}`;
      }
      const ys = [...sources.map((source) => source.node.y + source.node.height / 2), summaryY];
      result.push({
        node: summaryNode,
        version: version.version,
        sources,
        trunkPath: ys.length > 1 ? `M ${busX} ${Math.min(...ys)} V ${Math.max(...ys)}` : "",
        summaryPath: sources.length ? `M ${busX} ${summaryY} H ${summaryNode.x + NODE_WIDTH}` : "",
      });
    }
  }
  return result;
});

const parallelSummaryByNode = computed(
  () => new Map(parallelSummaryViews.value.map((links) => [links.node.id, links])),
);

function parallelSummaryOf(node: TurnNode): ParallelSummaryLinks | null {
  return parallelSummaryByNode.value.get(node.id) ?? null;
}

function isParallelSummary(node: TurnNode): boolean {
  return parallelSummaryByNode.value.has(node.id);
}

/**
 * The round a source fork belongs to, so its card says what it is: without
 * this the fork cards of one round look like unrelated branches, and the pane
 * (which reads them as one reading group) has no counterpart on the canvas.
 */
interface ParallelSourceBadge {
  groupId: string;
  /** 1-based ordinal of the round on this canvas, oldest first. */
  round: number;
  label: string;
  /** 1-based position of this fork within its round. */
  index: number;
  total: number;
}

const parallelSourceByNode = computed(() => {
  const badges = new Map<string, ParallelSourceBadge>();
  const rounds = parallelGroups.filter((group) => group.backend === store.activeBackend);
  for (const [roundIndex, group] of rounds.entries()) {
    for (const [targetIndex, target] of group.targets.entries()) {
      if (!target.sessionId) continue;
      // The turn this round added, not an inherited copy of the question.
      const baseline = new Set(target.baselineMessageIds);
      const message = store.messagesBySession[target.sessionId]?.findLast(
        (row) => row.role === "user" && row.text === group.prompt && !baseline.has(row.id),
      );
      if (!message) continue;
      badges.set(`${target.sessionId}:${message.id}`, {
        groupId: group.id,
        round: roundIndex + 1,
        label: target.label,
        index: targetIndex + 1,
        total: group.targets.length,
      });
    }
  }
  return badges;
});

function parallelSourceOf(node: TurnNode): ParallelSourceBadge | null {
  return parallelSourceByNode.value.get(node.id) ?? null;
}

/** Open a round's reading view from any of its cards. */
function openParallelRound(groupId: string): void {
  const group = parallelGroups.find((item) => item.id === groupId);
  if (!group) return;
  // The newest summary session names this round unambiguously; the anchor
  // would resolve to whichever round is newest for that session.
  const landing =
    group.summaryVersions.at(-1)?.sessionId ?? group.summarySessionId ?? group.anchorSessionId;
  void selectSession(landing);
}

function parallelSummaryVersion(node: TurnNode): number | null {
  return parallelSummaryOf(node)?.version ?? null;
}

// ── active path: the selected turn's lineage back to the story's root ──
// Shared with the pane's context chain — state.activeChain is the source.

const activePathIds = computed(() => new Set(activeChain.value.map((n) => n.id)));

const hasActivePath = computed(() => activeChain.value.length > 0);

/** Story-search matches: while a query is live, every hit card gets a ring. */
const searchHitIds = computed(() => new Set(storySearchHits.value.map((h) => h.nodeId)));

/** An edge is on the active path when both ends are on it (nodes have one incoming edge). */
function onActivePath(edge: { from: string; to: string }): boolean {
  const ids = activePathIds.value;
  return ids.has(edge.from) && ids.has(edge.to);
}

// ── direct children of the selected turn ──────────────────────────────
// The active path lights a selection's ancestors; everything else used to
// dim except the selected session's whole fork subtree, which swept in
// branches unrelated to the picked turn. Now only the selected turn's
// direct children — the next turn on the same line plus the first card of
// each branch forked from it — keep a notch of highlight; sibling forks
// and deeper generations sit at the plain card style.

function isOffPath(node: TurnNode): boolean {
  return hasActivePath.value && !activePathIds.value.has(node.id);
}

/** Off the active path but a direct child of the selected turn. */
function isSubtreeNode(node: TurnNode): boolean {
  return isOffPath(node) && childTurnIds.value.has(node.id);
}

function isDimmed(node: TurnNode): boolean {
  return isOffPath(node) && !childTurnIds.value.has(node.id);
}

/** Edge into a direct child — sequence or fork, the card it lands on decides. */
function isSubtreeEdge(edge: { from: string; to: string }): boolean {
  return hasActivePath.value && childTurnIds.value.has(edge.to);
}

/**
 * Fork-source cards of the selected session: node id → count of branches
 * leaving it. Drives the ⎇ N badge — deep branches ride their own parents'
 * badges once those sessions are selected.
 */
const directForkCounts = computed<Map<string, number>>(() => {
  const counts = new Map<string, number>();
  if (!store.selectedId) return counts;
  for (const edge of graph.value.edges) {
    if (edge.kind !== "fork") continue;
    const from = nodeById.value.get(edge.from);
    if (from?.sessionId === store.selectedId) {
      counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
    }
  }
  return counts;
});

function forkCountOf(node: TurnNode): number {
  return node.sessionId === store.selectedId ? (directForkCounts.value.get(node.id) ?? 0) : 0;
}

/**
 * Split a cubic bezier at `t`, returning both halves as their own control
 * polygons (de Casteljau). Used to cut a real gap out of an empty-context
 * fork edge: context does not flow across that edge, so the line is severed.
 */
function splitCubic(
  curve: ReadonlyArray<readonly [number, number]>,
  t: number,
): [[number, number][], [number, number][]] {
  const [p0, p1, p2, p3] = curve as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  const lerp = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const mid = lerp(d, e);
  return [
    [[...p0], a, d, mid],
    [mid, e, c, [...p3]],
  ];
}

function cubicPath(curve: ReadonlyArray<readonly [number, number]>): string {
  const [p0, p1, p2, p3] = curve;
  if (!p0 || !p1 || !p2 || !p3) return "";
  return `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
}

/** Half-width of the gap cut out of an empty-context edge, in curve-length fraction. */
const CUT_GAP = 0.075;

/**
 * One drawn edge. Severed edges carry the two halves of the curve instead of
 * a single path, plus the gap's midpoint where the ✂ badge sits.
 */
interface DrawnEdge {
  from: string;
  to: string;
  kind: "sequence" | "fork";
  ex: number;
  ey: number;
  severed: boolean;
  /** Whole curve; empty on a severed edge. */
  path: string;
  /** The two halves of a severed edge; empty on an intact one. */
  headPath: string;
  tailPath: string;
  cutX: number;
  cutY: number;
}

const edgesWithPoints = computed<DrawnEdge[]>(() =>
  graph.value.edges.flatMap((edge): DrawnEdge[] => {
    const from = nodeById.value.get(edge.from);
    const to = nodeById.value.get(edge.to);
    if (!from || !to) return [];
    const x1 = from.x + NODE_WIDTH;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const bend = Math.max(46, (x2 - x1) / 2);
    const curve: [number, number][] = [
      [x1, y1],
      [x1 + bend, y1],
      [x2 - bend, y2],
      [x2, y2],
    ];
    const base = {
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ex: x2 - 2,
      ey: y2,
    };

    if (edge.kind === "fork" && edge.context === "none") {
      const t1 = 0.5 - CUT_GAP;
      const t2 = 0.5 + CUT_GAP;
      // Split at t2 first, then cut the front piece at t1 (its parameter is
      // measured on the original curve, so rescale by t2).
      const [front, back] = splitCubic(curve, t2);
      const [head] = splitCubic(front, t1 / t2);
      const [m0, m1, m2, m3] = curve as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      return [
        {
          ...base,
          severed: true,
          path: "",
          headPath: cubicPath(head),
          tailPath: cubicPath(back),
          cutX: (m0[0] + 3 * m1[0] + 3 * m2[0] + m3[0]) / 8,
          cutY: (m0[1] + 3 * m1[1] + 3 * m2[1] + m3[1]) / 8,
        },
      ];
    }

    return [
      {
        ...base,
        severed: false,
        path: cubicPath(curve),
        headPath: "",
        tailPath: "",
        cutX: 0,
        cutY: 0,
      },
    ];
  }),
);

/** The ✂ badges sitting in the gaps of severed fork edges. */
const cutBadges = computed(() =>
  edgesWithPoints.value.flatMap((edge) =>
    edge.severed ? [{ id: `${edge.from}->${edge.to}`, x: edge.cutX, y: edge.cutY }] : [],
  ),
);

const sequenceCount = computed(() => new Set(graph.value.nodes.map((n) => n.sessionId)).size);
const forkCount = computed(() => graph.value.edges.filter((e) => e.kind === "fork").length);

const draftNode = computed(() =>
  store.draft ? (nodeById.value.get(store.draft.nodeId) ?? null) : null,
);
// The draft floats in the branch's next free cell — the exact spot the sent
// turn's card will take — so the composer reads as the story's next card.
const draftCell = computed(() => {
  const anchor = draftNode.value;
  if (!anchor || !store.draft) return null;
  return draftCellFor(anchor, store.draft.atMessageId, graph.value.nodes);
});
const draftX = computed(() => draftCell.value?.x ?? 0);
const draftY = computed(() => draftCell.value?.y ?? 0);

// Measured draft height keeps the connector pinned to the box's left edge
// (attachment chips grow the box; the textarea inside is fixed).
const draftBoxHeight = ref(220);
let observedDraft: HTMLElement | null = null;
const draftObserver = new ResizeObserver((entries) => {
  const height = entries[0]?.borderBoxSize?.[0]?.blockSize;
  if (height) draftBoxHeight.value = Math.round(height);
});
/** Template ref for the draft box: move the observer to the live element. */
function draftRef(el: unknown): void {
  const box = el as HTMLElement | null;
  if (observedDraft && observedDraft !== box) draftObserver.unobserve(observedDraft);
  observedDraft = box;
  if (box) {
    draftBoxHeight.value = box.offsetHeight || 220;
    draftObserver.observe(box);
  }
}

/** Connector from the anchor card into the draft — the same bezier the tree
 *  edges use, dashed (see .edge.draft-edge) because the turn isn't sent yet. */
const draftEdge = computed(() => {
  const anchor = draftNode.value;
  if (!anchor) return null;
  const x1 = anchor.x + NODE_WIDTH;
  const y1 = anchor.y + anchor.height / 2;
  const x2 = draftX.value;
  const y2 = draftY.value + draftBoxHeight.value / 2;
  const bend = Math.max(46, (x2 - x1) / 2);
  return { path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` };
});

function selectNode(node: TurnNode): void {
  // Armed pick mode: the next card from another session completes the pair.
  const from = store.comparePickFrom;
  if (from != null) {
    if (node.sessionId === from) {
      cancelComparePick();
      return;
    }
    void enterCompare(from, node.sessionId);
    return;
  }
  void selectTurn(node);
}

// ── ⇄ compare highlighting ──────────────────────────────────────────
// While a comparison is open the canvas becomes its map: lavender rings the
// left branch's cards, mint the right's, the fork anchor gets the dashed
// orange frame, and cards outside the two paths fade. The shared trunk keeps
// its normal look — both columns collapsed it into the prefix band.

type CmpRole = "l" | "r" | "anchor" | "dim" | null;

const compareSets = computed(() => {
  const plan = comparePlan.value;
  if (!plan) return null;
  return {
    anchor: plan.anchor.id,
    left: new Set(plan.left.map((n) => n.id)),
    right: new Set(plan.right.map((n) => n.id)),
    common: new Set(plan.common.map((n) => n.id)),
  };
});

function cmpRole(node: TurnNode): CmpRole {
  const sets = compareSets.value;
  if (!sets) return null;
  if (node.id === sets.anchor) return "anchor";
  if (sets.left.has(node.id)) return "l";
  if (sets.right.has(node.id)) return "r";
  if (sets.common.has(node.id)) return null;
  return "dim";
}

/** Edge tint during compare: the anchor's two fork-out edges split l/r. */
function cmpEdgeRole(edge: { from: string; to: string }): CmpRole {
  const sets = compareSets.value;
  if (!sets) return null;
  if (edge.from === sets.anchor) {
    if (sets.left.has(edge.to)) return "l";
    if (sets.right.has(edge.to)) return "r";
  }
  if (sets.left.has(edge.from) && sets.left.has(edge.to)) return "l";
  if (sets.right.has(edge.from) && sets.right.has(edge.to)) return "r";
  return sets.common.has(edge.from) && sets.common.has(edge.to) ? null : "dim";
}

const pickArmed = computed(() => store.comparePickFrom != null);

const pickFromTitle = computed(
  () => store.sessions.find((s) => s.id === store.comparePickFrom)?.title ?? "",
);

function submitDraft(): void {
  if (draftParallel.value) {
    void submitDraftParallel();
    return;
  }
  void sendDraft();
}

// ── draft multi-model entry ────────────────────────────────────────
// The canvas draft sends the same round the pane composer does; only the
// anchor differs (the draft's own session and fork point).

const draftParallel = ref(false);
const draftParallelTargets = ref<(ModelChoice | null)[]>([]);
const draftModelDialogOpen = ref(false);
const canDraftParallel = computed(() => settings.labs.parallelModels && store.models.length > 0);

function toggleDraftParallel(): void {
  draftParallel.value = !draftParallel.value;
  if (!draftParallel.value) return;
  if (draftParallelTargets.value.length === 0) {
    draftParallelTargets.value = defaultParallelTargets(store.models);
  }
  // Nothing usable from the defaults: open the picker so the round can be
  // configured before it can be sent.
  if (draftParallelTargets.value.length < 2) draftModelDialogOpen.value = true;
}

async function submitDraftParallel(): Promise<void> {
  if (store.draftSending) return;
  if (draftParallelTargets.value.length < 2) {
    flashNotice(t("input.parallelNeedTwo"));
    return;
  }
  const accepted = await sendDraftParallel(draftParallelTargets.value, {
    model: settings.labs.parallel.summaryModel ? { ...settings.labs.parallel.summaryModel } : null,
    length: settings.labs.parallel.summaryLength,
  });
  if (!accepted) return;
  // state.ts already spent the draft; only the local round state is ours.
  draftParallel.value = false;
  draftParallelTargets.value = [];
}

/** Esc closes the draft — except while an IME composition owns the key. */
function onDraftEsc(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  dismissDraft();
}

/**
 * 🗑 deletes one turn at the session's tip, the whole session everywhere
 * else. Turn deletes are final — confirm stands. Session deletes ride the
 * undo toast, so they go straight through.
 */
function removeNode(node: TurnNode): void {
  if (isTurnDelete(node)) {
    // Turn deletes have no undo, so the confirmation is on by default; the
    // settings page can turn it off for people who prefer the speed.
    const ok =
      !settings.canvas.confirmDelete ||
      window.confirm(t("canvas.confirmDeleteTurn", { title: node.title }));
    if (ok) void deleteTurn(node);
    return;
  }
  if (!store.capabilities.deleteSession) return;
  void deleteSession(node.sessionId);
}

// ── draft model picker ──────────────────────────────────────────────
// ModelPicker emits a ModelChoice directly — no string encoding needed.

// ── pan / zoom / fit ────────────────────────────────────────────────

// The in-flight drag's window listeners (canvas pan or minimap); only one
// pointer drag can be live at a time, and an unmount mid-drag must drop them.
let activeDrag: { move: (event: MouseEvent) => void; up: () => void } | null = null;

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  loadingAnchorId = null;
  userAdjustedView = true;
  overviewProvisional = false;
  panning.value = true;
  const startX = event.clientX - tx.value;
  const startY = event.clientY - ty.value;
  const move = (moveEvent: MouseEvent): void => {
    tx.value = moveEvent.clientX - startX;
    ty.value = moveEvent.clientY - startY;
  };
  const up = (): void => {
    panning.value = false;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    activeDrag = null;
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  activeDrag = { move, up };
}

function onWheel(event: WheelEvent): void {
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect) return;
  zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.08 : 0.93);
}

function zoomBy(factor: number): void {
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect) return;
  zoomAt(rect.width / 2, rect.height / 2, factor);
}

function zoomAt(px: number, py: number, factor: number): void {
  loadingAnchorId = null;
  userAdjustedView = true;
  overviewProvisional = false;
  const next = Math.min(1.8, Math.max(0.45, scale.value * factor));
  const applied = next / scale.value;
  tx.value = px - (px - tx.value) * applied;
  ty.value = py - (py - ty.value) * applied;
  scale.value = next;
}

/** Frame exactly these nodes; the shared math behind fit-to-view and subtree focus. */
function fitTo(nodes: TurnNode[]): void {
  loadingAnchorId = null;
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect || nodes.length === 0) return;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const padding = 48;
  const boundsW = maxX - minX + padding * 2;
  const boundsH = maxY - minY + padding * 2;
  // Overview only: never shrink so far that cards become unreadable dots.
  scale.value = Math.min(1, Math.max(0.2, Math.min(rect.width / boundsW, rect.height / boundsH)));
  tx.value = (rect.width - boundsW * scale.value) / 2 - (minX - padding) * scale.value;
  ty.value = (rect.height - boundsH * scale.value) / 2 - (minY - padding) * scale.value;
}

function fitView(): void {
  fitTo(graph.value.nodes);
}

// ── canvas tabs: park / restore the camera ──────────────────────────
// The live camera is written into the active tab's slot on every change, so
// switching away never loses it; activation replays the saved transform and
// hands the camera to the user (no re-fit, no overview flash).

watch([scale, tx, ty], () => {
  setActiveCanvasTabView({ scale: scale.value, tx: tx.value, ty: ty.value });
});

watch(
  () => store.canvasTabRestoreRequest,
  (request) => {
    if (!request) return;
    const view = store.canvasTabViews[request.tabId];
    if (!view) return;
    scale.value = view.scale;
    tx.value = view.tx;
    ty.value = view.ty;
    userAdjustedView = true;
    overviewProvisional = false;
    overviewShown = true;
    centeredFor = store.selectedId;
    pendingFocus = null;
    pendingJump = null;
    loadingAnchorId = null;
  },
);

/** ⎇ badge click: pull the selected session's whole fork subtree into view. */
function focusSubtree(): void {
  userAdjustedView = true;
  overviewProvisional = false;
  const ids = new Set(forkedFromSelection.value);
  if (store.selectedId) ids.add(store.selectedId);
  fitTo(graph.value.nodes.filter((n) => ids.has(n.sessionId)));
}

function centerOnSession(sessionId: string): void {
  const node = nodesOf(sessionId)[nodesOf(sessionId).length - 1];
  if (node) centerOnNode(node);
}

/** Search hits and digest rows land here: put one node in the middle of view. */
function centerOnNode(node: TurnNode): void {
  scale.value = Math.max(scale.value, 0.85);
  alignNode(node);
  loadingAnchorId = store.loadingCanvas ? node.id : null;
}

/** Keep a requested focus in place while sibling cards change row-band heights. */
function alignNode(node: TurnNode): void {
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect) return;
  tx.value = rect.width / 2 - (node.x + NODE_WIDTH / 2) * scale.value;
  ty.value = rect.height / 2 - (node.y + node.height / 2) * scale.value;
}

// Real directories can hold hundreds of sessions — fitting everything would
// shrink the graph into dust. Open focused on the selected session's latest
// node; only small graphs get the full overview. Sidebar focus requests
// re-center on demand, retried once the session's messages (and therefore
// its nodes) have loaded.
const OVERVIEW_NODE_LIMIT = 18;
let centeredFor: string | null = null;
let pendingFocus: string | null = null;
// A context-chain jump still waiting for its node to land on the canvas — the
// branch switch can be loading messages / re-laying-out the graph.
let pendingJump: string | null = null;
// fitView() as the initial overview leaves centeredFor null — remember it ran,
// so later graph changes (a branch switch reshaping the canvas) never re-fit
// and flash the whole-graph view before a jump lands.
let overviewShown = false;
// The overview above was taken while sibling branches were still loading: the
// graph can still grow and re-band its rows, so the framing is provisional
// until the batch settles. Handing the view back to openInitialView at that
// point is what keeps the selected card on screen.
let overviewProvisional = false;
// Any manual pan / zoom / fit hands the camera to the user for good — the
// load-settle pass must not yank the view back afterwards.
let userAdjustedView = false;

function nodesOf(sessionId: string | null): TurnNode[] {
  if (!sessionId) return [];
  return graph.value.nodes.filter((n) => n.sessionId === sessionId);
}

function openInitialView(): void {
  if (graph.value.nodes.length === 0) return;
  // "Fit view on open" off: open on the selected branch's latest card at the
  // current zoom instead of shrinking the whole tree into the viewport.
  const fits = settings.canvas.autoFit;
  if (fits && graph.value.nodes.length <= OVERVIEW_NODE_LIMIT) {
    fitView();
    overviewShown = true;
    overviewProvisional = store.loadingCanvas;
    return;
  }
  overviewProvisional = false;
  if (store.selectedId && nodesOf(store.selectedId).length > 0) {
    focusNow(store.selectedId);
  }
}

function focusNow(sessionId: string): void {
  centerOnSession(sessionId);
  centeredFor = sessionId;
  pendingFocus = null;
}

/** Center on the pending chain jump once its node exists; false = still waiting. */
function resolvePendingJump(): boolean {
  if (!pendingJump) return true;
  const node = nodeById.value.get(pendingJump);
  if (!node) return false;
  centerOnNode(node);
  pendingJump = null;
  return true;
}

watch(graph, () => {
  // The selected branch and ancestors establish its identity and fork point.
  if (store.loadingMessages) return;
  if (pendingJump) {
    resolvePendingJump();
    return;
  }
  if (pendingFocus) {
    if (nodesOf(pendingFocus).length > 0) focusNow(pendingFocus);
    return;
  }
  if (loadingAnchorId) {
    const anchor = nodeById.value.get(loadingAnchorId);
    if (anchor) alignNode(anchor);
  }
  if (centeredFor === null && !overviewShown) openInitialView();
  // The provisional overview was framed on a partial graph. Once sibling
  // branches push it past the overview limit, the whole-graph fit stops being
  // the right framing — hand the camera to the selected branch, whose anchor
  // then survives every further row re-band.
  if (
    overviewProvisional &&
    graph.value.nodes.length > OVERVIEW_NODE_LIMIT &&
    centeredFor === null &&
    store.selectedId &&
    nodesOf(store.selectedId).length > 0
  ) {
    focusNow(store.selectedId);
    overviewProvisional = false;
  }
});
watch(
  () => store.loadingMessages,
  (loading, was) => {
    if (!was || loading) return;
    // The last merge's graph pass ran while still loading — finish a pending
    // chain jump here, or the view would wait on a graph change that never comes.
    if (!resolvePendingJump()) return;
    if (pendingFocus) {
      if (nodesOf(pendingFocus).length > 0) focusNow(pendingFocus);
      return;
    }
    if (centeredFor === null && pendingFocus === null && !overviewShown) {
      openInitialView();
    }
  },
);
watch(
  () => store.focusRequest,
  (request) => {
    if (!request) return;
    pendingFocus = request.sessionId;
    if (!store.loadingMessages && nodesOf(pendingFocus).length > 0) focusNow(pendingFocus);
  },
);

watch(
  () => store.loadingCanvas,
  (loading) => {
    if (loadingAnchorFrame !== null) cancelAnimationFrame(loadingAnchorFrame);
    loadingAnchorFrame = null;
    if (loading) return;
    // ResizeObserver supplies final row heights after the last DOM patch.
    loadingAnchorFrame = requestAnimationFrame(() => {
      loadingAnchorFrame = requestAnimationFrame(() => {
        loadingAnchorFrame = null;
        if (store.loadingCanvas) return;
        const anchor = loadingAnchorId ? nodeById.value.get(loadingAnchorId) : null;
        if (anchor) alignNode(anchor);
        loadingAnchorId = null;
        // The batch settled: whatever the initial overview framed on a
        // partial graph is now stale. Re-decide on the final graph unless the
        // user has taken the camera (or a focus/jump is about to land).
        if (
          overviewProvisional &&
          !userAdjustedView &&
          centeredFor === null &&
          pendingFocus === null &&
          pendingJump === null
        ) {
          overviewProvisional = false;
          overviewShown = false;
          openInitialView();
        }
      });
    });
  },
);

watch(
  () => store.fitRequest,
  (nonce) => {
    if (!nonce) return;
    userAdjustedView = true;
    overviewProvisional = false;
    fitView();
  },
);

// Context-chain cards land here: center the view on the picked turn. Right
// after a branch switch the node can still be missing (messages loading,
// layout not settled) — stash it and jump on the first graph pass that has it.
watch(
  () => store.turnJumpRequest,
  (request) => {
    if (!request) return;
    pendingJump = request.nodeId;
    resolvePendingJump();
  },
);

// ── minimap ─────────────────────────────────────────────────────────

const MM_WIDTH = 176;
const MM_HEIGHT = 110;
const minimapEl = ref<HTMLElement | null>(null);
const viewportSize = ref({ w: 0, h: 0 });
let resizeObserver: ResizeObserver | null = null;

// ── card heights feed the layout ────────────────────────────────────
// ResizeObserver reports pre-transform layout size, so zoom doesn't skew
// measurements. Height depends only on content + fixed card width, never on
// the row a card lands in — measure → re-layout settles in one pass.
// Created in setup (not onMounted): template refs fire during mount, before
// mounted hooks run, so the observer must already exist to catch them.
const cardObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const card = entry.target as HTMLElement;
    const id = card.dataset.nodeId;
    if (!id) continue;
    const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? card.offsetHeight);
    if (cardHeights[id] !== height) cardHeights[id] = height;
  }
});

/** Cards this observer still watches; ref(null) sweeps the detached ones. */
const observedCards = new Set<HTMLElement>();
let sweepQueued = false;

/** Cards that left the graph (branch switch, delete) are detached elements
 *  the observer would retain forever; drop them once the patch settles. */
function sweepDetachedCards(): void {
  if (sweepQueued) return;
  sweepQueued = true;
  queueMicrotask(() => {
    sweepQueued = false;
    for (const card of observedCards) {
      if (!card.isConnected) {
        observedCards.delete(card);
        cardObserver.unobserve(card);
      }
    }
  });
}

/** Template ref for turn cards: observe them and record measured heights. */
function cardRef(el: unknown): void {
  const card = el as HTMLElement | null;
  if (card?.dataset.nodeId) {
    if (!observedCards.has(card)) {
      observedCards.add(card);
      cardObserver.observe(card);
    }
    return;
  }
  // Vue calls ref(null) on unmount but does not say WHICH element left, and
  // ResizeObserver cannot enumerate its targets — sweep for the detached ones.
  sweepDetachedCards();
}

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (rect) viewportSize.value = { w: rect.width, h: rect.height };
  });
  if (viewportEl.value) resizeObserver.observe(viewportEl.value);
});
onUnmounted(() => {
  if (loadingAnchorFrame !== null) cancelAnimationFrame(loadingAnchorFrame);
  resizeObserver?.disconnect();
  cardObserver.disconnect();
  observedCards.clear();
  draftObserver.disconnect();
  mmAnimating = false;
  camTarget = null;
  mmWheelQueued = false;
  mmWheelDeltaY = 0;
  if (activeDrag) {
    window.removeEventListener("mousemove", activeDrag.move);
    window.removeEventListener("mouseup", activeDrag.up);
  }
});

// Drop measurements for nodes that left the graph (deleted sessions, project
// switches). Deleting may recompute the graph once; the next pass finds
// nothing to remove, so the loop settles.
watch(graph, (g) => {
  const live = new Set(g.nodes.map((n) => n.id));
  for (const id of Object.keys(cardHeights)) {
    if (!live.has(id)) delete cardHeights[id];
  }
});

const showMinimap = computed(() => settings.canvas.minimap && graph.value.nodes.length > 0);

const minimapGeometry = computed(() => {
  const nodes = graph.value.nodes;
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const worldW = Math.max(...nodes.map((n) => n.x + NODE_WIDTH)) - minX || 1;
  const worldH = Math.max(...nodes.map((n) => n.y + n.height)) - minY || 1;
  const s = Math.min(MM_WIDTH / worldW, MM_HEIGHT / worldH);
  return { minX, minY, s, offX: (MM_WIDTH - worldW * s) / 2, offY: (MM_HEIGHT - worldH * s) / 2 };
});

// The map's own zoom (option 3): ⌘/Ctrl+wheel magnifies the minimap itself,
// cursor-anchored, so colors stay readable no matter how big the world gets.
// null = the classic whole-world overview. Stale values self-heal: mmGeom
// clamps against the current fit, so a project switch falls back to overview.
const mmZoom = ref<number | null>(null);
const mmCam = ref({ x: 0, y: 0 });
const MM_MAX_ZOOM = 28;

type MmGeom =
  | { kind: "fit"; minX: number; minY: number; s: number; offX: number; offY: number }
  | { kind: "free"; s: number; camX: number; camY: number };

const mmGeom = computed<MmGeom | null>(() => {
  const fit = minimapGeometry.value;
  if (!fit) return null;
  if (mmZoom.value == null || mmZoom.value <= fit.s * 1.0001) return { kind: "fit", ...fit };
  return {
    kind: "free",
    s: Math.min(mmZoom.value, fit.s * MM_MAX_ZOOM),
    camX: mmCam.value.x,
    camY: mmCam.value.y,
  };
});

/** The map's camera as ONE layer transform: fit-positioned dots land on
 *  `MM_WIDTH/2 + (x - camX) * s` by scaling about the origin and translating
 *  (fit mode is the identity). Per-frame updates touch this element and the
 *  view rect only — never the node dots. */
const mmLayerStyle = computed(() => {
  const g = mmGeom.value;
  const fit = minimapGeometry.value;
  if (!g || !fit || g.kind === "fit") return {};
  const k = g.s / fit.s;
  return {
    transform: `translate(${MM_WIDTH / 2 + (fit.minX - g.camX) * g.s - fit.offX * k}px, ${
      MM_HEIGHT / 2 + (fit.minY - g.camY) * g.s - fit.offY * k
    }px) scale(${k})`,
  };
});

function mmNodeStyle(node: TurnNode): Record<string, string> {
  const g = minimapGeometry.value;
  if (!g) return { display: "none" };
  return {
    left: `${g.offX + (node.x - g.minX) * g.s}px`,
    top: `${g.offY + (node.y - g.minY) * g.s}px`,
    width: `${Math.max(4, NODE_WIDTH * g.s)}px`,
    height: `${Math.max(3, node.height * g.s)}px`,
    // at this size the 1px outline is half the footprint and reads as mush
    borderWidth: g.s > 0.09 ? "1px" : "0",
  };
}

/** Paint order for overlapping minimap dots: plain → stub → subtree → hit →
 *  active path → mark → running, so the states a user is hunting for stay
 *  visible. */
const mmNodes = computed(() =>
  [...graph.value.nodes].sort((a, b) => mmNodeRank(a) - mmNodeRank(b)),
);

/** The map tints exactly the cards' descendant set — the selected turn's
 *  direct children, i.e. the entry card of each branch forked from the
 *  selection — so a branch the layout parked far away stays findable. Deeper
 *  branch cards keep the plain dot. Off-path so the lit line reads orange
 *  throughout, not purple. */
function isMapSubtree(node: TurnNode): boolean {
  return !activePathIds.value.has(node.id) && childTurnIds.value.has(node.id);
}

function mmNodeRank(node: TurnNode): number {
  if (isNodeRunning(node)) return 6;
  if (isTurnMarked(node.id)) return 5;
  if (activePathIds.value.has(node.id)) return 4;
  if (searchHitIds.value.has(node.id)) return 3;
  if (isMapSubtree(node)) return 2;
  return node.kind === "stub" ? 1 : 0;
}

/** The viewport's current slice of world space, drawn on the minimap. */
const mmViewStyle = computed(() => {
  const g = mmGeom.value;
  const { w, h } = viewportSize.value;
  if (!g || w === 0 || h === 0) return { display: "none" };
  const vw = (w / scale.value) * g.s;
  const vh = (h / scale.value) * g.s;
  if (g.kind === "fit") {
    return {
      left: `${g.offX + (-tx.value / scale.value - g.minX) * g.s}px`,
      top: `${g.offY + (-ty.value / scale.value - g.minY) * g.s}px`,
      width: `${vw}px`,
      height: `${vh}px`,
    };
  }
  return {
    left: `${MM_WIDTH / 2 + (-tx.value / scale.value - g.camX) * g.s - vw / 2}px`,
    top: `${MM_HEIGHT / 2 + (-ty.value / scale.value - g.camY) * g.s - vh / 2}px`,
    width: `${vw}px`,
    height: `${vh}px`,
  };
});

/** World coords under a minimap point, in the map's current mapping. */
function minimapWorldPoint(clientX: number, clientY: number): { x: number; y: number } | null {
  const g = mmGeom.value;
  const rect = minimapEl.value?.getBoundingClientRect();
  if (!g || !rect) return null;
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  if (g.kind === "fit") {
    return { x: (mx - g.offX) / g.s + g.minX, y: (my - g.offY) / g.s + g.minY };
  }
  return { x: g.camX + (mx - MM_WIDTH / 2) / g.s, y: g.camY + (my - MM_HEIGHT / 2) / g.s };
}

function minimapPan(event: MouseEvent): void {
  const point = minimapWorldPoint(event.clientX, event.clientY);
  if (!point) return;
  const { w, h } = viewportSize.value;
  tx.value = w / 2 - point.x * scale.value;
  ty.value = h / 2 - point.y * scale.value;
}

// Click = fly (eased, not a jump); drag past a few px = direct follow.
const MM_EASE = 0.14;
const MM_FOLLOW_EASE = 0.06;
let camTarget: { x: number; y: number } | null = null;
let mmAnimating = false;

function ensureMmFlight(): void {
  if (mmAnimating) return;
  mmAnimating = true;
  const step = (): void => {
    if (!mmAnimating) return;
    let busy = false;
    const { w, h } = viewportSize.value;
    if (camTarget && w > 0) {
      const goalTx = w / 2 - camTarget.x * scale.value;
      const goalTy = h / 2 - camTarget.y * scale.value;
      tx.value += (goalTx - tx.value) * MM_EASE;
      ty.value += (goalTy - ty.value) * MM_EASE;
      if (Math.abs(goalTx - tx.value) + Math.abs(goalTy - ty.value) > 1 / scale.value) {
        busy = true;
      } else {
        tx.value = goalTx;
        ty.value = goalTy;
        camTarget = null;
      }
    }
    if (followViewportInMinimap()) busy = true;
    if (busy) requestAnimationFrame(step);
    else mmAnimating = false;
  };
  requestAnimationFrame(step);
}

/** While the map is zoomed in, ease its view center after the viewport once
 *  the viewport rect drifts past the middle band — the rect never gets lost. */
function followViewportInMinimap(): boolean {
  const g = mmGeom.value;
  if (g?.kind !== "free") return false;
  const viewX = -tx.value / scale.value;
  const viewY = -ty.value / scale.value;
  const mx = MM_WIDTH / 2 + (viewX - g.camX) * g.s;
  const my = MM_HEIGHT / 2 + (viewY - g.camY) * g.s;
  const outside =
    mx < MM_WIDTH * 0.28 || mx > MM_WIDTH * 0.72 || my < MM_HEIGHT * 0.28 || my > MM_HEIGHT * 0.72;
  if (!outside) return false;
  const dx = viewX - g.camX;
  const dy = viewY - g.camY;
  if (Math.abs(dx) * g.s < 0.5 && Math.abs(dy) * g.s < 0.5) {
    mmCam.value = { x: viewX, y: viewY };
    return false;
  }
  mmCam.value = { x: g.camX + dx * MM_FOLLOW_EASE, y: g.camY + dy * MM_FOLLOW_EASE };
  return true;
}

function onMinimapDown(event: MouseEvent): void {
  loadingAnchorId = null;
  userAdjustedView = true;
  overviewProvisional = false;
  if (event.button !== 0) return;
  const point = minimapWorldPoint(event.clientX, event.clientY);
  camTarget = point ? { ...point } : null;
  ensureMmFlight();
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  const move = (moveEvent: MouseEvent): void => {
    if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) <= 4)
      return;
    moved = true;
    camTarget = null;
    minimapPan(moveEvent);
  };
  const up = (): void => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    activeDrag = null;
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  activeDrag = { move, up };
}

/** ⌘/Ctrl+wheel zooms the minimap itself, cursor-anchored; a plain wheel
 *  falls through and keeps zooming the canvas — that behavior is untouched.
 *  Deltas accumulate and apply once per animation frame: trackpad momentum
 *  emits wheel events faster than frames render, and each apply re-renders
 *  the map. */
let mmWheelDeltaY = 0;
let mmWheelQueued = false;
let mmWheelCursor = { x: 0, y: 0 };

function onMinimapWheel(event: WheelEvent): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  event.stopPropagation();
  mmWheelDeltaY += event.deltaY;
  mmWheelCursor = { x: event.clientX, y: event.clientY };
  if (mmWheelQueued) return;
  mmWheelQueued = true;
  requestAnimationFrame(() => {
    mmWheelQueued = false;
    applyMmZoom();
  });
}

function applyMmZoom(): void {
  const deltaY = mmWheelDeltaY;
  mmWheelDeltaY = 0;
  const g = mmGeom.value;
  const rect = minimapEl.value?.getBoundingClientRect();
  if (!g || !rect) return;
  const point = minimapWorldPoint(mmWheelCursor.x, mmWheelCursor.y);
  if (!point) return;
  const mx = mmWheelCursor.x - rect.left;
  const my = mmWheelCursor.y - rect.top;
  const fitS = minimapGeometry.value?.s ?? g.s;
  const next = Math.min(fitS * MM_MAX_ZOOM, Math.max(fitS, g.s * Math.exp(-deltaY * 0.0016)));
  if (next <= fitS * 1.0001) {
    mmZoom.value = null;
    mmCam.value = { x: -tx.value / scale.value, y: -ty.value / scale.value };
  } else {
    mmZoom.value = next;
    mmCam.value = {
      x: point.x - (mx - MM_WIDTH / 2) / next,
      y: point.y - (my - MM_HEIGHT / 2) / next,
    };
  }
}

// Canvas pans/zooms move the viewport; when the map is zoomed in, that may
// need the follow camera. The loop itself re-entrance-guards.
watch([tx, ty, scale], () => {
  if (mmZoom.value != null) ensureMmFlight();
});

// ── formatting ──────────────────────────────────────────────────────

/** Foot label: first model, "+N" when a turn mixed several; agent name when none reported. */
function modelLabel(models: string[]): string {
  const [first, ...rest] = models;
  if (!first) return backendLabel.value;
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

/** Foot model chip: the label plus the run's effort variant (e.g. "glm-5.3 · high"). */
function modelChip(node: TurnNode): string {
  const base = modelLabel(node.modelIds);
  return node.model?.variant ? `${base} · ${node.model.variant}` : base;
}

function modelTitle(node: TurnNode): string | undefined {
  const ids = node.modelIds.join("\n");
  return node.modelIds.length > 1 ? ids : ids || undefined;
}

// ── draft composer attachments ──────────────────────────────────────

function draftAttachments(): readonly DraftAttachment[] {
  return store.draft?.attachments ?? [];
}

function onDraftPaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files;
  if (!files || files.length === 0) return;
  // Backend gate first: a backend without attachment support would silently
  // not ship a staged chip with the prompt.
  if (!store.capabilities.attachments) {
    event.preventDefault();
    return;
  }
  let list = [...files];
  const model = store.draft?.model ?? null;
  if (model) {
    const option = store.models.find(
      (m) => m.providerId === model.providerId && m.modelId === model.modelId,
    );
    // Text attachments need no media capability; only images are gated.
    if (option && !option.attachment) list = list.filter((f) => !f.type.startsWith("image/"));
  }
  list = list.filter((f) => fileKind(f) !== "unsupported");
  if (list.length === 0) return;
  event.preventDefault();
  void readAttachments(list).then(({ staged }) => {
    setDraftAttachments([...draftAttachments(), ...staged]);
  });
}

function removeDraftAttachment(id: string): void {
  setDraftAttachments(draftAttachments().filter((a) => a.id !== id));
}

// ── path drop: files from the file panel (or Finder) land as plain text ──
//
// A drop carries the file's real path and splices it into the draft it
// landed on — never an attachment chip, never a send, never a read of the
// file's contents. Canvas panning is pointer-driven (mousedown), so it can
// never start from an HTML5 drag; the two gestures do not compete.

interface DropTarget {
  kind: "draft" | "turn";
  sessionId: string;
  messageId: string | null;
}

const pathDragOver = ref(false);
const dropTarget = ref<DropTarget | null>(null);
const draftTextarea = ref<HTMLTextAreaElement | null>(null);

/** The drop target under the pointer, from the data attributes the cards
 *  and the draft box carry. null = empty canvas, which guesses nothing. */
function dropTargetFrom(event: DragEvent): DropTarget | null {
  const el = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
  if (!el) return null;
  const kind = el.dataset.drop;
  if (kind !== "draft" && kind !== "turn") return null;
  const sessionId = el.dataset.session || store.draft?.sessionId;
  if (!sessionId) return null;
  return { kind, sessionId, messageId: el.dataset.message || null };
}

function isDropTarget(node: TurnNode): boolean {
  const target = dropTarget.value;
  if (target?.kind !== "turn") return false;
  return target.sessionId === node.sessionId && target.messageId === (node.messageId ?? null);
}

function onPathDragOver(event: DragEvent): void {
  if (!isPathDrag(event)) return;
  // preventDefault is what makes this element a drop target at all.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  pathDragOver.value = true;
  dropTarget.value = dropTargetFrom(event);
}

function onPathDragLeave(event: DragEvent): void {
  // Leaving for a child of the viewport (a card, the draft) is not leaving
  // the canvas — only a departure from the viewport clears the highlight.
  const related = event.relatedTarget as Node | null;
  if (related && viewportEl.value?.contains(related)) return;
  pathDragOver.value = false;
  dropTarget.value = null;
}

function onPathDrop(event: DragEvent): void {
  pathDragOver.value = false;
  dropTarget.value = null;
  const drop = readPathDrop(event);
  if (!drop) return;
  event.preventDefault();
  if (drop.paths.length === 0) {
    // Files arrived but the OS would not name them — say so, and never
    // invent a path or quietly restage the drop as attachments.
    flashNotice(t("files.dropNoPath"));
    return;
  }
  const target = dropTargetFrom(event);
  if (!target) {
    // Empty canvas: no target is guessed, and nothing is inserted anywhere.
    flashNotice(t("files.dropNoTarget"));
    return;
  }
  if (store.draftSending) {
    // A send is in flight; the text stays where it is until it lands.
    flashNotice(t("files.draftSending"));
    return;
  }
  const text = joinPaths(drop.paths);
  if (target.kind === "draft" && store.draft) {
    insertIntoDraftTextarea(text);
    return;
  }
  // A card: the session's tip continues in place, a mid-story turn forks —
  // the same openDraft semantics the ＋ button uses. The draft opens first,
  // then the path lands in its fresh textarea.
  const node = graph.value.nodes.find(
    (n) => n.sessionId === target.sessionId && (n.messageId ?? null) === target.messageId,
  );
  if (!node) {
    flashNotice(t("files.dropNoTarget"));
    return;
  }
  openDraft(node);
  void nextTick(() => insertIntoDraftTextarea(text));
}

/**
 * Splice text into the draft textarea at its caret through execCommand, so
 * the browser's native undo stack covers the edit (⌘Z inside the draft
 * takes it back out). Falls back to a direct splice when the element is
 * not editable — a draft that is open but not on screen.
 */
function insertIntoDraftTextarea(text: string): void {
  const el = draftTextarea.value;
  if (!el || !store.draft) {
    const result = insertDraftText(text);
    if (!result.ok) {
      flashNotice(result.reason === "sending" ? t("files.draftSending") : t("files.noDraftTarget"));
    }
    return;
  }
  el.focus();
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  // A newline before only when the previous line has content; one after
  // keeps following text on its own line.
  const insert = `${before === "" || before.endsWith("\n") ? "" : "\n"}${text}\n`;
  if (document.execCommand("insertText", false, insert)) {
    // The input event already synced the store; the caret sits after the
    // inserted line, ready to keep typing.
    return;
  }
  el.value = `${before}${insert}${after}`;
  setDraftText(el.value);
  const caret = before.length + insert.length;
  el.setSelectionRange(caret, caret);
}

/** Foot left side: tool count plus the run's wall time and output tokens when known. */
function footMeta(node: TurnNode): string {
  const bits = [
    node.toolNames.length > 0
      ? t("canvas.toolCount", { n: node.toolNames.length })
      : t("canvas.noTools"),
  ];
  if (node.durationMs !== null) bits.push(formatDuration(node.durationMs));
  if (node.outputTokens > 0) bits.push(formatTokens(node.outputTokens));
  return bits.join(" · ");
}

/**
 * Running is tracked per SESSION, but only the tip card is the run in
 * progress — lighting every past turn of the session too made finished
 * cards look stuck at running while a later turn streams.
 */
function isNodeRunning(node: TurnNode): boolean {
  return Boolean(store.running[node.sessionId]) && isSessionTip(node);
}

/**
 * The "just ran" tint rides the same tip-only rule as running: one card per
 * session at most, and it yields as soon as a newer run takes the tip.
 */
function isNodeRecent(node: TurnNode): boolean {
  return node.kind === "turn" && isSessionTip(node) && recentAlphaFor(node.sessionId) > 0;
}

/** Fade driver for the CSS var — 1 right after settle, 0 five minutes later. */
function recentAlpha(node: TurnNode): number {
  return isSessionTip(node) ? recentAlphaFor(node.sessionId) : 0;
}

/** Preview line: the live stream while the tip runs, else the reply / failure / stand-in. */
function previewOf(node: TurnNode): string {
  if (node.kind === "turn" && store.running[node.sessionId] && isSessionTip(node)) {
    const stream = store.streams[node.sessionId]?.trim();
    if (stream) return stream;
    return node.preview || t("canvas.thinking");
  }
  return (
    node.preview ||
    (node.error
      ? `⚠ ${node.error}`
      : node.toolNames.length > 0
        ? t("cmp.toolOnly")
        : t("cmp.noText"))
  );
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("canvas.justNow");
  if (minutes < 60) return t("canvas.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("canvas.hoursAgo", { n: hours });
  return t("canvas.daysAgo", { n: Math.floor(hours / 24) });
}
</script>
