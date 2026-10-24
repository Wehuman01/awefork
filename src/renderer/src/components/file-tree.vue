<template>
  <div class="ft">
    <div class="ft-section">
      <p class="ft-head">{{ t("files.commonPlaces") }}</p>
      <button
        v-for="place in places"
        :key="place.path"
        type="button"
        class="ft-row"
        :class="{ active: isActive(place.path) }"
        :title="place.path"
        @click="browse(place.path)"
      >
        <span class="ft-row-icon" aria-hidden="true">{{ place.icon }}</span>
        <span class="ft-row-name">{{ place.label }}</span>
      </button>
      <button
        type="button"
        class="ft-row"
        :title="t('files.pickFolder')"
        @click="pickFolder"
      >
        <span class="ft-row-icon" aria-hidden="true">＋</span>
        <span class="ft-row-name">{{ t("files.pickFolder") }}</span>
      </button>
    </div>

    <div v-if="projectRoots.length > 0" class="ft-section">
      <p class="ft-head">{{ t("files.projects") }}</p>
      <div v-for="root in projectRoots" :key="root" class="ft-node">
        <div class="ft-row" :class="{ active: isActive(root) }">
          <button
            type="button"
            class="ft-caret"
            :aria-expanded="expanded(root)"
            :title="t('files.toggleTree')"
            @click.stop="toggleTreeNode(root)"
            >{{ expanded(root) ? "▾" : "▸" }}</button
          >
          <span
            class="ft-row-label"
            role="button"
            tabindex="0"
            :title="root"
            draggable="true"
            @click="browse(root)"
            @keydown.enter.prevent="browse(root)"
            @dragstart="startPathDrag($event, [root])"
            @contextmenu.prevent="openFileMenu(rootEntry(root), $event.clientX, $event.clientY)"
          >
            <span class="ft-row-icon" aria-hidden="true">📁</span>
            <span class="ft-row-name">{{ displayName(root) }}</span>
          </span>
        </div>
        <FileTreeNode
          v-if="expanded(root)"
          v-for="child in childrenOf(root)"
          :key="child.path"
          :entry="child"
          :depth="1"
        />
      </div>
    </div>

    <p v-if="treeErrorText" class="ft-error">{{ treeErrorText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { displayName, samePath } from "../../../shared/file-paths";
import type { FileEntry } from "../../../shared/file-types";
import { openFileMenu } from "../file-menu";
import {
  browseTo,
  browsingDir,
  files,
  initFiles,
  isTreeNodeExpanded,
  startPathDrag,
  toggleTreeNode,
  visibleTreeChildren,
} from "../files";
import { t } from "../i18n";
import { openFilesView } from "../layout";
import { store } from "../state";
import FileTreeNode from "./file-tree-node.vue";

void initFiles();

const home = computed(() => files.homePath ?? "");

/** Common locations a file browser is expected to offer first. */
const places = computed(() => {
  const base = home.value;
  if (base === "") return [];
  const join = (name: string): string =>
    base.includes("\\") ? `${base}\\${name}` : `${base}/${name}`;
  return [
    { path: base, label: t("files.placeHome"), icon: "🏠" },
    { path: join("Desktop"), label: t("files.placeDesktop"), icon: "🖥" },
    { path: join("Downloads"), label: t("files.placeDownloads"), icon: "⬇" },
    { path: join("Documents"), label: t("files.placeDocuments"), icon: "📄" },
  ];
});

/** The selected project plus every hand-added sidebar directory. */
const projectRoots = computed(() => {
  const roots: string[] = [];
  if (store.selectedDirectory) roots.push(store.selectedDirectory);
  for (const dir of store.knownDirs) {
    if (!roots.includes(dir)) roots.push(dir);
  }
  return roots;
});

const treeErrorText = computed(() => {
  for (const value of Object.values(files.treeError)) {
    if (value?.code === "permission") return t("files.errPermission");
    if (value?.code === "not-found") return t("files.errNotFound");
  }
  return "";
});

function isActive(dir: string): boolean {
  return browsingDir.value !== null && samePath(browsingDir.value, dir);
}

function browse(dir: string): void {
  openFilesView();
  void browseTo(dir);
}

function expanded(dir: string): boolean {
  return isTreeNodeExpanded(dir);
}

function childrenOf(dir: string): FileEntry[] {
  return visibleTreeChildren(dir).filter((entry) => entry.isDir);
}

/** A synthetic row for the root itself, so the menu works there too. */
function rootEntry(dir: string): FileEntry {
  return {
    name: displayName(dir),
    path: dir,
    isDir: true,
    isSymlink: false,
    size: null,
    mtime: null,
    hidden: false,
  };
}

async function pickFolder(): Promise<void> {
  const picked = await window.awefork.pickDirectory();
  if (picked) browse(picked);
}
</script>
