<template>
  <div class="status-panel" role="dialog" :aria-label="t('status.head', { n: entries.length })">
    <div class="status-head">
      <span class="status-title">{{ t("status.head", { n: entries.length }) }}</span>
      <div class="status-actions">
        <button
          type="button"
          class="status-action"
          :disabled="entries.length === 0"
          :title="t('status.copy')"
          @click="copyAll"
        >{{ copied ? t("status.copied") : t("status.copy") }}</button>
        <button
          type="button"
          class="status-action"
          :disabled="entries.length === 0"
          :title="t('status.save')"
          @click="saveAll"
        >{{ t("status.save") }}</button>
        <button
          type="button"
          class="status-action"
          :disabled="entries.length === 0"
          :title="t('status.clear')"
          @click="clearAll"
        >{{ t("status.clear") }}</button>
        <button type="button" class="status-close" :title="t('status.close')" @click="emit('close')">✕</button>
      </div>
    </div>
    <p class="status-subtitle">{{ t("status.subtitle") }}</p>
    <div v-if="entries.length > 0" class="status-list">
      <button
        v-for="entry in entries"
        :key="entry.seq"
        type="button"
        class="status-row"
        :class="[entry.level, { expanded: expanded.has(entry.seq) }]"
        :title="entry.text.length > CLAMP_CHARS ? t('status.expand') : entry.text"
        @click="toggle(entry.seq)"
      >
        <span class="status-time">{{ formatTimestamp(entry.at) }}</span>
        <span class="status-level">{{ t(entry.level === "error" ? "status.levelError" : "status.levelWarn") }}</span>
        <span class="status-text">{{ entry.text }}</span>
      </button>
    </div>
    <p v-else class="status-empty">{{ t("status.empty") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { formatTimestamp } from "../format";
import { t } from "../i18n";
import { clearDiagnostics, markDiagnosticsSeen, store } from "../state";

/**
 * The status panel: the main process's buffered console tail, the only place
 * a packaged launch's background-command errors are visible. Entries stream
 * in from main; the panel retires the top-bar's unseen badge the moment it
 * opens (onMounted fires only while open — the parent v-ifs it shut).
 */
const emit = defineEmits<{ close: [] }>();

/** Rows longer than this clamp to two lines; a click expands them. */
const CLAMP_CHARS = 240;

// A computed, not a snapshot: the app-global clear replaces the array, and a
// plain alias would keep rendering the one that was dropped.
const entries = computed(() => store.diagnostics);
const expanded = ref<Set<number>>(new Set());
const copied = ref(false);

onMounted(() => {
  markDiagnosticsSeen();
});

function toggle(seq: number): void {
  const next = new Set(expanded.value);
  if (next.has(seq)) next.delete(seq);
  else next.add(seq);
  expanded.value = next;
}

/** One line per entry, newest last — what "copy all" and the save file hold. */
function exportText(): string {
  return entries.value
    .map((entry) => `${formatTimestamp(entry.at)} [${entry.level}] ${entry.text}`)
    .join("\n");
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Contexts without the async clipboard still get the legacy path.
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

async function copyAll(): Promise<void> {
  if (!(await writeClipboard(exportText()))) return;
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}

async function saveAll(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  // A canceled dialog or a failed write leaves the entries on screen either
  // way — the native dialog is the report, nothing to add here.
  await window.awefork.saveTextFile(`awefork-log-${stamp}.txt`, exportText());
}

async function clearAll(): Promise<void> {
  await clearDiagnostics();
}
</script>
