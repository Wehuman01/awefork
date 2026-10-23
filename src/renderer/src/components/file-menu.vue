<template>
  <Teleport to="body">
    <!-- transparent backdrop: any outside click closes, like the sidebar menu -->
    <div v-if="menu" class="file-menu-backdrop" @click="close" @contextmenu.prevent="close"></div>    <div
      v-if="menu"
      ref="menuEl"
      class="file-menu"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
      role="menu"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <button
        v-if="menu.entry.isDir"
        type="button"
        class="file-menu-item"
        role="menuitem"
        @click="act(openFolder)"
        >{{ t("files.menuOpenFolder") }}</button
      >
      <button v-else type="button" class="file-menu-item" role="menuitem" @click="act(preview)">{{
        t("files.menuPreview")
      }}</button>
      <button type="button" class="file-menu-item" role="menuitem" @click="act(reveal)">{{
        t("files.menuReveal")
      }}</button>
      <div class="file-menu-sep"></div>
      <button
        type="button"
        class="file-menu-item"
        role="menuitem"
        @click="act(copyAbsolute)"
        >{{ t("files.menuCopyAbsolute") }}</button
      >
      <button
        type="button"
        class="file-menu-item"
        role="menuitem"
        :disabled="relative === undefined || relative === null"
        :title="relativeTitle"
        @click="act(copyRelative)"
        >{{ t("files.menuCopyRelative") }}</button
      >
      <button
        type="button"
        class="file-menu-item"
        role="menuitem"
        @click="act(copyName)"
        >{{ t("files.menuCopyName") }}</button
      >
      <div class="file-menu-sep"></div>
      <button type="button" class="file-menu-item" role="menuitem" @click="act(insertIntoDraft)">{{
        t("files.menuInsertDraft")
      }}</button>
      <button type="button" class="file-menu-item" role="menuitem" @click="act(showInFolder)">{{
        t("files.menuShowInFolder")
      }}</button>
      <button type="button" class="file-menu-item" role="menuitem" @click="act(() => void openInfo())">{{
        t("files.menuInfo")
      }}</button>
      <p v-if="relativeBase" class="file-menu-base" :title="relativeBase">
        {{ t("files.relativeBaseNote"
        )}}<span class="file-menu-base-path">{{ relativeBase }}</span>
      </p>
    </div>

    <!-- info dialog -->
    <div v-if="info" class="file-info-backdrop" @click="info = null">
      <div class="file-info" @click.stop>
        <div class="file-info-head">
          <span :title="info.entry.path">{{ info.entry.name }}</span>
          <button type="button" :title="t('files.close')" @click="info = null">✕</button>
        </div>
        <dl class="file-info-grid">
          <dt>{{ t("files.infoKind") }}</dt>
          <dd>{{ kindLabel }}</dd>
          <dt>{{ t("files.infoSize") }}</dt>
          <dd>{{ sizeLabel }}</dd>
          <dt>{{ t("files.infoModified") }}</dt>
          <dd>{{ mtimeLabel }}</dd>
          <template v-if="info.stat?.exists && info.stat.isDir">
            <dt>{{ t("files.infoChildren") }}</dt>
            <dd>{{ info.stat.childCount ?? t("files.infoUnknown") }}</dd>
          </template>
          <dt>{{ t("files.infoAbsolute") }}</dt>
          <dd class="file-info-path" :title="info.entry.path">{{ info.entry.path }}</dd>
          <dt>{{ t("files.infoRelative") }}</dt>
          <dd class="file-info-path">
            {{
              relative === null
                ? t("files.relativeUnsupported")
                : (relative ?? t("files.loading"))
            }}
          </dd>
          <dt>{{ t("files.infoRelativeBase") }}</dt>
          <dd class="file-info-path" :title="relativeBase ?? ''">
            {{ relativeBase ?? t("files.noProject") }}
          </dd>
        </dl>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FileEntry, FileStat } from "../../../shared/file-types";
import { closeFileMenu, fileMenu } from "../file-menu";
import { browseTo, flashNotice, previewEntry, revealEntry } from "../files";
import { formatBytes, formatTimestamp } from "../format";
import { t } from "../i18n";
import { openFilesView } from "../layout";
import { insertDraftText, store } from "../state";

interface InfoState {
  entry: FileEntry;
  stat: FileStat | null;
}

const menuEl = ref<HTMLElement | null>(null);
const info = ref<InfoState | null>(null);
const pos = ref({ x: 0, y: 0 });
/** Project-relative path of the menu entry; null = unsupported, undefined = loading. */
const relative = ref<string | null | undefined>(undefined);

/** The live request, or null when closed — one menu serves every surface. */
const menu = computed(() =>
  fileMenu.entry === null ? null : { entry: fileMenu.entry, x: fileMenu.x, y: fileMenu.y },
);

/**
 * The relative-path base: the target session's own directory when a draft
 * is open, else the selected project. The browsing directory deliberately
 * never enters this — the base follows the project, not the file panel.
 */
const relativeBase = computed(() => {
  const draft = store.draft;
  if (draft) {
    const session = store.sessions.find((s) => s.id === draft.sessionId);
    if (session?.directory) return session.directory;
  }
  return store.selectedDirectory;
});

