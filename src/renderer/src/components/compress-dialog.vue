<template>
  <div
    v-if="ask"
    class="interaction-backdrop"
    role="presentation"
    @click="cancel"
  >
    <section
      class="interaction-dialog compress-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('compress.ariaLabel')"
      @click.stop
    >
      <p class="interaction-kicker">{{ t("compress.kicker") }}</p>
      <h2>{{ t("compress.title", { title: ask.title }) }}</h2>
      <ul class="compress-points">
        <li>{{ t("compress.point1") }}</li>
        <li>{{ t("compress.point2") }}</li>
        <li>{{ t("compress.point3") }}</li>
      </ul>
      <div class="compress-model">
        <span class="compress-model-label">{{ t("compress.modelLabel") }}</span>
        <ModelPicker v-model="model" :models="store.models" :title="t('compress.modelTitle')" />
      </div>
      <p v-if="model === null" class="compress-model-hint">{{ t("compress.modelHint") }}</p>
      <div class="interaction-actions">
        <button type="button" class="interaction-deny" @click="cancel">{{ t("compress.cancel") }}</button>
        <button
          type="button"
          class="interaction-allow"
          :disabled="model === null"
          @click="confirm"
        >{{ t("compress.confirm") }}</button>
      </div>
      <p class="interaction-timeout">{{ t("compress.esc") }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ModelChoice } from "../../../shared/types";
import { t } from "../i18n";
import { answerCompressAsk, store } from "../state";
import ModelPicker from "./model-picker.vue";

const ask = computed(() => store.compressAsk);
const model = ref<ModelChoice | null>(null);

// Fresh ask, fresh pick: seed the dialog with the preset (last turn's model
// → lastModel → catalog head) so confirm is one click for the common case.
watch(
  () => store.compressAsk,
  (ask) => {
    model.value = ask?.model ?? null;
  },
  { immediate: true },
);

// Esc cancels; nothing has fired yet (the summarize call goes out only on
// confirm). An Esc that only dismisses the IME candidate window is not a
// cancel (keyCode 229 covers engines that skip isComposing).
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape" && store.compressAsk) {
    event.preventDefault();
    cancel();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function confirm(): void {
  if (model.value) answerCompressAsk(model.value);
}

function cancel(): void {
  answerCompressAsk(null);
}
</script>
