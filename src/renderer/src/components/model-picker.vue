<template>
  <div ref="rootEl" class="mp">
    <button ref="btnEl" type="button" class="mp-btn" :title="title" @click="toggle">
      <span class="mp-label">{{ label }}</span>
      <span class="mp-chev">{{ open ? "⌃" : "⌄" }}</span>
    </button>
    <!-- teleport 出去：面板和画布 viewport 都有 overflow:hidden / transform，
         弹层留在组件树里会被裁剪或跟着缩放 -->
    <Teleport to="body">
      <div v-if="open" ref="popEl" class="mp-pop" :style="popStyle">
      <input
        ref="searchEl"
        v-model="query"
        class="mp-search"
        type="text"
        placeholder="搜索模型…"
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
            <span class="mp-name">默认模型</span>
            <span class="mp-sub">agent 配置的默认</span>
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
            <!-- 行本身是 button，星标只能是 span；点击只切收藏，不选模型 -->
            <span
              class="mp-star"
              :class="{ on: isFavorite(entry.option) }"
              role="button"
              tabindex="-1"
              :title="isFavorite(entry.option) ? '从常用移除' : '设为常用'"
              @click.stop="toggleFavorite(entry.option)"
            >{{ isFavorite(entry.option) ? "★" : "☆" }}</span>
          </button>
        </template>
        <p v-if="filtered.length === 0" class="mp-empty">没有匹配的模型</p>
      </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type { ModelChoice, ModelOption } from "../../../shared/types";

const props = withDefaults(
  defineProps<{
    modelValue: ModelChoice | null;
    models: readonly ModelOption[];
    /** Starred models, listed first as the 常用 group. */
    favoriteModels?: readonly ModelChoice[];
    /** Recent hand-picked models (most-recent-first) for the 最近 group. */
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

/** 弹层是 fixed 定位（teleport 到 body），坐标在打开时按按钮位置算。 */
const POP_WIDTH = 300;
const SCREEN_EDGE = 8;
const popStyle = ref<{ left: string; top?: string; bottom?: string }>({
  left: "0px",
  bottom: "0px",
});

const label = computed(() => {
  const model = props.modelValue;
  if (!model) return "默认模型";
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

/** 常用 rows：收藏夹里仍在当前 catalog 中的模型，保持收藏顺序。 */
const favoriteRows = computed(() => {
  if (query.value.trim() !== "") return [];
  return props.favoriteModels.flatMap((choice) => {
    const option = catalogByKey.value.get(`${choice.providerId}:${choice.modelId}`);
    return option ? [option] : [];
  });
});

/** 最近 rows：最近用过、未收藏、仍在 catalog 中的模型。 */
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

type Entry =
  | { kind: "header"; label: string }
  | { kind: "row"; option: ModelOption; index: number };

/** Rendered list: 常用/最近 groups (search-less only), then the full catalog. */
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
    list.push({ kind: "header", label: "常用" });
    addRows(favoriteRows.value);
  }
  if (recentRows.value.length > 0) {
    list.push({ kind: "header", label: "最近使用" });
    addRows(recentRows.value);
  }
  if (index > 0) list.push({ kind: "header", label: "全部模型" });
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
    // 按钮离窗口顶部太近、向上放不下时翻到按钮下方
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
  // 组输入期间的按键在操作候选词窗（见 chat-input 的 onEnterKey），跳过。
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
    // 星标会即时重排快捷区，索引可能指向旧位置：宁可不动，也不误选默认模型。
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
