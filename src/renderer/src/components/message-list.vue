<template>
  <section class="message-list" ref="listEl">
    <slot name="context" />
    <article v-for="message in messages" :key="message.id" class="message" :class="message.role">
      <template v-if="message.role === 'user'">
        <!-- compression marker row: not conversation content, a divider marking
             "the earlier history has been folded into a summary" -->
        <div v-if="message.compaction" class="compaction-banner" role="separator">
          <span class="compaction-glyph">🧹</span>
          <span class="compaction-text">{{ t("msg.compactionBanner") }}</span>
        </div>
        <div v-else class="message-row user-row">
          <div class="user-body">
            <details v-if="message.id === collapsedUserMessageId" class="message-source-input">
              <summary>{{ collapsedUserMessageLabel }}</summary>
              <MarkdownView :source="message.text" user />
            </details>
            <MarkdownView v-else :source="message.text" user />
            <p v-if="message.attachmentNames.length > 0" class="att-row">
              <button
                v-for="(name, i) in message.attachmentNames"
                :key="i"
                type="button"
                class="att-chip att-chip-btn"
                :title="t('attachments.preview')"
                @click="previewAttachment(message, i)"
                >📎 {{ name }}</button
              >
            </p>
          </div>
          <span class="avatar user">🍑</span>
        </div>
      </template>
      <template v-else>
        <div class="message-row">
          <span class="avatar bot">✨</span>
          <div class="message-body">
            <button
              v-if="message.text"
              type="button"
              class="msg-copy"
              :title="copiedId === message.id ? t('msg.copied') : t('msg.copyReply')"
              @click="copyMessage(message)"
            >{{ copiedId === message.id ? "✓" : "⧉" }}</button>
            <p v-if="message.toolNames.length > 0" class="tool-row">
              <span class="tool-chip lav" :title="message.toolNames.join(' · ')">{{
                toolSummary(message.toolNames)
              }}</span>
            </p>
            <details v-if="message.thinking" class="thought">
              <summary class="thought-toggle">Thought</summary>
              <div class="thought-body"><MarkdownView :source="message.thinking" /></div>
            </details>
            <MarkdownView v-if="message.text" :source="message.text" />
            <p v-else-if="message.error" class="message-text run-error">
              {{ t("msg.runFailed", { error: message.error }) }}
            </p>
            <button
              v-if="message.error"
              type="button"
              class="retry-now"
              :title="t('msg.retryTitle')"
              @click="emit('retry')"
            >{{ t("msg.retryButton") }}</button>
          </div>
        </div>
      </template>
    </article>
    <article v-if="running" class="message assistant">
      <div class="message-row">
        <span class="avatar bot">✨</span>
        <div class="message-body">
          <p class="tool-row"><span class="tool-chip running">running…</span></p>
          <template v-for="row in liveRows" :key="row.part.partId">
            <!-- A live tool part streams as a chip while the turn runs; the
                 settled row's full tool list lands via the idle reload. -->
            <p v-if="row.part.kind === 'tool'" class="tool-row">
              <span class="tool-chip" :class="row.part.endedAt === null ? 'running' : 'lav'">
                {{ row.part.text }}{{ row.part.endedAt === null ? "…" : "" }}
              </span>
            </p>
            <!-- Reasoning with no readable text (codex encrypts its
                 chain-of-thought): a quiet one-liner that says it thought and
                 for how long, never a box the reader can open onto nothing. -->
            <p
              v-else-if="row.blankThinking"
              class="thought-bare"
              :class="{ done: row.part.endedAt !== null }"
            >
              <span v-if="row.part.endedAt === null" class="spinner" aria-hidden="true"></span>
              <span class="thought-title">{{ row.title }}</span>
              <span v-if="row.duration" class="thought-meta">· {{ row.duration }}</span>
            </p>
            <details
              v-else-if="row.part.kind === 'thinking'"
              class="thought streaming-thought"
              :class="{ done: row.part.endedAt !== null }"
              :open="row.part.endedAt === null"
            >
              <summary class="thought-toggle">
                <span v-if="row.part.endedAt === null" class="spinner" aria-hidden="true"></span>
                <span class="thought-title">{{ row.title }}</span>
                <span v-if="row.duration" class="thought-meta">· {{ row.duration }}</span>
              </summary>
              <div class="thought-body">
                <MarkdownView :source="row.part.text" />
                <span v-if="row.part.endedAt === null" class="stream-caret"></span>
              </div>
            </details>
            <template v-else>
              <MarkdownView :source="row.part.text" class="stream" />
              <span v-if="row.caret" class="stream-caret"></span>
            </template>
          </template>
        </div>
      </div>
    </article>
    <!--
      Reading back through the story stops the stream from following, which is
      right — but it also leaves no way back to the newest text except dragging
      the scrollbar. This appears only while the reader is away from the bottom
      and says how much arrived since they left.
    -->
    <button
      v-if="awayFromBottom"
      type="button"
      class="jump-to-bottom"
      :title="t('msg.jumpToBottom')"
      @click="jumpToBottom"
    >
      <span aria-hidden="true">↓</span>
      <span v-if="newSinceAway > 0" class="jump-count">{{ newSinceAway }}</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import type { SessionSummary } from "../../../shared/types";
