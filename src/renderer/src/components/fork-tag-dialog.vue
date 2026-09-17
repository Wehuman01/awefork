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
      aria-label="分叉时继承标签"
      @click.stop
    >
      <p class="interaction-kicker">即将分叉</p>
      <h2>把「{{ ask.parentTitle }}」的标签带给新会话吗？</h2>
      <div class="fork-tag-chips" aria-label="将继承的标签">
        <span
          v-for="tag in ask.tags"
          :key="tag"
          class="tag-chip"
          :style="{ color: tagColor(tag), background: tagBg(tag) }"
          >{{ tag }}</span
        >
      </div>
      <p class="interaction-detail">只影响这次新建的分支，已存在的子会话不受影响。</p>
      <label class="fork-tag-remember">
        <input v-model="remember" type="checkbox" />
        <span>记住本会话的选择（之后分叉不再询问，可在标签菜单里改）</span>
      </label>
      <div class="interaction-actions">
        <button type="button" class="interaction-deny" @click="choose('skip')">不继承</button>
        <button type="button" class="interaction-allow" @click="choose('inherit')">继承</button>
      </div>
      <p class="interaction-timeout">Esc 取消本次分叉</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
