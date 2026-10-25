<template>
  <Teleport to="body">
    <div v-if="open" class="pmd-backdrop" @mousedown="emit('update:open', false)">
      <section
        class="pmd"
        role="dialog"
        aria-modal="true"
        :aria-label="t('paralleldlg.title')"
        @mousedown.stop
      >
        <header class="pmd-head">
          <strong>{{ t("paralleldlg.title") }}</strong>
          <span class="pmd-count" :title="t('paralleldlg.maxed', { max })">
            {{ t("paralleldlg.count", { n: targets.length, max }) }}
          </span>
          <button type="button" class="pmd-close" :title="t('settings.close')" @click="close">✕</button>
        </header>
        <p class="pmd-hint">{{ t("paralleldlg.hint") }}</p>
        <input
          ref="searchEl"
          v-model="query"
          class="pmd-search"
          type="text"
          :placeholder="t('input.parallelSearchModel')"
          :aria-label="t('input.parallelSearchModel')"
          @keydown="onSearchKeydown"
        />
        <div class="pmd-list">
          <template v-for="(entry, i) in entries" :key="entry.kind === 'header' ? `h${i}` : `r${entry.option.providerId}:${entry.option.modelId}`">
            <p v-if="entry.kind === 'header'" class="pmd-sec">{{ entry.label }}</p>
            <button
              v-else
              type="button"
              class="pmd-item"
              :class="{ on: isSelected(entry.option), hl: highlighted === entry.index }"
              :disabled="!isSelected(entry.option) && atMax"
              :title="!isSelected(entry.option) && atMax ? t('paralleldlg.maxed', { max }) : undefined"
              @click="toggleTarget(entry.option)"
            >
              <span class="pmd-main">
                <span class="pmd-name">{{ entry.option.modelName || entry.option.modelId }}</span>
                <span class="pmd-sub">{{ entry.option.providerName }} / {{ entry.option.modelId }}</span>
              </span>
              <span v-if="entry.option.variants.length > 0" class="pmd-variants">
                <span
                  v-for="v in [null, ...entry.option.variants]"
                  :key="v ?? 'default'"
                  role="button"
                  tabindex="-1"
                  class="pmd-variant"
                  :class="{ on: variantOf(entry.option) === v }"
                  :title="v ?? t('input.parallelDefaultVariant')"
                  @click.stop="stage(entry.option, v)"
                  >{{ v ?? t("input.parallelDefaultVariant") }}</span
                >
              </span>
              <span class="pmd-star"
                :class="{ on: isFavorite(entry.option) }"
                role="button"
                tabindex="-1"
                :title="isFavorite(entry.option) ? t('modelpicker.unfavorite') : t('modelpicker.favorite')"
                @click.stop="toggleFavorite(entry.option)"
                >{{ isFavorite(entry.option) ? "★" : "☆" }}</span
              >
              <!-- The position the model holds in the round, not just a tick:
                   the send order is what the reader sees as 1/4, 2/4, … -->
              <span v-if="orderOf(entry.option) > 0" class="pmd-check" :title="t('paralleldlg.order', { n: orderOf(entry.option) })">{{ orderOf(entry.option) }}</span>
            </button>
          </template>
          <p v-if="filtered.length === 0" class="pmd-empty">{{ t("input.parallelNoModels") }}</p>
        </div>
        <footer v-if="summary" class="pmd-summary">
          <p class="pmd-summary-title">{{ t("paralleldlg.summarySection") }}</p>
          <div class="pmd-summary-row">
            <span class="pmd-summary-label">{{ t("input.parallelSummaryWith") }}</span>
            <ModelPicker
              :model-value="summary.model"
              :models="models"
              :favorite-models="favoriteModels"
              :recent-models="recentModels"
              :title="t('input.parallelSummaryWith')"
              @update:model-value="setSummaryModel"
              @toggle-favorite="emit('toggle-favorite', $event)"
            />
          </div>
          <div class="pmd-summary-row">
            <span class="pmd-summary-label">{{ t("input.parallelSummaryLength") }}</span>
            <span class="pmd-length">
              <button type="button" :class="{ on: summary.length === 'brief' }" @click="setSummaryLength('brief')">{{ t("input.parallelBrief") }}</button>
              <button type="button" :class="{ on: summary.length === 'standard' }" @click="setSummaryLength('standard')">{{ t("input.parallelStandard") }}</button>
              <button type="button" :class="{ on: summary.length === 'none' }" @click="setSummaryLength('none')">{{ t("input.parallelNone") }}</button>
            </span>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import type { ModelChoice, ModelOption, ParallelSummaryLength } from "../../../shared/types";
import { t } from "../i18n";
import ModelPicker from "./model-picker.vue";

