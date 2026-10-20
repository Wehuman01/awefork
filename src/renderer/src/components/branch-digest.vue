<template>
  <button
    v-if="!open"
    type="button"
    class="panel-pill"
    :title="t('branch.digestPillTitle')"
    @click="open = true"
  >{{ t("branch.digestTitle") }}</button>
  <div v-else class="digest-panel">
    <div class="digest-head">
      <span>{{ t("branch.digestCount", { n: digests.length }) }}</span>
      <button type="button" :title="t('branch.collapse')" @click="open = false">✕</button>
    </div>
    <div class="digest-list">
      <button
        v-for="digest in digests"
        :key="digest.sessionId"
        type="button"
        class="digest-row"
        @click="jump(digest)"
      >
        <span class="digest-name">
          <span class="digest-glyph" :class="{ root: !digest.forkedFrom }">{{
            digest.forkedFrom ? "⎇" : "●"
          }}</span>
          <span class="digest-title" :title="digest.title">{{ digest.title }}</span>
          <span
            v-if="canCompare(digest)"
            class="digest-cmp"
            role="button"
            :title="t('branch.compareWith', { title: selectedTitle })"
            @click.stop="compareWith(digest)"
          >⇄</span>
        </span>
        <span v-if="digest.forkedFrom" class="digest-fork">
          {{
            t("branch.forkedFrom", {
              session: digest.forkedFrom.sessionTitle,
              turn: digest.forkedFrom.turnTitle,
            })
          }}
        </span>
        <span
          v-if="digest.attempt !== null && digest.attempt > 1"
          class="digest-attempt"
          :title="t('branch.attemptTitle')"
        >
          {{ t("branch.attempt", { n: digest.attempt }) }}
        </span>
        <span class="digest-meta">
          {{
            t("branch.rowMeta", {
              n: digest.turnCount,
              tokens: formatTokens(digest.outputTokens),
              last: digest.lastTurnTitle || t("branch.noTurns"),
            })
          }}<template v-if="digest.hasError"> ⚠</template>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { type BranchDigest, buildBranchDigests } from "../../../shared/branch-digest";
import type { TurnNode } from "../../../shared/canvas-graph";
import { formatTokens } from "../format";
import { t } from "../i18n";
import { canvasSessions, enterCompare, selectTurn, store, turnGraph } from "../state";

const emit = defineEmits<{ jump: [node: TurnNode] }>();

const open = ref(false);

const digests = computed(() =>
  buildBranchDigests(turnGraph.value, canvasSessions.value, store.lineage),
);

/** ⇄ compares the row's branch with the one currently selected. */
const selectedTitle = computed(
  () => store.sessions.find((s) => s.id === store.selectedId)?.title ?? "",
);

function canCompare(digest: BranchDigest): boolean {
  return (
    store.selectedId != null &&
    digest.sessionId !== store.selectedId &&
    canvasSessions.value.some((s) => s.id === store.selectedId)
  );
}

function compareWith(digest: BranchDigest): void {
  if (store.selectedId) void enterCompare(store.selectedId, digest.sessionId);
}

function jump(digest: BranchDigest): void {
  if (!digest.jumpNodeId) return;
  const node = turnGraph.value.nodes.find((n) => n.id === digest.jumpNodeId);
  if (!node) return;
  void selectTurn(node);
  emit("jump", node);
}
</script>
