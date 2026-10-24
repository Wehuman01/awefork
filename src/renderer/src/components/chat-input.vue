<template>
  <form
    class="chat-input"
    :class="{ dragging: dragOver && allowAttachments }"
    @submit.prevent="submit"
    @dragover.prevent="onDragOver"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="chat-input-head">
      <span
        v-if="contextMeter"
        class="ctx-meter"
        :class="contextMeter.level"
        :title="contextMeter.title"
      >
        <span class="ctx-bar"><span class="ctx-fill" :style="{ width: contextMeter.width }"></span></span>
        <span class="ctx-pct">{{ contextMeter.pct }}</span>
        <span class="ctx-count">{{ contextMeter.count }}</span>
        <button
          v-if="canCompress"
          type="button"
          class="ctx-compress"
          :title="t('input.compressTitle')"
          @click.stop="emit('compress')"
        >⇲</button>
      </span>
      <input
        ref="fileInputEl"
        type="file"
        multiple
        hidden
        :accept="ATTACHMENT_ACCEPT"
        @change="onFilePicked"
      />
      <button
        v-if="allowAttachments"
        type="button"
        class="attach"
        :title="t('input.attachTitle')"
        @click="fileInputEl?.click()"
      >
        📎
      </button>
      <button
        type="button"
        class="preview"
        :class="{ on: previewing }"
        :title="previewing ? t('input.backToEdit') : t('input.previewTitle')"
        @click="togglePreview"
        >{{ previewing ? t("input.edit") : t("input.preview") }}</button>
      <button
        type="button"
        v-if="canUseParallelModels"
        class="parallel-toggle"
        :class="{ on: parallelMode }"
        :disabled="busy"
        :aria-pressed="parallelMode"
        @click="toggleParallelMode"
      >⇄ {{ t("input.parallelMode") }}</button>
    </div>
    <fieldset v-if="parallelMode && canUseParallelModels" class="parallel-panel parallel-composer" :disabled="busy">
      <div class="parallel-target-list">
        <span v-for="(choice, index) in parallelModels" :key="modelKey(choice)" class="parallel-model-chip">
          <button
            type="button"
            class="parallel-target-settings"
            :title="t('input.parallelModelSettings')"
            :aria-expanded="editingTarget === index"
            @click="editingTarget = editingTarget === index ? null : index"
          >
            <span class="parallel-model-index">{{ index + 1 }}</span>
            <span class="parallel-model-name" :title="modelLabel(choice)">{{ modelLabel(choice) }}</span>
            <span class="parallel-target-variant">{{ choice?.variant || t('input.parallelDefaultVariant') }}</span>
          </button>
          <button
            v-if="parallelModels.length > 1"
            type="button"
            :title="t('input.parallelRemoveModel')"
            @click="removeParallelModel(index)"
          >×</button>
        </span>
        <button
          v-if="parallelModels.length < 4"
          type="button"
          class="parallel-add-model"
          :aria-expanded="modelMenuOpen"
          @click="modelMenuOpen = !modelMenuOpen"
        >＋ {{ t("input.parallelAddModel") }}</button>
      </div>
      <div v-if="editingTarget !== null && !busy" class="parallel-target-options">
        <span>{{ modelLabel(parallelModels[editingTarget] ?? null) }}</span>
        <VariantPicker
          :model="parallelModels[editingTarget] ?? null"
          :models="models"
          @select="setParallelVariant(editingTarget, $event)"
        />
      </div>
      <div v-if="modelMenuOpen && !busy" class="parallel-model-menu">
        <input v-model="modelSearch" type="search" :placeholder="t('input.parallelSearchModel')" :aria-label="t('input.parallelSearchModel')" />
        <button
          v-for="option in availableParallelModels"
          :key="`${option.providerId}:${option.modelId}`"
          type="button"
          @click="addParallelModel(option)"
        ><strong>{{ option.modelName || option.modelId }}</strong><span class="parallel-provider">{{ option.providerName }}</span></button>
        <p v-if="availableParallelModels.length === 0">{{ t("input.parallelNoModels") }}</p>
      </div>
      <button
        type="button"
        class="parallel-summary-entry"
        :aria-expanded="summaryOptionsOpen"
        @click="summaryOptionsOpen = !summaryOptionsOpen"
      >
        <span class="parallel-summary-current" :title="modelLabel(summaryModel)">✦ {{ t("input.parallelSummaryWith") }} · {{ modelLabel(summaryModel) }}</span>
        <span>{{ t("input.parallelSummarySettings") }} {{ summaryOptionsOpen ? "▴" : "▾" }}</span>
      </button>
      <div v-if="summaryOptionsOpen && !busy" class="parallel-summary-options">
        <ModelPicker
          :model-value="summaryModel"
          :models="models"
          :favorite-models="favoriteModels"
          :recent-models="recentModels"
          :title="t('input.parallelSummaryWith')"
          @update:model-value="setSummaryModel"
          @toggle-favorite="$emit('toggle-favorite', $event)"
        />
        <span class="parallel-summary-label">{{ t("input.parallelSummaryLength") }}</span>
        <button type="button" :class="{ on: summaryLength === 'brief' }" @click="summaryLength = 'brief'">{{ t("input.parallelBrief") }}</button>
        <button type="button" :class="{ on: summaryLength === 'standard' }" @click="summaryLength = 'standard'">{{ t("input.parallelStandard") }}</button>
      </div>
    </fieldset>
    <div v-if="attachments.length > 0 || notice" class="chat-input-atts">
      <span v-for="a in attachments" :key="a.id" class="att-chip">
        <img v-if="a.mime.startsWith('image/')" :src="a.dataUrl" class="att-thumb" alt="" />
        <span v-else class="att-ico">📎</span>
        <span class="att-name" :title="a.name">{{ a.name }}</span>
        <button type="button" class="att-x" :title="t('input.remove')" @click="removeAttachment(a.id)">✕</button>
      </span>
      <span v-if="notice" class="att-notice">{{ notice }}</span>
    </div>
    <textarea
      v-if="!previewing"
      ref="textareaEl"
      v-model="text"
      :placeholder="inputPlaceholder"
      :disabled="busy"
      rows="2"
      @keydown.enter.exact="onEnterKey"
      @keydown.tab.prevent="onTabKey"
      @paste="onPaste"
    ></textarea>
    <div v-else class="chat-input-preview">
      <MarkdownView v-if="text.trim()" :source="text" user />
      <p v-else class="chat-input-preview-empty">{{ t("input.previewEmpty") }}</p>
    </div>
    <div class="chat-input-foot">
      <template v-if="!parallelMode">
      <ModelPicker
        :model-value="model"
        :models="models"
        :favorite-models="favoriteModels"
        :recent-models="recentModels"
        :title="t('input.modelTitle')"
        @update:model-value="onModelPicked"
        @toggle-favorite="$emit('toggle-favorite', $event)"
      />
      <VariantPicker :model="model" :models="models" @select="onVariantPicked" />
      </template>
      <span v-else class="parallel-send-hint">{{ t("input.parallelSendCount", { n: parallelModels.length }) }}</span>
      <button v-if="!running" type="submit" class="send" :disabled="!text.trim() || busy || (parallelMode && parallelModels.length < 2)">{{ parallelMode ? t("input.parallelSend", { n: parallelModels.length }) : t("input.send") }}</button>
      <button v-else type="button" class="abort" @click="$emit('abort')">{{ t("input.stop") }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ATTACHMENT_ACCEPT } from "../../../shared/attachment-kinds";
