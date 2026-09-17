<template>
  <form
    class="cmp-composer"
    :class="{ dragging: dragOver && allowAttachments }"
    @submit.prevent="submit"
    @dragover.prevent="onDragOver"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="cmp-composer-head">
      <span>⇄ 同题投递</span>
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
        title="添加附件（图片、文档、文本）"
        @click="fileInputEl?.click()"
      >📎</button>
      <button
        type="button"
        class="preview"
        :class="{ on: previewing }"
        :title="previewing ? '回到编辑' : '预览发送后的 Markdown 效果'"
        @click="previewing = !previewing"
      >{{ previewing ? "✎ 编辑" : "👁 预览" }}</button>
    </div>

    <div class="cmp-targets">
      <div v-for="target in targets" :key="target.id" class="cmp-target" :class="target.side">
        <label class="cmp-target-toggle">
          <input v-model="selected[target.id]" type="checkbox" />
          <span :title="target.title">{{ target.title }}</span>
        </label>
        <span v-if="target.running" class="cmp-target-running">○ 运行中</span>
        <button
          v-if="target.running"
          type="button"
          class="cmp-target-stop"
          :disabled="stopping[target.id]"
          @click="stop(target.id)"
        >■ 停止</button>
        <div v-else class="cmp-target-models">
          <ModelPicker
            :model-value="target.model"
            :models="models"
            :title="`选择「${target.title}」的模型`"
            @update:model-value="setModel(target.id, $event)"
          />
          <VariantPicker
            :model="target.model"
            :models="models"
            :title="`选择「${target.title}」的思考档位`"
            @select="setVariant(target.id, $event)"
          />
        </div>
        <span v-if="errors[target.id]" class="cmp-target-error" :title="errors[target.id]">⚠ {{ errors[target.id] }}</span>
      </div>
    </div>

    <div v-if="attachments.length > 0 || notice || unsupportedImageTargets.length > 0" class="chat-input-atts">
      <span v-for="attachment in attachments" :key="attachment.id" class="att-chip">
        <img v-if="attachment.mime.startsWith('image/')" :src="attachment.dataUrl" class="att-thumb" alt="" />
        <span v-else class="att-ico">📎</span>
        <span class="att-name" :title="attachment.name">{{ attachment.name }}</span>
        <button type="button" class="att-x" title="移除" @click="removeAttachment(attachment.id)">✕</button>
      </span>
      <span v-if="notice" class="att-notice">{{ notice }}</span>
      <span v-if="unsupportedImageTargets.length > 0" class="att-notice">所选模型不支持图片：{{ unsupportedImageTargets.join("、") }}</span>
    </div>

    <textarea
      v-if="!previewing"
      ref="textareaEl"
      v-model="text"
      placeholder="向选中的会话发送同一条消息…"
      rows="2"
      @keydown.enter.exact="onEnterKey"
      @keydown.tab.prevent="onTabKey"
      @paste="onPaste"
    ></textarea>
    <div v-else class="chat-input-preview">
      <MarkdownView v-if="text.trim()" :source="text" user />
      <p v-else class="chat-input-preview-empty">输入内容后，这里显示发送后的 Markdown 效果</p>
    </div>

    <div class="cmp-composer-foot">
      <span class="cmp-composer-hint">⌘↵ 发送 · 两侧模型可独立选择</span>
      <button type="submit" class="send" :disabled="!canSend">{{ sendLabel }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ATTACHMENT_ACCEPT } from "../../../shared/attachment-kinds";
import type { ModelChoice, ModelOption, PromptAttachment } from "../../../shared/types";
import { type DraftAttachment, readAttachments, toPromptAttachments } from "../attachments";
import {
  indentLines,
  looksLikeCode,
  outdentLines,
  type TextEdit,
  wrapCodeFence,
} from "../input-editing";
import type { PromptSendResult } from "../state";
import { MarkdownView } from "./markdown-view";
import ModelPicker from "./model-picker.vue";
import VariantPicker from "./variant-picker.vue";

interface CompareTarget {
  id: string;
  side: "left" | "right";
  title: string;
  model: ModelChoice | null;
  running: boolean;
}

const props = defineProps<{
  targets: readonly CompareTarget[];
  models: readonly ModelOption[];
  allowAttachments: boolean;
  send: (
    ids: readonly string[],
    text: string,
    models: Readonly<Record<string, ModelChoice | null>>,
    attachments: PromptAttachment[],
  ) => Promise<PromptSendResult[]>;
  abort: (sessionId: string) => Promise<string | null>;
}>();
const emit = defineEmits<{ "set-model": [sessionId: string, model: ModelChoice | null] }>();

const text = ref("");
const attachments = ref<DraftAttachment[]>([]);
const selected = ref<Record<string, boolean>>({});
const errors = ref<Record<string, string>>({});
const stopping = ref<Record<string, boolean>>({});
const previewing = ref(false);
const dragOver = ref(false);
const notice = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);

watch(
  () => props.targets.map((target) => target.id),
  (ids) => {
    selected.value = Object.fromEntries(ids.map((id) => [id, selected.value[id] ?? true]));
    errors.value = {};
  },
  { immediate: true },
);

