<template>
  <div
    v-if="attachmentPreview.open"
    class="att-preview-backdrop"
    @click="closeAttachmentPreview"
  >
    <figure class="att-preview" @click.stop>
      <figcaption class="att-preview-head">
        <span class="att-preview-name" :title="attachmentPreview.name">{{
          attachmentPreview.name
        }}</span>
        <button
          type="button"
          class="att-preview-x"
          :title="t('attachments.previewClose')"
          @click="closeAttachmentPreview"
          >✕</button
        >
      </figcaption>
      <div class="att-preview-body">
        <p v-if="attachmentPreview.loading" class="att-preview-status">
          {{ t("attachments.previewLoading") }}
        </p>
        <img
          v-else-if="attachmentPreview.dataUrl"
          :src="attachmentPreview.dataUrl"
          :alt="attachmentPreview.name"
        />
        <p v-else-if="attachmentPreview.error" class="att-preview-status att-preview-error">
          {{ attachmentPreview.error }}
        </p>
      </div>
    </figure>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { attachmentPreview, closeAttachmentPreview } from "../attachment-preview";
import { t } from "../i18n";

/** Esc closes the overlay, the same contract as the other floating panels. */
function onDocKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && attachmentPreview.open) {
    event.preventDefault();
    event.stopPropagation();
    closeAttachmentPreview();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onDocKeydown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onDocKeydown);
});
</script>
