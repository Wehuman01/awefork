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
      aria-label="压缩会话"
      @click.stop
    >
      <p class="interaction-kicker">🧹 压缩会话</p>
      <h2>把「{{ ask.title }}」的历史折叠成摘要</h2>
      <ul class="compress-points">
        <li>历史消息仍完整保留，随时可以回看</li>
        <li>之后的对话只携带摘要 + 最近几轮，不再带上全部历史</li>
        <li>摘要由下面的模型生成，可以换成更便宜的</li>
      </ul>
      <div class="compress-model">
        <span class="compress-model-label">摘要模型</span>
        <ModelPicker v-model="model" :models="store.models" title="选一个写摘要的模型" />
      </div>
      <p v-if="model === null" class="compress-model-hint">这个后端要求指定模型，请选一个</p>
      <div class="interaction-actions">
        <button type="button" class="interaction-deny" @click="cancel">取消</button>
        <button
          type="button"
          class="interaction-allow"
          :disabled="model === null"
          @click="confirm"
        >🗜 开始压缩</button>
      </div>
      <p class="interaction-timeout">Esc 取消</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ModelChoice } from "../../../shared/types";
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