const props = withDefaults(
  defineProps<{
    /** Dialog visibility. */
    open: boolean;
    models: readonly ModelOption[];
    /** Starred models for the Favorites group. */
    favoriteModels?: readonly ModelChoice[];
    /** Recent hand-picked models for the Recent group. */
    recentModels?: readonly ModelChoice[];
    /** Selected targets, in send order; null = the agent's default model. */
    targets: readonly (ModelChoice | null)[];
    /** Summary defaults; when given, the dialog configures them too. */
    summary?: { model: ModelChoice | null; length: ParallelSummaryLength };
    max?: number;
  }>(),
  {
    favoriteModels: () => [],
    recentModels: () => [],
    summary: undefined,
    max: 4,
  },
);
const emit = defineEmits<{
  "update:open": [open: boolean];
  "update:targets": [targets: (ModelChoice | null)[]];
  "update:summary": [summary: { model: ModelChoice | null; length: ParallelSummaryLength }];
  "toggle-favorite": [model: ModelChoice];
}>();

const query = ref("");
/** -1 = nothing highlighted; otherwise an index into `navRows`. */
const highlighted = ref(-1);
const searchEl = ref<HTMLInputElement | null>(null);
/**
 * Effort picked for a model before it joins the round. An added target
 * reports its own effort instead, so re-opening the dialog shows live state.
 */
const staged = ref<Record<string, string | null>>({});

const atMax = computed(() => props.targets.length >= props.max);

function modelKey(model: ModelChoice | ModelOption): string {
  return `${model.providerId}:${model.modelId}`;
}

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.models;
  // providerId rides along — see model-picker's filter for why.
  return props.models.filter((m) =>
    `${m.providerId} ${m.modelName} ${m.modelId} ${m.providerName}`.toLowerCase().includes(needle),
  );
});

/** Catalog lookup for the quick lists: their entries may be stale or starred. */
const catalogByKey = computed(() => {
  const map = new Map<string, ModelOption>();
  for (const m of props.models) map.set(modelKey(m), m);
  return map;
});

const favoriteRows = computed(() => {
  if (query.value.trim() !== "") return [];
  return props.favoriteModels.flatMap((choice) => {
    const option = catalogByKey.value.get(modelKey(choice));
    return option ? [option] : [];
  });
});

const recentRows = computed(() => {
  if (query.value.trim() !== "") return [];
  const starred = new Set(props.favoriteModels.map(modelKey));
  return props.recentModels.flatMap((choice) => {
    const key = modelKey(choice);
    if (starred.has(key)) return [];
    const option = catalogByKey.value.get(key);
    return option ? [option] : [];
  });
});

/** What the keyboard walks: quick rows first, then the (filtered) catalog. */
const navRows = computed(() => [...favoriteRows.value, ...recentRows.value, ...filtered.value]);

type Entry =
  | { kind: "header"; label: string }
  | { kind: "row"; option: ModelOption; index: number };

const entries = computed<Entry[]>(() => {
  const list: Entry[] = [];
  let index = 0;
  const addRows = (options: readonly ModelOption[]): void => {
    for (const option of options) {
      list.push({ kind: "row", option, index });
      index += 1;
    }
  };
  if (favoriteRows.value.length > 0) {
    list.push({ kind: "header", label: t("modelpicker.groupFavorite") });
    addRows(favoriteRows.value);
  }
  if (recentRows.value.length > 0) {
    list.push({ kind: "header", label: t("modelpicker.groupRecent") });
    addRows(recentRows.value);
  }
  if (index > 0) list.push({ kind: "header", label: t("modelpicker.groupAll") });
  addRows(filtered.value);
  return list;
});

function isSelected(option: ModelOption): boolean {
  return props.targets.some((target) => target !== null && modelKey(target) === modelKey(option));
}

/** 1-based position in the round; 0 when the model is not selected. */
function orderOf(option: ModelOption): number {
  const index = props.targets.findIndex(
    (target) => target !== null && modelKey(target) === modelKey(option),
  );
  return index < 0 ? 0 : index + 1;
}

function isFavorite(option: ModelOption): boolean {
  return props.favoriteModels.some((choice) => modelKey(choice) === modelKey(option));
}

function toggleFavorite(option: ModelOption): void {
  emit("toggle-favorite", { providerId: option.providerId, modelId: option.modelId });
}

/** The effort a row would join with: staged pick, else the live target's. */
function variantOf(option: ModelOption): string | null {
  const key = modelKey(option);
  if (key in staged.value) return staged.value[key] ?? null;
  return (
    props.targets.find((target) => target !== null && modelKey(target) === key)?.variant ?? null
  );
}

