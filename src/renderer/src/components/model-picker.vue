<template>
  <div ref="rootEl" class="mp">
    <button ref="btnEl" type="button" class="mp-btn" :title="title" @click="toggle">
      <span class="mp-label">{{ label }}</span>
      <span class="mp-chev">{{ open ? "⌃" : "⌄" }}</span>
    </button>
    <!-- teleport out: the panel and the canvas viewport both have overflow:hidden /
         transform, so a popover left in the component tree gets clipped or scaled -->
    <Teleport to="body">
      <div v-if="open" ref="popEl" class="mp-pop" :style="popStyle">
      <input
        ref="searchEl"
        v-model="query"
        class="mp-search"
        type="text"
        :placeholder="t('modelpicker.searchPlaceholder')"
        @keydown="onSearchKeydown"
      />
      <div class="mp-list">
        <button
          type="button"
          class="mp-item"
          :class="{ hl: highlighted === -1 }"
          @click="pick(null)"
        >
          <span class="mp-main">
            <span class="mp-name">{{ t("modelpicker.default") }}</span>
            <span class="mp-sub">{{ t("modelpicker.defaultSub") }}</span>
          </span>
        </button>
        <template
          v-for="(entry, i) in entries"
          :key="entry.kind === 'header' ? `h${i}` : `r${entry.index}`"
        >
          <p v-if="entry.kind === 'header'" class="mp-sec">{{ entry.label }}</p>
          <button
            v-else
            type="button"
            class="mp-item"
            :class="{ hl: highlighted === entry.index }"
            @click="pickChoice(entry.option)"
          >
            <span class="mp-main">
              <span class="mp-name">{{ entry.option.modelName }}</span>
              <span class="mp-sub">{{ entry.option.providerName }} / {{ entry.option.modelId }}</span>
            </span>
            <!-- the row itself is a button, so the star can only be a span; clicking
                 it toggles the favorite, it does not select the model -->
            <span
              class="mp-star"
              :class="{ on: isFavorite(entry.option) }"
              role="button"
              tabindex="-1"
              :title="isFavorite(entry.option) ? t('modelpicker.unfavorite') : t('modelpicker.favorite')"
              @click.stop="toggleFavorite(entry.option)"
            >{{ isFavorite(entry.option) ? "★" : "☆" }}</span>
          </button>
        </template>
        <p v-if="filtered.length === 0" class="mp-empty">{{ t("modelpicker.empty") }}</p>
      </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { ModelChoice, ModelOption } from "../../../shared/types";
import { t } from "../i18n";

const props = withDefaults(
  defineProps<{
    modelValue: ModelChoice | null;
    models: readonly ModelOption[];
    /** Starred models, listed first as the Favorites group. */
    favoriteModels?: readonly ModelChoice[];
    /** Recent hand-picked models (most-recent-first) for the Recent group. */
    recentModels?: readonly ModelChoice[];
    title?: string;
  }>(),
  { favoriteModels: () => [], recentModels: () => [] },
);
const emit = defineEmits<{
  "update:modelValue": [model: ModelChoice | null];
  "toggle-favorite": [model: ModelChoice];
}>();

const open = ref(false);
const query = ref("");
/** -1 = the "agent default" row; otherwise an index into `navRows`. */
const highlighted = ref(-1);
const rootEl = ref<HTMLElement | null>(null);
const btnEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const popEl = ref<HTMLElement | null>(null);

/** The popover is fixed-position (teleported to body); its coordinates are
 * computed from the button's position when it opens. */
const POP_WIDTH = 300;
const SCREEN_EDGE = 8;
const popStyle = ref<{ left: string; top?: string; bottom?: string }>({
  left: "0px",
  bottom: "0px",
});

const label = computed(() => {
  const model = props.modelValue;
  if (!model) return t("modelpicker.default");
  return (
    props.models.find((m) => m.providerId === model.providerId && m.modelId === model.modelId)
      ?.modelName ?? model.modelId
  );
});

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.models;
  return props.models.filter((m) =>
    `${m.modelName} ${m.modelId} ${m.providerName}`.toLowerCase().includes(needle),
  );
});

/** Catalog lookup for the quick lists: their entries may be stale or starred. */
const catalogByKey = computed(() => {
  const map = new Map<string, ModelOption>();
  for (const m of props.models) map.set(`${m.providerId}:${m.modelId}`, m);
  return map;
});

/** Favorites rows: starred models still in the current catalog, in star order. */
const favoriteRows = computed(() => {
  if (query.value.trim() !== "") return [];
  return props.favoriteModels.flatMap((choice) => {
    const option = catalogByKey.value.get(`${choice.providerId}:${choice.modelId}`);
    return option ? [option] : [];
  });
});

/** Recent rows: recently used, not starred, still in the catalog. */
const recentRows = computed(() => {
  if (query.value.trim() !== "") return [];
  const starred = new Set(props.favoriteModels.map((c) => `${c.providerId}:${c.modelId}`));
  return props.recentModels.flatMap((choice) => {
    const key = `${choice.providerId}:${choice.modelId}`;
    if (starred.has(key)) return [];
    const option = catalogByKey.value.get(key);
    return option ? [option] : [];
  });
});

