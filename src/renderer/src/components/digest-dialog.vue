<template>
  <Teleport to="body">
    <div v-if="store.digestDialogOpen" class="ddg-backdrop" @mousedown="setDigestDialogOpen(false)">
      <section
        class="ddg"
        role="dialog"
        aria-modal="true"
        :aria-label="dt('title')"
        @mousedown.stop
      >
        <header class="ddg-head">
          <strong>{{ dt("title") }}</strong>
          <span class="ddg-count" :title="dt('maxed', { max })">
            {{ dt("count", { n: picked.length, max }) }}
          </span>
          <button type="button" class="ddg-close" :title="t('settings.close')" @click="setDigestDialogOpen(false)">✕</button>
        </header>
        <p class="ddg-hint">{{ dt("hint") }}</p>
        <div class="ddg-list">
          <button
            v-for="option in options"
            :key="option.tabId"
            type="button"
            class="ddg-item"
            :class="{ on: isPicked(option.tabId) }"
            :disabled="!isPicked(option.tabId) && atMax"
            :title="!isPicked(option.tabId) && atMax ? dt('maxed', { max }) : option.title"
            @click="toggle(option.tabId)"
          >
            <span class="ddg-main">
              <span class="ddg-name">{{ option.title }}</span>
              <span class="ddg-sub">{{ subOf(option) }}</span>
            </span>
            <!-- The position the story holds in the digest, not just a tick:
                 the send order is what the reader sees as 1/4, 2/4, … -->
            <span v-if="orderOf(option.tabId) > 0" class="ddg-check" :title="dt('count', { n: orderOf(option.tabId), max })">{{ orderOf(option.tabId) }}</span>
          </button>
          <p v-if="options.length === 0" class="ddg-empty">{{ dt("empty") }}</p>
        </div>
        <fieldset class="ddg-scope">
          <legend class="ddg-scope-label">{{ dt("scopeLabel") }}</legend>
          <button
            type="button"
            class="ddg-scope-option"
            :class="{ on: scope === 'story' }"
            :aria-pressed="scope === 'story'"
            @click="scope = 'story'"
          >
            <strong>{{ dt("scopeStory") }}</strong>
            <span>{{ dt("scopeStoryHint") }}</span>
          </button>
          <button
            type="button"
            class="ddg-scope-option"
            :class="{ on: scope === 'turn' }"
            :aria-pressed="scope === 'turn'"
            @click="scope = 'turn'"
          >
            <strong>{{ dt("scopeTurn") }}</strong>
            <span>{{ dt("scopeTurnHint") }}</span>
          </button>
        </fieldset>
        <footer class="ddg-summary">
          <div class="ddg-summary-row">
            <span class="ddg-summary-label">{{ dt("summaryModel") }}</span>
            <ModelPicker
              :model-value="model"
              :models="store.models"
              :favorite-models="store.favoriteModels"
              :recent-models="store.recentModels"
              :title="dt('summaryModel')"
              @update:model-value="model = $event"
              @toggle-favorite="toggleFavorite"
            />
          </div>
          <div class="ddg-summary-row">
            <span class="ddg-summary-label">{{ dt("lengthLabel") }}</span>
            <span class="ddg-length">
              <button type="button" :class="{ on: length === 'brief' }" @click="length = 'brief'">{{ dt("lengthBrief") }}</button>
              <button type="button" :class="{ on: length === 'standard' }" @click="length = 'standard'">{{ dt("lengthStandard") }}</button>
            </span>
          </div>
          <button
            type="button"
            class="ddg-start"
            :disabled="picked.length === 0 || running"
            @click="start"
          >{{ dt("start") }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ModelChoice } from "../../../shared/types";
import { dt } from "../digest-i18n";
import { t } from "../i18n";
import {
  type DigestStoryOption,
  digestStoryOptions,
  MAX_DIGEST_STORIES,
  setDigestDialogOpen,
  startDigest,
  store,
  toggleFavoriteModel,
} from "../state";
import ModelPicker from "./model-picker.vue";

/** Window-local defaults: the model picker's own recent list carries the
 *  model memory across digests, so nothing here needs to persist. */
