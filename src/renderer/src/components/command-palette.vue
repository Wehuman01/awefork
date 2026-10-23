<template>
  <Teleport to="body">
    <div v-if="paletteOpen" class="palette-backdrop" @mousedown.self="close">
      <div class="palette">
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          type="text"
          :placeholder="t('palette.placeholder')"
          @keydown="onInputKeydown"
        />
        <div class="palette-list">
          <button
            v-for="(item, i) in items"
            :key="item.key"
            type="button"
            class="palette-item"
            :class="{ hl: i === highlighted }"
            @mouseenter="highlighted = i"
            @click="run(item)"
          >
            <span class="palette-icon">{{ item.icon }}</span>
            <span v-if="item.pinned" class="palette-pin" :title="t('palette.pinned')">📌</span>
            <span class="palette-label">{{ item.label }}</span>
            <span v-if="(item.tags?.length ?? 0) > 0" class="palette-tags">
              <span
                v-for="tag in item.tags?.slice(0, 2)"
                :key="tag"
                class="palette-tag"
                :style="{ color: tagColor(tag), background: tagBg(tag) }"
              >{{ tag }}</span>
              <span v-if="(item.tags?.length ?? 0) > 2" class="palette-tag palette-tag-more"
                >+{{ (item.tags?.length ?? 0) - 2 }}</span>
            </span>
            <span class="palette-hint">{{ item.hint }}</span>
          </button>
          <p v-if="items.length === 0" class="palette-empty">{{ t("palette.empty") }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { SessionSummary } from "../../../shared/types";
import { shortPath as shortDir } from "../format";
import { t } from "../i18n";
import { paletteOpen, panels, togglePalette, togglePanel } from "../layout";
import {
  compareWithParent,
  createSession,
  exitCompare,
  refreshSessions,
  requestCanvasFit,
  selectSession,
  store,
  switchDirectory,
  tagBg,
  tagColor,
  tagsOf,
  visibleSessions,
} from "../state";

interface PaletteItem {
  key: string;
  icon: string;
  label: string;
  hint: string;
  run: () => void;
  /** Session items only: the sidebar's pin badge rides along. */
  pinned?: boolean;
  /** Session items only: the sidebar's tag chips ride along. */
  tags?: string[];
}

const query = ref("");
const highlighted = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

watch(paletteOpen, (open) => {
  if (open) {
    query.value = "";
    highlighted.value = 0;
    void nextTick(() => inputEl.value?.focus());
  }
});

const items = computed<PaletteItem[]>(() => {
  const needle = query.value.trim().toLowerCase();
  const match = (text: string) => !needle || text.toLowerCase().includes(needle);
  const actions: PaletteItem[] = [
    {
      key: "act:new",
      icon: "＋",
      label: t("palette.new"),
      hint: t("palette.newHint"),
      run: () => void createSession(),
    },
    {
      key: "act:fit",
      icon: "⛶",
      label: t("palette.fit"),
      hint: t("palette.fitHint"),
      run: requestCanvasFit,
    },
    {
      key: "act:refresh",
      icon: "↻",
      label: t("palette.refresh"),
      hint: "",
      run: () => void refreshSessions(),
    },
    {
      key: "act:sidebar",
      icon: "▤",
      label: panels.sidebar.collapsed ? t("palette.expandSidebar") : t("palette.collapseSidebar"),
      hint: "",
      run: () => togglePanel("sidebar"),
    },
    {
      key: "act:context",
      icon: "▥",
      label: panels.context.collapsed ? t("palette.expandContext") : t("palette.collapseContext"),
      hint: "",
      run: () => togglePanel("context"),
    },
    ...(store.selectedId && store.lineage[store.selectedId]?.parentId
      ? [
          {
            key: "act:cmp-parent",
            icon: "⇄",
            label: t("palette.compareParent"),
            hint: t("palette.compareHint"),
            run: () => {
              const id = store.selectedId;
              if (id) compareWithParent(id);
            },
          },
        ]
      : []),
    ...(store.compare
      ? [
          {
            key: "act:cmp-exit",
            icon: "✕",
            label: t("palette.exitCompare"),
            hint: "",
            run: exitCompare,
          },
        ]
      : []),
  ].filter((action) => match(action.label) || match(action.hint));

  const sessions = visibleSessions.value
    .filter((s) => match(s.title) || match(s.directory))
    .slice(0, 30)
    .map(
      (s): PaletteItem => ({
        key: `session:${s.id}`,
        icon: s.origin === "fork" ? "⎇" : "💬",
        label: s.title || "(untitled)",
        hint: shortDir(s.directory),
        pinned: store.pins.includes(s.id),
        tags: tagsOf(s.id),
        run: () => void jumpToSession(s),
      }),
    );

  return [...actions, ...sessions];
});

watch(items, () => {
  highlighted.value = 0;
});

function run(item: PaletteItem): void {
  close();
  item.run();
}

function close(): void {
  paletteOpen.value = false;
}

async function jumpToSession(session: SessionSummary): Promise<void> {
  if (session.directory !== store.selectedDirectory) {
    await switchDirectory(session.directory);
  }
  await selectSession(session.id, { focus: true });
}

function onInputKeydown(event: KeyboardEvent): void {
  // Keys during IME composition operate the candidate window: Enter confirms a
  // candidate, the arrow keys
  // move it — neither should trigger panel navigation. keyCode 229 backstops
  // Safari's composition keys.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const size = items.value.length;
    if (size === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlighted.value = (highlighted.value + step + size) % size;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const hit = items.value[highlighted.value];
    if (hit) run(hit);
  } else if (event.key === "Escape") {
    close();
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    togglePalette();
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onUnmounted(() => window.removeEventListener("keydown", onGlobalKeydown));
</script>