import type { BackendId } from "../../../shared/backend";
import type { ModelChoice, ModelOption, PromptAttachment } from "../../../shared/types";
import { type DraftAttachment, readAttachments, toPromptAttachments } from "../attachments";
import type { ContextUsage } from "../context-usage";
import { formatTokenCount } from "../format";
import { t } from "../i18n";
import {
  indentLines,
  looksLikeCode,
  outdentLines,
  type TextEdit,
  wrapCodeFence,
} from "../input-editing";
import type { ParallelSummarySettings } from "../state";
import { MarkdownView } from "./markdown-view";
import ModelPicker from "./model-picker.vue";
import VariantPicker from "./variant-picker.vue";

const props = withDefaults(
  defineProps<{
    running: boolean;
    parallelSending?: boolean;
    sendParallel?: (
      text: string,
      attachments: PromptAttachment[],
      targets: readonly (ModelChoice | null)[],
      summary: ParallelSummarySettings,
    ) => Promise<boolean>;
    backend: BackendId;
    model: ModelChoice | null;
    models: readonly ModelOption[];
    /** Backend capability gate: codex takes no attachments at all. */
    allowAttachments?: boolean;
    /** Hide parallel prompting when the backend cannot select models. */
    allowModelPicker?: boolean;
    /** Starred models for the picker's Favorites group. */
    favoriteModels?: readonly ModelChoice[];
    /** Recent hand-picked models for the picker's Recent group. */
    recentModels?: readonly ModelChoice[];
    /** Session context budget for the head-row meter; null hides it. */
    context?: ContextUsage | null;
    /** Backend capability gate: show the meter's compress button only where summarize exists. */
    canCompress?: boolean;
  }>(),
  {
    allowAttachments: true,
    allowModelPicker: true,
    favoriteModels: () => [],
    recentModels: () => [],
    context: null,
    canCompress: false,
    parallelSending: false,
  },
);
const emit = defineEmits<{
  send: [text: string, attachments: PromptAttachment[]];
  abort: [];
  "set-model": [model: ModelChoice | null];
  "toggle-favorite": [model: ModelChoice];
  compress: [];
}>();