const selectedTargets = computed(() =>
  props.targets.filter((target) => selected.value[target.id] !== false),
);
const readyTargets = computed(() => selectedTargets.value.filter((target) => !target.running));
const hasImageAttachment = computed(() =>
  attachments.value.some((attachment) => attachment.mime.startsWith("image/")),
);
const unsupportedImageTargets = computed(() =>
  hasImageAttachment.value
    ? readyTargets.value
        .filter((target) => {
          if (!target.model) return false;
          return (
            props.models.find(
              (model) =>
                model.providerId === target.model?.providerId &&
                model.modelId === target.model?.modelId,
            )?.attachment === false
          );
        })
        .map((target) => target.title)
    : [],
);
const canSend = computed(
  () =>
    text.value.trim().length > 0 &&
    readyTargets.value.length > 0 &&
    unsupportedImageTargets.value.length === 0,
);
const sendLabel = computed(() => {
  const count = readyTargets.value.length;
  if (count === 2) return "发送到两边 ➤";
  if (count === 1) return `发送到${readyTargets.value[0]?.side === "left" ? "左侧" : "右侧"} ➤`;
  return "选择可发送会话";
});

function setModel(sessionId: string, model: ModelChoice | null): void {
  const previous = props.targets.find((target) => target.id === sessionId)?.model?.variant ?? null;
  if (model && previous) {
    const supported =
      props.models.find(
        (item) => item.providerId === model.providerId && item.modelId === model.modelId,
      )?.variants ?? [];
    emit(
      "set-model",
      sessionId,
      supported.includes(previous) ? { ...model, variant: previous } : model,
    );
    return;
  }
  emit("set-model", sessionId, model);
}

function setVariant(sessionId: string, variant: string | null): void {
  const model = props.targets.find((target) => target.id === sessionId)?.model;
  if (model) emit("set-model", sessionId, { ...model, variant });
}

function flashNotice(message: string): void {
  notice.value = message;
  window.setTimeout(() => {
    if (notice.value === message) notice.value = "";
  }, 2500);
}

function addFiles(files: FileList | File[]): void {
  if (!props.allowAttachments) {
    flashNotice("当前后端不支持附件");
    return;
  }
  void readAttachments([...files]).then(({ staged, notes }) => {
    if (staged.length > 0) attachments.value = [...attachments.value, ...staged];
    if (notes.length > 0) flashNotice(notes.join("；"));
  });
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) addFiles(input.files);
  input.value = "";
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter((item) => item.id !== id);
}

function onDragOver(): void {
  if (props.allowAttachments) dragOver.value = true;
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) addFiles(files);
}

function applyTextEdit(el: HTMLTextAreaElement, edit: TextEdit): void {
  el.focus();
  el.setSelectionRange(edit.from, edit.to);
  if (document.execCommand("insertText", false, edit.insert)) {
    el.setSelectionRange(edit.start, edit.end);
    return;
  }
  text.value = text.value.slice(0, edit.from) + edit.insert + text.value.slice(edit.to);
}

function onTabKey(event: KeyboardEvent): void {
  const el = textareaEl.value;
  if (!el || event.isComposing) return;
  applyTextEdit(
    el,
    event.shiftKey
      ? outdentLines(text.value, el.selectionStart, el.selectionEnd)
      : indentLines(text.value, el.selectionStart, el.selectionEnd),
  );
}

function onPaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files;
  if (files && files.length > 0) {
    event.preventDefault();
    addFiles(files);
    return;
  }
  const el = textareaEl.value;
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  if (!el || !looksLikeCode(pasted)) return;
  if ((text.value.slice(0, el.selectionStart).match(/```/g) ?? []).length % 2 === 1) return;
  event.preventDefault();
  applyTextEdit(el, {
    from: el.selectionStart,
    to: el.selectionEnd,
    insert: wrapCodeFence(pasted),
    start: el.selectionStart + wrapCodeFence(pasted).length,
    end: el.selectionStart + wrapCodeFence(pasted).length,
  });
}

function onEnterKey(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void submit();
}

async function submit(): Promise<void> {
  if (!canSend.value) return;
  const targets = readyTargets.value;
  const models = Object.fromEntries(targets.map((target) => [target.id, target.model]));
  errors.value = {};
  const results = await props.send(
    targets.map((target) => target.id),
    text.value.trim(),
    models,
    toPromptAttachments(attachments.value),
  );
  const failed = Object.fromEntries(
    results.flatMap((result) => (result.error ? [[result.sessionId, result.error]] : [])),
  );
  errors.value = failed;
  if (Object.keys(failed).length < results.length) {
    text.value = "";
    attachments.value = [];
    previewing.value = false;
  }
}

async function stop(sessionId: string): Promise<void> {
  stopping.value = { ...stopping.value, [sessionId]: true };
  const error = await props.abort(sessionId);
  if (error) errors.value = { ...errors.value, [sessionId]: error };
  stopping.value = { ...stopping.value, [sessionId]: false };
}
</script>
