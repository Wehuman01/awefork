<template>
  <section v-if="rows.length > 0 || unrecorded" class="fchanges">
    <div class="fchanges-head">{{ t("filechg.title") }}</div>
    <div v-for="row in rows" :key="`${row.messageId}:${row.entry.path}`" class="fchange">
      <button type="button" class="fchange-row" :title="t('filechg.expandDiff')" @click="toggle(row)">
        <span class="fchange-status" :class="`is-${row.entry.status}`">{{
          statusLabel[row.entry.status]
        }}</span>
        <span class="fchange-path" :title="row.entry.path">{{ displayPath(row.entry.path) }}</span>
        <span v-if="row.entry.added !== null" class="fchange-totals">
          <span class="fc-add">+{{ row.entry.added }}</span>
          <span class="fc-del">−{{ row.entry.removed }}</span>
        </span>
        <span v-else-if="row.entry.note" class="fchange-note">{{ row.entry.note }}</span>
        <span class="fchange-caret">{{ open[rowKey(row)] ? "▾" : "▸" }}</span>
      </button>
      <button
        type="button"
        class="fchange-open"
        :title="t('filechg.openInSystem')"
        @click="openFile(row.entry.path)"
      >{{ t("filechg.open") }}</button>
      <div v-if="open[rowKey(row)]" class="fchange-diff">
        <template v-if="diffs[rowKey(row)]?.length">
          <div v-for="(hunk, hi) in diffs[rowKey(row)]" :key="hi" class="fchange-hunk">
            <div
              v-for="(line, li) in hunk.lines"
              :key="li"
              class="fc-line"
              :class="line.type === '+' ? 'add' : line.type === '-' ? 'del' : 'ctx'"
            ><span class="fc-sign">{{ line.type }}</span><span class="fc-text">{{ line.text }}</span></div>
          </div>
        </template>
        <p v-else-if="rowKey(row) in diffs" class="fchange-note">
          {{ t("filechg.noDiff") }}
        </p>
      </div>
    </div>
    <p v-if="rows.length === 0 && unrecorded" class="fchange-note fchange-unrecorded">
      {{ t("filechg.unrecorded") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import type { DiffHunk } from "../../../shared/diff";
import type { FileChangeEntry } from "../../../shared/types";
import { t } from "../i18n";
import { paneMessages, selectedSession, store } from "../state";

/**
 * The selected turn's file card: what the run actually did to disk, from the
 * observer-side snapshots taken as the tool events arrived. Entries key on
 * assistant message ids; the pane's messages pick this turn's slice.
 */
const statusLabel = computed<Record<FileChangeEntry["status"], string>>(() => ({
  modified: t("filechg.modified"),
  created: t("filechg.created"),
  deleted: t("filechg.deleted"),
  unknown: t("filechg.unknown"),
}));

interface Row {
  messageId: string;
  entry: FileChangeEntry;
}

const rows = computed<Row[]>(() => {
  const sessionId = store.selectedId;
  if (!sessionId) return [];
  const changes = store.fileChangesBySession[sessionId];
  if (!changes) return [];
  const order = new Map(paneMessages.value.map((m, i) => [m.id, i] as const));
  return Object.entries(changes.messages)
    .flatMap(([messageId, files]) =>
      order.has(messageId)
        ? files.map((entry) => ({ messageId, entry, at: order.get(messageId) ?? 0 }))
        : [],
    )
    .sort((a, b) => a.at - b.at || a.entry.path.localeCompare(b.entry.path))
    .map(({ messageId, entry }) => ({ messageId, entry }));
});

/**
 * Honest degradation on the UI side: the turn ran tracked tools but the index
 * has nothing for it — the session was forked (inherited turns carry no
 * snapshots) or the edits happened while awefork was away.
 */
const unrecorded = computed(() => {
  if (rows.value.length > 0) return false;
  const sessionId = store.selectedId;
  const tools = sessionId ? (store.fileChangesBySession[sessionId]?.tools ?? []) : [];
  if (tools.length === 0) return false;
  return paneMessages.value.some((m) => m.toolNames.some((t) => tools.includes(t)));
});

/** Absolute path under the session's directory shows relative — shorter rows. */
const displayPath = (path: string): string => {
  const dir = selectedSession.value?.directory;
  if (dir && (path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`))) {
    return path.slice(dir.length + 1);
  }
  return path;
};

const open = reactive<Record<string, boolean>>({});
const diffs = reactive<Record<string, Array<DiffHunk> | null>>({});

const rowKey = (row: Row): string => `${row.messageId}:${row.entry.path}`;

async function toggle(row: Row): Promise<void> {
  const key = rowKey(row);
  const next = !open[key];
  open[key] = next;
  if (!next || key in diffs) return;
  const sessionId = store.selectedId;
  if (!sessionId) return;
  diffs[key] = null;
  try {
    const result = await window.awefork.fileChangeDiff(
      store.activeBackend,
      sessionId,
      row.messageId,
      row.entry.path,
    );
    diffs[key] = result === null ? null : [...result.hunks];
  } catch {
    diffs[key] = null;
  }
}

async function openFile(path: string): Promise<void> {
  try {
    await window.awefork.openPath(path);
  } catch {
    // The file may be gone since the snapshot; the diff view still works.
  }
}
</script>