const text = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const attachments = ref<DraftAttachment[]>([]);
const dragOver = ref(false);
const notice = ref("");
const previewing = ref(false);
const parallelMode = ref(false);
const parallelModels = ref<(ModelChoice | null)[]>([]);
const modelMenuOpen = ref(false);
const modelSearch = ref("");
const summaryOptionsOpen = ref(false);
const summaryModel = ref<ModelChoice | null>(null);
const editingTarget = ref<number | null>(null);
const summaryLength = ref<ParallelSummarySettings["length"]>("brief");
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let preferenceBackend: BackendId | null = null;

const busy = computed(() => props.running || props.parallelSending);
const canUseParallelModels = computed(
  () => props.allowModelPicker && !!props.sendParallel && props.models.length > 0,
);
const availableParallelModels = computed(() => {
  const query = modelSearch.value.trim().toLocaleLowerCase();
  return props.models.filter((option) => {
    const key = modelKey(option);
    if (parallelModels.value.some((choice) => choice !== null && modelKey(choice) === key))
      return false;
    if (!query) return true;
    return `${option.modelName} ${option.modelId} ${option.providerName}`
      .toLocaleLowerCase()
      .includes(query);
  });
});

// Grow the box with the draft instead of scrolling inside it; two rows is the
// floor and roughly a half pane the ceiling.
const MAX_INPUT_HEIGHT_PX = 200;

function fitTextarea(): void {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
}

watch(text, () => {
  void nextTick(fitTextarea);
});
function loadParallelPreferences(): void {
  preferenceBackend = props.backend;
  try {
    const raw = localStorage.getItem(`awefork:parallel:${props.backend}`);
    if (!raw) {
      summaryModel.value = null;
      summaryLength.value = "brief";
      return;
    }
    const saved = JSON.parse(raw) as { model?: ModelChoice | null; length?: string };
    summaryModel.value = saved.model ?? null;
    summaryLength.value = saved.length === "standard" ? "standard" : "brief";
  } catch {
    summaryModel.value = null;
    summaryLength.value = "brief";
  }
}

