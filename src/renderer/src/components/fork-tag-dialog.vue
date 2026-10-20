<template>
  <div
    v-if="ask"
    class="interaction-backdrop"
    role="presentation"
    @click="cancel"
  >
    <section
      class="interaction-dialog fork-tag-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('forktag.ariaLabel')"
      @click.stop
    >
      <p class="interaction-kicker">{{ t("forktag.kicker") }}</p>
      <h2>{{ t("forktag.title", { title: ask.parentTitle }) }}</h2>
      <div class="fork-tag-chips" :aria-label="t('forktag.chipsLabel')">
        <span
          v-for="tag in ask.tags"
          :key="tag"
          class="tag-chip"
          :style="{ color: tagColor(tag), background: tagBg(tag) }"
          >{{ tag }}</span
        >
      </div>
      <p class="interaction-detail">{{ t("forktag.detail") }}</p>
      <label class="fork-tag-remember">
        <input v-model="remember" type="checkbox" />
        <span>{{ t("forktag.remember") }}</span>
      </label>
      <div class="interaction-actions">
        <button type="button" class="interaction-deny" @click="choose('skip')">{{ t("forktag.skip") }}</button>
        <button type="button" class="interaction-allow" @click="choose('inherit')">{{ t("forktag.inherit") }}</button>
      </div>
      <p class="interaction-timeout">{{ t("forktag.esc") }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { t } from "../i18n";
import { answerForkTagAsk, store, tagBg, tagColor } from "../state";

const ask = computed(() => store.forkTagAsk);
const remember = ref(false);

// Fresh ask, fresh checkbox — a stale tick from the previous fork must not
// silently pin a preference the user never meant to keep.
watch(
  () => store.forkTagAsk,
  () => {
    remember.value = false;
  },
);

// Esc cancels the fork/send that triggered the ask; nothing has fired yet.
// An Esc that only dismisses the IME candidate window is not a cancel
// (keyCode 229 covers engines that skip isComposing — same guard everywhere).
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape" && store.forkTagAsk) {
    event.preventDefault();
    cancel();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function choose(choice: "inherit" | "skip"): void {
  answerForkTagAsk(choice, remember.value);
}

function cancel(): void {
  answerForkTagAsk("cancel", false);
}
</script>