const model = ref<ModelChoice | null>(null);
const length = ref<"brief" | "standard">("standard");
const scope = ref<"story" | "turn">("story");
const picked = ref<string[]>([]);
const running = ref(false);

// Esc closes while the dialog is up — the app-level handler owns the
// canvas's own Esc surfaces, so this one is scoped to the dialog's lifetime.
watch(
  () => store.digestDialogOpen,
  (open, _wasOpen, onCleanup) => {
    if (!open) {
      picked.value = [];
      return;
    }
    window.addEventListener("keydown", onKeydown);
    onCleanup(() => window.removeEventListener("keydown", onKeydown));
  },
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") setDigestDialogOpen(false);
}

const options = computed(() => digestStoryOptions.value);
const max = MAX_DIGEST_STORIES;
const atMax = computed(() => picked.value.length >= max);

function isPicked(tabId: string): boolean {
  return picked.value.includes(tabId);
}

/** 1-based position in the digest; 0 when the story is not picked. */
function orderOf(tabId: string): number {
  const index = picked.value.indexOf(tabId);
  return index < 0 ? 0 : index + 1;
}

/** The parked session, when the story's chain ends somewhere other than its root. */
function subOf(option: DigestStoryOption): string {
  const tip = store.sessions.find((session) => session.id === option.sessionId);
  if (!tip || tip.title === option.title) return "";
  return tip.title;
}

function toggle(tabId: string): void {
  const index = picked.value.indexOf(tabId);
  if (index >= 0) {
    picked.value = picked.value.filter((id) => id !== tabId);
    return;
  }
  if (atMax.value) return;
  picked.value = [...picked.value, tabId];
}

function toggleFavorite(choice: ModelChoice): void {
  void toggleFavoriteModel(choice);
}

async function start(): Promise<void> {
  if (picked.value.length === 0 || running.value) return;
  running.value = true;
  try {
    await startDigest({
      tabIds: [...picked.value],
      scope: scope.value,
      model: model.value,
      length: length.value,
    });
    picked.value = [];
  } finally {
    running.value = false;
  }
}
</script>

<style scoped>
.ddg-backdrop {
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

.ddg {
  position: relative;
  z-index: 98;
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(640px, 100%);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow-lift);
  padding: 14px;
  gap: 8px;
}

.ddg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.ddg-count {
  flex: 1;
  font-size: 11px;
  color: var(--ink-faint);
}

.ddg-close {
  border: none;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
  padding: 2px 6px;
}

.ddg-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ink-faint);
}

.ddg-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ddg-item {
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

.ddg-item:hover:not(:disabled) {
  background: var(--primary-soft);
}

.ddg-item.on {
  border-color: var(--primary-border);
}

.ddg-item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ddg-main {
  min-width: 0;
  flex: 1;
}

.ddg-name {
  display: block;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ddg-sub {
  display: block;
  font-size: 10.5px;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ddg-check {
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

.ddg-empty {
  padding: 14px 10px;
  font-size: 12px;
  color: var(--ink-faint);
  text-align: center;
}

.ddg-scope {
  border: 1px solid var(--line);
  border-radius: 10px;
  margin: 0;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ddg-scope-label {
  padding: 0 4px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-faint);
}

.ddg-scope-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 9px;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 6px 8px;
}

.ddg-scope-option:hover {
  background: var(--primary-soft);
}

.ddg-scope-option.on {
  border-color: var(--primary-border);
}

.ddg-scope-option strong {
  font-size: 12px;
}

.ddg-scope-option span {
  font-size: 10.5px;
  color: var(--ink-faint);
}

.ddg-summary {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ddg-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ddg-summary-label {
  font-size: 11.5px;
  color: var(--ink-faint);
}

.ddg-length {
  display: flex;
  gap: 4px;
}

.ddg-length button {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--ink-faint);
  cursor: pointer;
}

.ddg-length button.on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary-deep);
  font-weight: 700;
}

.ddg-start {
  margin-top: 2px;
  border: 1px solid var(--primary);
  background: var(--primary);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
}

.ddg-start:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