function stage(option: ModelOption, variant: string | null): void {
  const key = modelKey(option);
  staged.value = { ...staged.value, [key]: variant };
  // An added target adopts the new effort on the spot.
  const index = props.targets.findIndex((target) => target !== null && modelKey(target) === key);
  if (index < 0) return;
  const target = props.targets[index];
  if (!target) return;
  const next = [...props.targets];
  next[index] = variant ? { ...target, variant } : withoutVariant(target);
  emit("update:targets", next);
}

function withoutVariant(choice: ModelChoice): ModelChoice {
  const { variant: _variant, ...rest } = choice;
  return rest;
}

function toggleTarget(option: ModelOption): void {
  const key = modelKey(option);
  const index = props.targets.findIndex((target) => target !== null && modelKey(target) === key);
  if (index >= 0) {
    emit(
      "update:targets",
      props.targets.filter((_, i) => i !== index),
    );
    return;
  }
  if (atMax.value) return;
  const variant = staged.value[key] ?? null;
  const choice: ModelChoice = { providerId: option.providerId, modelId: option.modelId };
  if (variant) choice.variant = variant;
  emit("update:targets", [...props.targets, choice]);
}

function setSummaryModel(model: ModelChoice | null): void {
  if (!props.summary) return;
  emit("update:summary", { model: model ? { ...model } : null, length: props.summary.length });
}

function setSummaryLength(length: ParallelSummaryLength): void {
  if (!props.summary) return;
  emit("update:summary", { model: props.summary.model, length });
}

function close(): void {
  emit("update:open", false);
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const size = navRows.value.length;
    if (size === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlighted.value =
      highlighted.value < 0 ? (step > 0 ? 0 : size - 1) : (highlighted.value + step + size) % size;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const hit = navRows.value[highlighted.value];
    if (hit) toggleTarget(hit);
  } else if (event.key === "Escape") {
    close();
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      query.value = "";
      highlighted.value = -1;
      staged.value = {};
      return;
    }
    void nextTick(() => searchEl.value?.focus());
  },
);

onUnmounted(() => {
  staged.value = {};
});
</script>

<style scoped>
.pmd-backdrop {
  position: fixed;
  inset: 0;
  background: var(--backdrop, rgba(20, 16, 30, 0.44));
  /* Above the settings panel (95) and the file menus (96); the model
     picker's teleported popover rides at 110 so it still floats on top. */
  z-index: 97;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.pmd {
  position: relative;
  z-index: 98;
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  max-height: min(560px, 100%);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow-lift);
  padding: 14px;
  gap: 8px;
}

.pmd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.pmd-count {
  flex: 1;
  font-size: 11px;
  color: var(--ink-faint);
}

.pmd-close {
  border: none;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
  padding: 2px 6px;
}

.pmd-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ink-faint);
}

.pmd-search {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
  background: var(--card);
  color: var(--ink);
}

.pmd-search:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.pmd-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pmd-sec {
  padding: 8px 10px 3px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-faint);
}

.pmd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: none;
  color: inherit;
  cursor: pointer;
}

.pmd-item:hover:not(:disabled) {
  background: var(--primary-soft);
}

.pmd-item.hl {
  background: var(--primary-soft);
}

.pmd-item.on {
  border-color: var(--primary-border);
}

.pmd-item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.pmd-main {
  min-width: 0;
  flex: 1;
}

.pmd-name {
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pmd-sub {
  display: block;
  font-size: 10.5px;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pmd-variants {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
}

.pmd-variant {
  padding: 2px 5px;
  font-size: 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  color: var(--ink-faint);
  cursor: pointer;
  white-space: nowrap;
}

.pmd-variant:hover {
  color: var(--primary);
  border-color: var(--primary-border);
}

.pmd-variant.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.pmd-star {
  flex: 0 0 auto;
  padding: 2px 4px;
  font-size: 14px;
  line-height: 1;
  color: var(--ink-faint);
  border-radius: 6px;
  cursor: pointer;
}

.pmd-star:hover {
  color: var(--primary);
  background: var(--primary-soft);
}

.pmd-star.on {
  color: var(--primary);
}

.pmd-check {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-soft);
  text-align: center;
  font-size: 10.5px;
  font-weight: 800;
  color: var(--primary-deep);
}

.pmd-empty {
  padding: 14px 10px;
  font-size: 12px;
  color: var(--ink-faint);
  text-align: center;
}

.pmd-summary {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pmd-summary-title {
  margin: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-faint);
}

.pmd-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pmd-summary-label {
  font-size: 11.5px;
  color: var(--ink-faint);
}

.pmd-length {
  display: flex;
  gap: 4px;
}

.pmd-length button {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--ink-faint);
  cursor: pointer;
}

.pmd-length button.on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary-deep);
  font-weight: 700;
}
</style>
