<template>
  <Teleport to="body">
    <div v-if="history.panelOpen" class="history-panel">
      <div class="history-panel-head">
        <span class="history-panel-title">操作历史</span>
        <span class="history-panel-meta">{{ history.entries.length }} 条记录 · 可撤销 {{ undoDepth() }} 步</span>
        <button
          type="button"
          class="history-panel-close"
          title="关闭"
          @click="closePanel()"
        >
          ✕
        </button>
      </div>
      <div class="history-panel-body">
        <p v-if="history.entries.length === 0" class="history-panel-empty">
          本次运行还没有记录操作。
        </p>
        <template v-else>
          <div
            v-for="(row, idx) in rows"
            :key="row.kind === 'separator' ? `sep-${idx}` : `entry-${row.entry!.id}`"
          >
            <div
              v-if="row.kind === 'separator'"
              class="history-separator"
            >
              <span class="history-separator-line"></span>
              <span class="history-separator-text">{{ row.separatorLabel }}</span>
              <span class="history-separator-line"></span>
            </div>
            <button
              v-else
              type="button"
              class="history-row"
              :class="{
                'history-row-applied': row.applied,
                'history-row-undone': !row.applied,
                'history-row-locked': row.locked,
                'history-row-lock': !row.entry!.undoable,
                'history-row-failed': row.failed,
              }"
              :title="rowTitle(row.entry!, row.locked)"
              :disabled="!row.clickable"
              @click="onRowClick(row)"
            >
              <span class="history-row-icon">{{ row.icon }}</span>
              <span class="history-row-label">{{ row.entry!.label }}</span>
              <span v-if="row.showBackend" class="history-backend-badge">
                <span class="history-backend-dot" :class="row.entry!.backend"></span>
                <span class="history-backend-label">{{ row.backendText }}</span>
              </span>
              <span class="history-row-time">{{ relTime(row.entry!.time) }}</span>
            </button>
          </div>
        </template>
      </div>
      <div class="history-panel-foot">
        ⌘/Ctrl+Z 撤销 · ⌘/Ctrl+⇧+Z 重做 · Esc 关闭
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { relTime } from "../format";
import type { HistoryEntry } from "../history";
import { closePanel, history, lockIndex, redoTo, undoDepth, undoTo } from "../history";
import { store } from "../state";

interface PanelRow {
  kind: "entry" | "separator";
  separatorLabel?: string;
  entry?: HistoryEntry;
  originalIndex?: number;
  icon?: string;
  clickable?: boolean;
  locked?: boolean;
  failed?: boolean;
  showBackend?: boolean;
  backendText?: string;
  applied?: boolean;
}

const rows = computed<PanelRow[]>(() => {
  const entries = history.entries;
  const cursor = history.cursor;
  const li = lockIndex();
  const active = store.activeBackend;
  const backends = store.backendList;

  if (entries.length === 0) return [];

  const result: PanelRow[] = [];

  // 收集倒序 entry
  const reversed: { entry: HistoryEntry; originalIndex: number; applied: boolean }[] = [];
  for (let d = 0; d < entries.length; d++) {
    const oi = entries.length - 1 - d;
    const entry = entries[oi];
    if (!entry) continue;
    reversed.push({ entry, originalIndex: oi, applied: oi < cursor });
  }

  let insertLockSep = false;

  for (let i = 0; i < reversed.length; i++) {
    const r = reversed[i];
    if (!r) continue;
    const prev = i > 0 ? reversed[i - 1] : undefined;

    // "当前位置"分隔线：前一条已撤销，当前已生效
    if (prev && !prev.applied && r.applied) {
      result.push({ kind: "separator", separatorLabel: "当前位置" });
    }

    // "以下操作已锁定"分隔线：在锁行下方第一条 entry 之前插入
    if (!r.entry.undoable) {
      if (li > 0) insertLockSep = true;
    } else if (insertLockSep) {
      result.push({ kind: "separator", separatorLabel: "以下操作已锁定" });
      insertLockSep = false;
    }

    const isLocked = r.applied && r.originalIndex <= li;
    const clickable = !history.busy && r.entry.undoable && !isLocked;

    let icon: string;
    if (!r.entry.undoable) icon = "⌧";
    else if (r.applied) icon = "✓";
    else icon = "↻";

    const showBackend = r.entry.backend !== active;
    const info = backends.find((b) => b.id === r.entry.backend);
    const backendText = info?.label ?? r.entry.backend;

    result.push({
      kind: "entry",
      entry: r.entry,
      originalIndex: r.originalIndex,
      icon,
      clickable,
      locked: isLocked,
      failed: r.entry.failed,
      showBackend,
      backendText,
      applied: r.applied,
    });
  }

  return result;
});

function rowTitle(entry: HistoryEntry, locked = false): string {
  const abs = new Date(entry.time).toLocaleString();
  let title = abs;
  if (!entry.undoable || locked) {
    title += "——此操作不可撤销，且锁定了更早的历史";
  }
  if (entry.failed) {
    title += "——上次撤销/重做失败";
  }
  return title;
}

function onRowClick(row: PanelRow): void {
  if (!row.clickable || !row.entry) return;
  const id = row.entry.id;
  if (row.applied) {
    void undoTo(id);
  } else {
    void redoTo(id);
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && history.panelOpen) {
    closePanel();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
});
</script>