function persistParallelPreferences(): void {
  if (preferenceBackend !== props.backend) return;
  try {
    localStorage.setItem(
      `awefork:parallel:${props.backend}`,
      JSON.stringify({
        model: summaryModel.value,
        length: summaryLength.value,
      }),
    );
  } catch {
    // Settings remain available for this window when local storage is unavailable.
  }
}

onMounted(() => {
  loadParallelPreferences();
  fitTextarea();
});
watch(
  () => props.backend,
  () => {
    parallelMode.value = false;
    parallelModels.value = [];
    modelMenuOpen.value = false;
    loadParallelPreferences();
  },
);
watch([summaryModel, summaryLength], persistParallelPreferences);
watch(canUseParallelModels, (available) => {
  if (!available) parallelMode.value = false;
});
watch(busy, (value) => {
  if (!value) return;
  modelMenuOpen.value = false;
  editingTarget.value = null;
});

function modelKey(model: ModelChoice | ModelOption | null): string {
  return model ? `${model.providerId}:${model.modelId}` : "default";
}

function modelLabel(model: ModelChoice | null): string {
  if (!model) return t("input.parallelDefaultModel");
  const option = props.models.find((item) => modelKey(item) === modelKey(model));
  return option?.modelName || option?.modelId || model.modelId;
}

function toggleParallelMode(): void {
  if (busy.value || !canUseParallelModels.value) return;
  parallelMode.value = !parallelMode.value;
  modelMenuOpen.value = false;
  if (parallelMode.value && parallelModels.value.length === 0) {
    parallelModels.value = [props.model ? { ...props.model } : null];
  }
}

function addParallelModel(option: ModelOption): void {
  if (busy.value || parallelModels.value.length >= 4) return;
  parallelModels.value.push({ providerId: option.providerId, modelId: option.modelId });
  modelMenuOpen.value = false;
  modelSearch.value = "";
}

function removeParallelModel(index: number): void {
  if (busy.value) return;
  parallelModels.value.splice(index, 1);
  editingTarget.value = null;
}

function setParallelVariant(index: number | null, variant: string | null): void {
  if (busy.value || index === null) return;
  const model = parallelModels.value[index];
  if (!model) return;
  const next = { ...model };
  if (variant) next.variant = variant;
  else delete next.variant;
  parallelModels.value[index] = next;
}

function setSummaryModel(model: ModelChoice | null): void {
  if (busy.value) return;
  summaryModel.value = model ? { ...model } : null;
}

const inputPlaceholder = computed(() => {
  if (props.running) return t("input.placeholderRunning");
  return t("input.placeholder");
});

/**
 * The head-row context meter. Sits on the left of the otherwise-empty head
 * row so it never competes with the footer's model picker; renders nothing
 * when the backend reports no usage for the session.
 */
const contextMeter = computed(() => {
  const context = props.context;
  if (!context) return null;
  const ratio = context.ratio;
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const level = ratio === null ? "" : ratio >= 0.9 ? "hot" : ratio >= 0.7 ? "warm" : "";
  const count =
    context.window === null
      ? formatTokenCount(context.used)
      : `${formatTokenCount(context.used)} / ${formatTokenCount(context.window)}`;
  const title =
    context.window === null
      ? t("input.contextTitleNoWindow", { used: formatTokenCount(context.used) })
      : t("input.contextTitle", {
          used: formatTokenCount(context.used),
          window: formatTokenCount(context.window),
          pct: pct ?? 0,
        }) + (ratio !== null && ratio >= 0.9 ? `\n${t("input.contextHint")}` : "");
  return {
    level,
    pct: pct === null ? "" : `${Math.max(pct, context.used > 0 ? 1 : 0)}%`,
    width: ratio === null ? "0%" : `${Math.min(Math.round(ratio * 100), 100)}%`,
    count,
    title,
  };
});

