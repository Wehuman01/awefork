<template>
  <div
    class="cell"
    :class="[side, { blank: !cell, open }]"
    :tabindex="cell ? 0 : -1"
    :role="cell ? 'button' : undefined"
    :aria-expanded="cell ? open : undefined"
    @click="onCellClick"
    @keydown="onCellKey"
  >
    <template v-if="cell">
      <div class="cell-top">
        <span v-if="cell.badge !== null" class="cell-idx">{{ cell.badge }}</span>
        <span class="cell-title" :title="cell.title">{{ cell.title }}</span>
      </div>
      <div class="cell-chips">
        <span v-if="cell.flag" class="cell-up" :title="flagTitle">
          ⎇ {{ cell.flag === "up" ? t("cmp.flagUp") : t("cmp.flagInherited") }}</span
        >
        <span
          v-if="cell.modelIds.length > 0"
          class="cell-chip model"
          :title="cell.modelIds.join('\n')"
        >{{ cell.modelIds[0] }}<template v-if="cell.modelIds.length > 1">
          +{{ cell.modelIds.length - 1 }}</template></span>
        <span v-if="cell.durationMs !== null" class="cell-chip">⏱ {{ formatDuration(cell.durationMs) }}</span>
        <span v-if="cell.outputTokens > 0" class="cell-chip">{{ formatTokens(cell.outputTokens) }}</span>
        <span v-if="cell.toolNames.length > 0" class="cell-chip">🔧 {{ cell.toolNames.length }}</span>
        <span v-if="cell.error" class="cell-chip err" :title="cell.error">{{ t("cmp.failed") }}</span>
      </div>
      <p
        v-if="!cell.preview"
        class="cell-preview"
        :class="{ errored: Boolean(cell.error) }"
      >{{ previewOf(cell) }}</p>
      <MarkdownView
        v-else
        :source="cell.preview"
        class="cell-md"
        :class="{ clamped: !open }"
      />
    </template>
    <p v-else class="cell-blank">{{ side === "left" ? t("cmp.leftEnd") : t("cmp.rightEnd") }}</p>
  </div>
</template>

<script lang="ts">
/**
 * One turn card in a comparison column, normalized so the aligned mode
 * (graph TurnNodes) and the free side-by-side mode (message-built Turns)
 * render through exactly the same template.
 */
export interface DisplayCell {
  /** Stable key — `${sessionId}:${messageId}` in both modes. */
  id: string;
  title: string;
  preview: string;
  toolNames: string[];
  modelIds: string[];
  durationMs: number | null;
  outputTokens: number;
  error: string | null;
  /** 1-based index badge among the column's own turns; null = no badge. */
  badge: number | null;
  /** "up" = an upstream branch's turn on the way to this one; "inherited" = copied original prefix. */
  flag: "up" | "inherited" | null;
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { formatDuration, formatTokens } from "../format";
import { t } from "../i18n";
import { MarkdownView } from "./markdown-view";

const props = withDefaults(
  defineProps<{
    cell: DisplayCell | null;
    side: "left" | "right";
    /** Bumped by the compare head's expand/collapse-all; 0 = no command yet. */
    expandSignal?: number;
    /** Whether that command opens (true) or folds (false) the cards. */
    expandOpen?: boolean;
  }>(),
  { expandSignal: 0, expandOpen: false },
);

const flagTitle = computed(() =>
  props.cell?.flag === "inherited" ? t("cmp.inheritedTitle") : t("cmp.upstreamTitle"),
);

/**
 * Folded/open lives in the card itself: a click flips only this card, so one
 * column's expansion can never move the other's. A plan rebuild reuses the
 * row's slot for a different card — that card starts folded, because the slot
 * is keyed by (side, cell id): both the row index and the card itself must
 * match before an expansion survives, and the two columns' ids are namespaced
 * apart even when their sessions mint the same message ids.
 *
 * The key is a primitive string on purpose. A getter returning a fresh array
 * (`() => [side, cell?.id]`) is a new value on every run, so Vue's default
 * Object.is check fires the callback on ANY cell-object rebuild: every
 * background refresh — a streamed delta, a usage nudge, a re-measured card —
 * rebuilt the columns with the same ids and folded every open card shut,
 * which read as the compare view collapsing itself mid-read. The primitive
 * fires only when the side or the card id actually changes.
 */
const cellKey = computed(() => (props.cell ? `${props.side}:${props.cell.id}` : props.side));
const open = ref(false);
watch(cellKey, () => {
  open.value = false;
});

/**
 * The compare head's expand/collapse-all. A counter rather than a boolean so
 * the command applies exactly once per click: a card the user folds by hand
 * afterwards keeps that choice until the next command, instead of being
 * fought by the boolean on every later refresh.
 */
watch(
  () => props.expandSignal,
  (signal) => {
    if (signal > 0) open.value = props.expandOpen;
  },
);

/**
 * Click folds a cell open/closed — but markdown bodies now carry links and
 * code-block copy buttons that must stay clickable, and a drag that selects
 * reply text must not fold the cell shut on mouseup.
 */
function onCellClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("a, button")) return;
  if (window.getSelection()?.toString()) return;
  if (props.cell) open.value = !open.value;
}

/** The same toggle from the keyboard — a card is a disclosure, so it focuses
 *  and Enter/Space fold it, like every other interactive surface here. */
function onCellKey(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!props.cell) return;
  event.preventDefault();
  open.value = !open.value;
}

function previewOf(cell: DisplayCell): string {
  if (cell.error) return `⚠ ${cell.error}`;
  return cell.toolNames.length > 0 ? t("cmp.toolOnly") : t("cmp.noText");
}
</script>