import { previewSentAttachment } from "../attachment-preview";
import { t } from "../i18n";
import { isSamePaneStart, promptAnchorScrollTop, shouldFollowStream } from "../message-list-scroll";
import type { LivePart, ReadonlyChatMessage } from "../state";
import { store } from "../state";
import { hasReadableThought, thoughtSummary } from "../thought";
import { toolSummary } from "../tool-summary";
import { MarkdownView } from "./markdown-view";

const props = defineProps<{
  session: SessionSummary | null;
  messages: readonly ReadonlyChatMessage[];
  running: boolean;
  /** The run's live parts in arrival order — each step's thinking and reply interleaved. */
  streamParts: readonly LivePart[];
  error: string | null;
  collapsedUserMessageId?: string | null;
  collapsedUserMessageLabel?: string;
}>();

/** A failed reply row offers its own retry jump; the host opens the draft. */
const emit = defineEmits<{ retry: [] }>();

/**
 * A chip is a name until it is clicked: the overlay fetches the bytes behind
 * it (or falls back to the send-time copy) and shows the image, or says the
 * backend kept no bytes for it.
 */
function previewAttachment(message: ReadonlyChatMessage, index: number): void {
  void previewSentAttachment({
    backend: store.activeBackend,
    sessionId: props.session?.id,
    messageId: message.id,
    names: message.attachmentNames,
    index,
  });
}

/** Per-part render models: collapse-header summary plus the streaming caret flag. */
const liveRows = computed(() => {
  const parts = props.streamParts;
  const last = parts[parts.length - 1];
  const caretPartId =
    last != null && last.kind === "text" && last.endedAt === null ? last.partId : null;
  return parts.map((part) => ({
    part,
    ...thoughtSummary(part),
    // A thinking part with nothing readable in it (codex's encrypted
    // reasoning) renders as a one-liner instead of an expandable shell.
    blankThinking: part.kind === "thinking" && !hasReadableThought(part.text),
    caret: part.partId === caretPartId,
  }));
});

const listEl = ref<HTMLElement | null>(null);

/**
 * True while the reader sits away from the bottom of the story. A scroll
 * listener owns it: the follow watcher below deliberately stops chasing the
 * stream the moment the reader scrolls up, so without this the only way back
 * to the newest reply is dragging the scrollbar.
 */
const awayFromBottom = ref(false);
/** Messages that landed after the reader left the bottom. */
const newSinceAway = ref(0);

/** How close to the bottom still counts as "at the bottom". */
const BOTTOM_SLACK_PX = 32;

function syncAwayFromBottom(): void {
  const list = listEl.value;
  if (!list) return;
  const away = list.scrollHeight - list.scrollTop - list.clientHeight > BOTTOM_SLACK_PX;
  awayFromBottom.value = away;
  if (!away) newSinceAway.value = 0;
}

function jumpToBottom(): void {
  const list = listEl.value;
  if (!list) return;
  list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  awayFromBottom.value = false;
  newSinceAway.value = 0;
}