/** The selected model's capability, when the catalog already knows it. */
const canAttach = computed(() => {
  const choices = parallelMode.value ? parallelModels.value : [props.model];
  return choices.every((choice) => {
    if (!choice) return true;
    const option = props.models.find(
      (item) => item.providerId === choice.providerId && item.modelId === choice.modelId,
    );
    return option ? option.attachment : true;
  });
});

function flashNotice(message: string): void {
  notice.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = "";
  }, 2500);
}

function addFiles(files: FileList | File[]): void {
  if (!props.allowAttachments) {
    flashNotice(t("input.noAttachments"));
    return;
  }
  const notes: string[] = [];
  let list = [...files];
  // The attachment capability flags media input (images); plain-text
  // attachments ride along with any model.
  if (!canAttach.value) {
    if (list.some((f) => f.type.startsWith("image/"))) {
      list = list.filter((f) => !f.type.startsWith("image/"));
      notes.push(t("input.noImageSupport"));
    }
  }
  if (list.length === 0) {
    if (notes.length > 0) flashNotice(notes.join("；"));
    return;
  }
  void readAttachments(list).then(({ staged, notes: stageNotes }) => {
    if (staged.length > 0) attachments.value = [...attachments.value, ...staged];
    flashNotice([...notes, ...stageNotes].join("；"));
  });
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) addFiles(input.files);
  input.value = ""; // so picking the same file again still fires change
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter((a) => a.id !== id);
}

