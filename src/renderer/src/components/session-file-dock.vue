<template>
  <div class="sfd" :class="{ collapsed: !fileDockOpen }">
    <button
      type="button"
      class="sfd-head"
      :aria-expanded="fileDockOpen"
      @click="toggleFileDock"
    >
      <span class="sfd-caret">{{ fileDockOpen ? "▾" : "▸" }}</span>
      <span>{{ t("sidebar.fileDock") }}</span>
      <span class="sfd-dir" :title="root ?? undefined">{{ rootLabel }}</span>
      <span
        v-if="fileDockOpen && root"
        class="sfd-refresh"
        role="button"
        tabindex="0"
        :title="t('files.refresh')"
        @click.stop="reload"
        @keydown.enter.stop.prevent="reload"
        >↻</span
      >
    </button>
    <div v-if="fileDockOpen" class="sfd-body">
      <p v-if="!root" class="sfd-empty">{{ t("sidebar.fileDockNoDir") }}</p>
      <template v-else>
        <p v-if="loading" class="sfd-empty">{{ t("sidebar.fileDockLoading") }}</p>
        <p v-else-if="errorText" class="sfd-empty">{{ errorText }}</p>
        <p v-else-if="entries.length === 0" class="sfd-empty">{{ t("sidebar.fileDockEmpty") }}</p>
        <template v-else>
          <FileTreeNode
            v-for="child in dirEntries"
            :key="child.path"
            :entry="child"
            :depth="1"
          />
          <div
            v-for="child in fileEntries"
            :key="child.path"
            class="ft-node"
          >
            <div class="ft-row sfd-file-row" :class="{ active: selectedPath === child.path }">
              <span class="sfd-file-leaf" aria-hidden="true"></span>
              <span
                class="ft-row-label"
                role="button"
                tabindex="0"
                :title="child.path"
                draggable="true"
                @click="openFile(child)"
                @keydown.enter.prevent="openFile(child)"
                @dragstart="startPathDrag($event, [child.path])"
                @contextmenu.prevent="openFileMenu(child, $event.clientX, $event.clientY)"
              >
                <span class="ft-row-icon" aria-hidden="true">{{ child.isSymlink ? "🔗" : "📄" }}</span>
                <span class="ft-row-name">{{ child.name }}</span>
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { displayName } from "../../../shared/file-paths";
import type { FileEntry } from "../../../shared/file-types";
import { openFileMenu } from "../file-menu";
import {
  files,
  initFiles,
  loadTreeChildren,
  previewEntry,
  selectedPath,
  startPathDrag,
} from "../files";
import { t } from "../i18n";
import { fileDockOpen, openFilesView, toggleFileDock } from "../layout";
import { store } from "../state";
import FileTreeNode from "./file-tree-node.vue";

void initFiles();

/** The dock is rooted at the selected session's directory — it follows the
 *  session list's grouping, not the file panel's browsing history. */
const root = computed(() => store.selectedDirectory);
const rootLabel = computed(() => (root.value ? displayName(root.value) : ""));
const loading = computed(() => root.value !== null && files.treeLoading[root.value] === true);
const entries = computed(() => (root.value ? (files.treeChildren[root.value] ?? []) : []));
const dirEntries = computed(() => entries.value.filter((entry) => entry.isDir));
const fileEntries = computed(() => entries.value.filter((entry) => !entry.isDir));

const errorText = computed(() => {
  if (root.value === null) return "";
  const error = files.treeError[root.value];
  if (error?.code === "permission") return t("files.errPermission");
  if (error?.code === "not-found") return t("files.errNotFound");
  return "";
});

/** Load the root's children once per directory; the user refreshes on purpose. */
function ensureLoaded(): void {
  if (root.value && files.treeChildren[root.value] === undefined) {
    void loadTreeChildren(root.value);
  }
}

function reload(): void {
  if (root.value) void loadTreeChildren(root.value);
}

function openFile(entry: FileEntry): void {
  openFilesView();
  void previewEntry(entry);
}

watch(
  [fileDockOpen, root],
  () => {
    if (fileDockOpen.value) ensureLoaded();
  },
  { immediate: true },
);
</script>