// Follow the stream only while the reader was at the bottom before the DOM
// changes. Once they scroll up to reread, every subsequent frame leaves their
// position alone.
watch(
  () => [props.messages.length, props.streamParts.map((p) => p.text.length).join(",")],
  () => {
    const list = listEl.value;
    if (!list) return;
    const shouldFollow = shouldFollowStream(list.scrollHeight - list.scrollTop - list.clientHeight);
    if (!shouldFollow) {
      // The reader is reading back: keep their place, but count what they are
      // missing so the jump button can say how much is down there.
      if (awayFromBottom.value) newSinceAway.value += 1;
      return;
    }
    void nextTick(() => {
      const current = listEl.value;
      if (current) current.scrollTo({ top: current.scrollHeight });
    });
  },
);

// Switching a turn or session lands on the turn's opening prompt, so the
// question stays visible even when the reply below it overflows the pane; the
// chain context above scrolls out of view. A server refresh can replace an
// optimistic local prompt with its persisted counterpart; that is still the
// same pane view, so preserve the reader's scroll position.
let hasPreviousPane = false;
let previousSessionId: string | undefined;
let previousFirstMessage: ReadonlyChatMessage | undefined;
watch(
  () => [props.session?.id, props.messages[0]] as const,
  ([sessionId, firstMessage]) => {
    const shouldReset =
      !props.running &&
      (!hasPreviousPane ||
        sessionId !== previousSessionId ||
        !isSamePaneStart(previousFirstMessage, firstMessage));
    hasPreviousPane = true;
    previousSessionId = sessionId;
    previousFirstMessage = firstMessage;
    if (!shouldReset) return;
    void nextTick(() => {
      const list = listEl.value;
      if (!list) return;
      const prompt = list.querySelector<HTMLElement>(".message.user");
      if (!prompt) {
        list.scrollTo({ top: 0 });
        return;
      }
      list.scrollTo({
        top: promptAnchorScrollTop(
          list.getBoundingClientRect().top,
          prompt.getBoundingClientRect().top,
          list.scrollTop,
        ),
      });
    });
  },
);

const copiedId = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyMessage(message: ReadonlyChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.text);
    copiedId.value = message.id;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedId.value = null;
    }, 1500);
  } catch {
    // Clipboard denied — the text is still selectable; nothing to recover to.
  }
}

// The pane can unmount (session cleared) inside the copied-state window; the
// timer must not fire into the dead component.
onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
  listEl.value?.removeEventListener("scroll", syncAwayFromBottom);
});

// The list element mounts with the pane, so the listener is attached once it
// exists; scrolling is the only signal that the reader left the bottom.
watch(
  listEl,
  (list, previous) => {
    previous?.removeEventListener("scroll", syncAwayFromBottom);
    list?.addEventListener("scroll", syncAwayFromBottom, { passive: true });
  },
  { immediate: true },
);

// A pane switch re-anchors the list above; the button's state has to follow
// that jump rather than the reader's last manual scroll.
watch(
  () => props.session?.id,
  () => {
    void nextTick(syncAwayFromBottom);
  },
);
</script>

<style scoped>
.message-source-input > summary { cursor: pointer; font-size: 12px; font-weight: 650; }
.message-source-input[open] > summary { margin-bottom: 10px; }

/*
  Sticks to the pane's bottom edge while the reader is away from it. The host
  is the positioning context (the pane scrolls, the button must not), so this
  rides the section's own bottom via position: sticky.
*/
.jump-to-bottom {
  position: sticky;
  bottom: 10px;
  float: right;
  margin: -34px 10px 10px 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--line, #e5d9cf);
  background: var(--surface, #fffdfb);
  color: var(--text, #4a3f39);
  font-size: 12px;
  font-weight: 650;
  box-shadow: 0 3px 12px rgb(80 55 40 / 12%);
  cursor: pointer;
  z-index: 3;
}
.jump-to-bottom:hover { background: var(--surface-hover, #f7efe9); }
.jump-count {
  min-width: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent, #e8845a);
  color: #fff;
  font-size: 11px;
  text-align: center;
}
</style>