function onPaste(event: ClipboardEvent): void {
  const data = event.clipboardData;
  const files = data?.files;
  if (files && files.length > 0) {
    // Swallow the paste either way: a pasted file would otherwise land as
    // nothing (or garbage) in the textarea once we refuse it.
    event.preventDefault();
    addFiles(files);
    return;
  }
  const el = textareaEl.value;
  const pasted = data?.getData("text/plain") ?? "";
  if (!el || !looksLikeCode(pasted)) return;
  // An odd number of ``` markers above the caret means the user is already
  // typing inside their own fence — placing the code there verbatim.
  const fences = (text.value.slice(0, el.selectionStart).match(/```/g) ?? []).length;
  if (fences % 2 === 1) return;
  event.preventDefault();
  insertAtCaret(el, wrapCodeFence(pasted));
  flashNotice(t("input.codeFenceNotice"));
}

/** Splice an edit in through insertText so it stays on the undo stack. */
function applyTextEdit(el: HTMLTextAreaElement, edit: TextEdit): void {
  el.focus();
  el.setSelectionRange(edit.from, edit.to);
  if (document.execCommand("insertText", false, edit.insert)) {
    el.setSelectionRange(edit.start, edit.end);
    return;
  }
  text.value = text.value.slice(0, edit.from) + edit.insert + text.value.slice(edit.to);
  void nextTick(() => el.setSelectionRange(edit.start, edit.end));
}

/** execCommand-less fallback path for insertText; caret lands after the text. */
function insertAtCaret(el: HTMLTextAreaElement, insert: string): void {
  el.focus();
  if (document.execCommand("insertText", false, insert)) return;
  const from = el.selectionStart;
  const to = el.selectionEnd;
  text.value = text.value.slice(0, from) + insert + text.value.slice(to);
}

function onTabKey(event: KeyboardEvent): void {
  const el = textareaEl.value;
  if (!el || event.isComposing) return;
  const edit = event.shiftKey
    ? outdentLines(text.value, el.selectionStart, el.selectionEnd)
    : indentLines(text.value, el.selectionStart, el.selectionEnd);
  applyTextEdit(el, edit);
}

function togglePreview(): void {
  previewing.value = !previewing.value;
  if (!previewing.value) {
    void nextTick(() => {
      fitTextarea();
      textareaEl.value?.focus();
    });
  }
}

function onDragOver(): void {
  if (props.allowAttachments) dragOver.value = true;
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  if (!props.allowAttachments) return;
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  addFiles(files);
}

onUnmounted(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
});

/** Keep the effort level across a model switch when the new model has it too. */
function onModelPicked(choice: ModelChoice | null): void {
  const previous = props.model?.variant ?? null;
  if (choice && previous) {
    const supported =
      props.models.find((m) => m.providerId === choice.providerId && m.modelId === choice.modelId)
        ?.variants ?? [];
    if (supported.includes(previous)) {
      emit("set-model", { ...choice, variant: previous });
      return;
    }
  }
  emit("set-model", choice);
}

function onVariantPicked(variant: string | null): void {
  if (!props.model) return;
  emit("set-model", { ...props.model, variant });
}

/**
 * Enter during IME composition confirms the candidate word instead of sending;
 * keyCode 229 backstops
 * Safari, which leaves isComposing unset on the committing keydown.
 */
function onEnterKey(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  submit();
}

async function submit(): Promise<void> {
  const value = text.value.trim();
  if (!value || busy.value) return;
  if (
    parallelMode.value &&
    !canAttach.value &&
    attachments.value.some((attachment) => attachment.mime.startsWith("image/"))
  ) {
    flashNotice(t("input.parallelNoImageSupport"));
    return;
  }
  const promptAttachments = toPromptAttachments(attachments.value);
  if (parallelMode.value) {
    if (parallelModels.value.length < 2) {
      flashNotice(t("input.parallelNeedTwo"));
      return;
    }
    if (!props.sendParallel) return;
    try {
      const accepted = await props.sendParallel(
        value,
        promptAttachments,
        [...parallelModels.value],
        {
          model: summaryModel.value ? { ...summaryModel.value } : null,
          length: summaryLength.value,
        },
      );
      if (!accepted) return;
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : String(error));
      return;
    }
  } else {
    emit("send", value, promptAttachments);
  }
  text.value = "";
  attachments.value = [];
  previewing.value = false;
}

/** Pane host pulls this after a new conversation so the first prompt starts typing at once. */
function focus(): void {
  textareaEl.value?.focus();
}

defineExpose({ focus });
</script>

<style scoped>
.parallel-composer {
  margin: 0;
  min-width: 0;
  padding: 8px;
}

.parallel-composer .parallel-target-list {
  gap: 5px;
}

.parallel-composer .parallel-model-chip {
  max-width: 100%;
  gap: 0;
  padding: 0 4px 0 0;
}

.parallel-composer .parallel-model-chip .parallel-target-settings {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 0 1 auto;
  width: auto;
  height: auto;
  border-radius: 999px;
  gap: 5px;
  padding: 4px 5px;
  color: inherit;
}

.parallel-composer .parallel-model-chip .parallel-target-settings:hover {
  background: var(--primary-soft);
  color: var(--primary-deep);
}

.parallel-target-variant {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--ink-faint);
}

.parallel-target-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 2px 0;
  font-size: 11px;
  color: var(--ink-faint);
}

.parallel-target-options > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parallel-summary-entry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 7px;
  border-top: 1px solid var(--line);
  padding: 7px 1px 0;
  text-align: left;
  color: var(--ink-faint);
  font-size: 10.5px;
}

.parallel-summary-entry > span:last-child {
  flex: 0 0 auto;
  color: var(--primary-deep);
}

.parallel-summary-current {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.parallel-composer .parallel-summary-options {
  flex-wrap: wrap;
  align-items: center;
}

.parallel-composer .parallel-summary-options :deep(.mp) {
  flex-basis: 100%;
  min-width: 0;
  margin-bottom: 4px;
}

.parallel-composer .parallel-summary-options :deep(.mp-btn) {
  max-width: 100%;
}

.parallel-composer:disabled {
  opacity: 0.65;
}
</style>