/** What the keyboard walks: default row (-1) + quick rows + catalog rows. */
const navRows = computed(() => [...favoriteRows.value, ...recentRows.value, ...filtered.value]);

// starring/unstarring adds and removes quick-group rows on the spot, shifting every
// index; let the highlight follow the model itself,
// instead of clinging to the old index (otherwise Enter would pick whichever other
// model happens to land in that slot).
watch(navRows, (rows, oldRows) => {
  if (highlighted.value < 0) return;
  const prev = oldRows?.[highlighted.value];
  if (!prev) {
    highlighted.value = -1;
    return;
  }
  const key = `${prev.providerId}:${prev.modelId}`;
  highlighted.value = rows.findIndex((r) => `${r.providerId}:${r.modelId}` === key);
});

type Entry =
  | { kind: "header"; label: string }
  | { kind: "row"; option: ModelOption; index: number };

/** Rendered list: Favorites/Recent groups (search-less only), then the full catalog. */
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

function isFavorite(option: ModelOption): boolean {
  return props.favoriteModels.some(
    (c) => c.providerId === option.providerId && c.modelId === option.modelId,
  );
}

function toggleFavorite(option: ModelOption): void {
  emit("toggle-favorite", { providerId: option.providerId, modelId: option.modelId });
}

function toggle(): void {
  open.value ? close() : show();
}

function place(): void {
  const btn = btnEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const left = Math.min(Math.max(SCREEN_EDGE, r.left), window.innerWidth - POP_WIDTH - SCREEN_EDGE);
  popStyle.value = { left: `${left}px`, bottom: `${window.innerHeight - r.top + SCREEN_EDGE}px` };
}

function show(): void {
  place();
  open.value = true;
  query.value = "";
  highlighted.value = props.modelValue ? 0 : -1;
  void nextTick(() => {
    searchEl.value?.focus();
    // when the button sits too close to the window top, flip the popover below it
    const pop = popEl.value;
    if (pop && pop.getBoundingClientRect().top < SCREEN_EDGE) {
      const r = btnEl.value?.getBoundingClientRect();
      if (r) popStyle.value = { left: popStyle.value.left, top: `${r.bottom + SCREEN_EDGE}px` };
    }
  });
}

function close(): void {
  open.value = false;
}

function pick(model: ModelChoice | null): void {
  emit("update:modelValue", model);
  close();
}

function pickChoice(m: ModelOption): void {
  pick({ providerId: m.providerId, modelId: m.modelId });
}

function onSearchKeydown(event: KeyboardEvent): void {
  // keys during IME composition operate the candidate window (see chat-input's
  // onEnterKey), so skip them.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const size = navRows.value.length + 1; // + the default row at -1
    const current = highlighted.value + 1; // 0 = default row
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlighted.value = ((current + step + size) % size) - 1;
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (highlighted.value === -1) {
      pick(null);
      return;
    }
    // starring reorders the quick group instantly, so the index may point at a stale
    // slot: prefer doing nothing over picking the default model by accident.
    const hit = navRows.value[highlighted.value];
    if (hit) pickChoice(hit);
  } else if (event.key === "Escape") {
    close();
  }
}

function onDocMousedown(event: MouseEvent): void {
  if (!open.value) return;
  const target = event.target as Node;
  if (rootEl.value?.contains(target) || popEl.value?.contains(target)) return;
  close();
}

onMounted(() => document.addEventListener("mousedown", onDocMousedown));
onUnmounted(() => document.removeEventListener("mousedown", onDocMousedown));
</script>

<style scoped>
.mp {
  position: relative;
  min-width: 0;
}

.mp-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--primary-deep);
}

.mp-btn:hover {
  border-color: var(--primary-border);
}

.mp-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mp-chev {
  color: var(--ink-faint);
  font-size: 10px;
  flex: 0 0 auto;
}

.mp-pop {
  position: fixed;
  width: 300px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-lift);
  padding: 6px;
  z-index: 70;
}

.mp-search {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12.5px;
  outline: none;
  margin-bottom: 6px;
}

.mp-search:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.mp-list {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mp-sec {
  padding: 8px 10px 3px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-faint);
}

.mp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border-radius: 9px;
}

.mp-item.hl {
  background: var(--primary-soft);
}

.mp-main {
  min-width: 0;
  flex: 1;
}

.mp-name {
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-sub {
  display: block;
  font-size: 10.5px;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-star {
  flex: 0 0 auto;
  padding: 2px 4px;
  font-size: 14px;
  line-height: 1;
  color: var(--ink-faint);
  border-radius: 6px;
  cursor: pointer;
}

.mp-star:hover {
  color: var(--primary);
  background: var(--primary-soft);
}

.mp-star.on {
  color: var(--primary);
}

.mp-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--ink-faint);
  text-align: center;
}
</style>