const relativeTitle = computed(() => {
  if (relative.value === null) return t("files.relativeUnsupported");
  if (relative.value === undefined) return t("files.loading");
  return t("files.menuCopyRelativeTitle", { base: relativeBase.value ?? "" });
});

watch(
  () => fileMenu.seq,
  async () => {
    const entry = fileMenu.entry;
    if (entry === null) return;
    relative.value = undefined;
    await nextTick();
    clampIntoViewport();
    menuEl.value?.focus();
    const base = relativeBase.value;
    if (!base) {
      relative.value = null;
      return;
    }
    const result = await window.awefork.relativeToRoot(base, entry.path).catch(() => null);
    // A newer request may have replaced the entry while this was in flight.
    if (fileMenu.entry?.path !== entry.path) return;
    relative.value = result?.ok ? result.value : null;
  },
);

/** Keep the menu inside the viewport when it opens near an edge. */
function clampIntoViewport(): void {
  const el = menuEl.value;
  if (!el || fileMenu.entry === null) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  const x = Math.min(fileMenu.x, window.innerWidth - rect.width - margin);
  const y = Math.min(fileMenu.y, window.innerHeight - rect.height - margin);
  pos.value = { x: Math.max(margin, x), y: Math.max(margin, y) };
}

function act(run: () => void): void {
  run();
  closeFileMenu();
}

/** Backdrop / outside click. */
function close(): void {
  closeFileMenu();
}

function copyAbsolute(): void {
  const entry = fileMenu.entry;
  if (entry) void copy(entry.path, t("files.copiedAbsolute"));
}

function copyRelative(): void {
  const value = relative.value;
  if (typeof value === "string") void copy(value, t("files.copiedRelative"));
}

function copyName(): void {
  const entry = fileMenu.entry;
  if (entry) void copy(entry.name, t("files.copiedName"));
}

async function copy(value: string, successMessage: string): Promise<void> {
  if (value === "") return;
  const ok = await writeClipboard(value);
  if (ok) {
    flashNotice(successMessage);
    return;
  }
  // The value stays selectable — a failed copy must not degrade to a hint
  // that only names the parent directory.
  flashNotice(`${t("files.copyFailed")}: ${value}`);
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

function preview(): void {
  const entry = fileMenu.entry;
  if (!entry || entry.isDir) return;
  openFilesView();
  void previewEntry(entry);
}

function openFolder(): void {
  const entry = fileMenu.entry;
  if (!entry) return;
  openFilesView();
  void browseTo(entry.path);
}

function reveal(): void {
  const entry = fileMenu.entry;
  if (!entry) return;
  openFilesView();
  void revealEntry(entry);
}

function insertIntoDraft(): void {
  const entry = fileMenu.entry;
  if (!entry) return;
  const result = insertDraftText(entry.path);
  if (result.ok) {
    flashNotice(t("files.insertedDraft"));
    return;
  }
  flashNotice(result.reason === "sending" ? t("files.draftSending") : t("files.noDraftTarget"));
}

function showInFolder(): void {
  const entry = fileMenu.entry;
  if (!entry) return;
  void window.awefork.showInFolder(entry.path).catch(() => {
    flashNotice(t("files.showInFolderFailed"));
  });
}

async function openInfo(): Promise<void> {
  const entry = fileMenu.entry;
  if (!entry) return;
  info.value = { entry, stat: null };
  const stat = await window.awefork.statFile(entry.path).catch(() => null);
  if (info.value?.entry.path === entry.path) {
    info.value = { entry, stat: stat?.ok ? stat.value : null };
  }
}

const kindLabel = computed(() => {
  const entry = info.value?.entry;
  if (!entry) return "";
  const stat = info.value?.stat;
  if (stat && !stat.exists) return t("files.infoDeleted");
  if (entry.isSymlink) return entry.isDir ? t("files.kindSymlinkDir") : t("files.kindSymlinkFile");
  return entry.isDir ? t("files.kindDir") : t("files.kindFile");
});

const sizeLabel = computed(() => {
  const stat = info.value?.stat;
  const entry = info.value?.entry;
  if (!entry) return "";
  if (stat && !stat.exists) return t("files.infoDeleted");
  if (entry.isDir) return t("files.infoDirSize");
  const size = stat?.size ?? entry.size;
  return size === null || size === undefined ? t("files.infoUnknown") : formatBytes(size);
});

const mtimeLabel = computed(() => {
  const stat = info.value?.stat;
  const entry = info.value?.entry;
  if (!entry) return "";
  if (stat && !stat.exists) return t("files.infoDeleted");
  const mtime = stat?.mtime ?? entry.mtime;
  return mtime === null || mtime === undefined ? t("files.infoUnknown") : formatTimestamp(mtime);
});

/** Escape closes; arrows walk the items; Enter activates the focused one. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeFileMenu();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
  const items = Array.from(
    menuEl.value?.querySelectorAll<HTMLButtonElement>(".file-menu-item:not([disabled])") ?? [],
  );
  if (items.length === 0) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Enter"
      ? current
      : event.key === "ArrowDown"
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
  items[next]?.focus();
}

// A menu that loses the window (alt-tab mid-right-click) must not linger.
if (typeof window !== "undefined") {
  window.addEventListener("blur", closeFileMenu);
}
</script>
