<template>
  <div class="ft">
    <div class="ft-tools">
      <div class="ft-filter">
        <span class="ft-filter-icon" aria-hidden="true">⌕</span>
        <input
          v-model="filterInput"
          type="text"
          :placeholder="t('files.treeFilter')"
          :aria-label="t('files.treeFilter')"
          spellcheck="false"
          @keydown.esc.prevent="clearFilter"
        />
        <button
          v-if="files.treeFilter"
          type="button"
          class="ft-filter-x"
          :title="t('files.clearFilter')"
          :aria-label="t('files.clearFilter')"
          @click="clearFilter"
          >✕</button
        >
      </div>
      <button
        type="button"
        class="ft-btn"
        :class="{ on: files.showHidden }"
        :title="t('files.showHidden')"
        :aria-label="t('files.showHidden')"
        :aria-pressed="files.showHidden"
        @click="toggleHidden"
        >◉</button
      >
    </div>

    <!-- The filter box's second state: the loaded tree had no match, so the
         project-wide name search answers instead. -->
    <div v-if="recursiveActive" class="ft-section">
      <p v-if="files.recursiveLoading" class="ft-head">{{ t("files.searching") }}</p>
      <template v-else>
        <p class="ft-head">{{ t("files.treeMatches", { n: files.recursiveResults.length }) }}</p>
        <p v-if="files.recursiveResults.length === 0" class="ft-empty">{{ t("files.treeNoMatch") }}</p>
        <button
          v-for="hit in files.recursiveResults"
          :key="hit.path"
          type="button"
          class="ft-row"
          :title="hit.path"
          @click="previewFromTree(hit)"
        >
          <span class="ft-row-icon" aria-hidden="true">📄</span>
          <span class="ft-row-name">{{ hit.name }}</span>
        </button>
      </template>
    </div>

    <div class="ft-section">
      <p class="ft-head">{{ t("files.commonPlaces") }}</p>
      <template v-for="place in places" :key="place">
        <div class="ft-row" :class="{ active: isActive(place) }">
          <button
            type="button"
            class="ft-caret"
            :aria-expanded="expanded(place)"
            :title="t('files.toggleTree')"
            @click.stop="toggleTreeNode(place)"
            >{{ expanded(place) ? "▾" : "▸" }}</button
          >
          <span
            class="ft-row-label"
            role="button"
            tabindex="0"
            :title="place"
            @click="onRootClick(place)"
            @keydown.enter.prevent="onRootClick(place)"
          >
            <span class="ft-row-icon" aria-hidden="true">{{ placeIcon(place) }}</span>
            <span class="ft-row-name">{{ placeLabel(place) }}</span>
          </span>
          <span
            class="ft-row-x"
            role="button"
            tabindex="0"
            :title="t('files.removePlace')"
            :aria-label="t('files.removePlace')"
            @click.stop="removePlace(place)"
            @keydown.enter.stop.prevent="removePlace(place)"
            >×</span
          >
        </div>
        <FileTreeNode v-if="expanded(place)" :entry="placeEntry(place)" :depth="1" />
      </template>
      <button type="button" class="ft-row" :title="t('files.pickFolder')" @click="pickFolder">
        <span class="ft-caret-off" aria-hidden="true"></span>
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
            @click="onRootClick(root)"
            @keydown.enter.prevent="onRootClick(root)"
            @dragstart="startPathDrag($event, [root])"
            @contextmenu.prevent="openFileMenu(placeEntry(root), $event.clientX, $event.clientY)"
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
  addPlace,
  browseTo,
  browsingDir,
  clearTreeFilter,
  files,
  initFiles,
  isTreeNodeExpanded,
  places,
  previewFromTree,
  removePlace,
  setTreeFilter,
  startPathDrag,
  toggleHidden,
  toggleTreeNode,
  treeChildrenFor,
} from "../files";
import { t } from "../i18n";
import { middleBrowserEnabled, openFilesView } from "../layout";
import { residentFolder, store } from "../state";
import FileTreeNode from "./file-tree-node.vue";

void initFiles();

/** The filter box writes straight through to the store; Esc clears both. */
const filterInput = computed({
  get: () => files.treeFilter,
  set: (value: string) => setTreeFilter(searchRoot.value, value),
});

function clearFilter(): void {
  clearTreeFilter();
}

/** The recursive second state runs against the selected project, else home. */
const searchRoot = computed(() => store.selectedDirectory ?? files.homePath ?? null);

const recursiveActive = computed(() => {
  if (files.treeFilter.trim() === "") return false;
  // A settled search that found nothing still owns the section — "no match"
  // is an answer, and a silently blank tree is not.
  return (
    files.recursiveLoading ||
    files.recursiveSettled ||
    files.recursiveResults.length > 0 ||
    files.recursiveError !== null
  );
});

const home = computed(() => files.homePath ?? "");

/** The selected project plus the standing resident folder. */
const projectRoots = computed(() => {
  const roots: string[] = [];
  if (store.selectedDirectory) roots.push(store.selectedDirectory);
  const resident = residentFolder.value;
  if (resident !== "" && !roots.some((dir) => samePath(dir, resident))) roots.push(resident);
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

function expanded(dir: string): boolean {
  return isTreeNodeExpanded(dir);
}

function childrenOf(dir: string): FileEntry[] {
  return treeChildrenFor(dir);
}

function placeEntry(dir: string): FileEntry {
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

/**
 * The four platform defaults keep their familiar labels whatever the home
 * directory is called; anything the user added shows its own name.
 */
function placeLabel(path: string): string {
  const base = home.value;
  if (base !== "") {
    if (samePath(path, base)) return t("files.placeHome");
    const suffix = (name: string): boolean =>
      samePath(path, base.includes("\\") ? `${base}\\${name}` : `${base}/${name}`);
    if (suffix("Desktop")) return t("files.placeDesktop");
    if (suffix("Downloads")) return t("files.placeDownloads");
    if (suffix("Documents")) return t("files.placeDocuments");
  }
  return displayName(path);
}

function placeIcon(path: string): string {
  const base = home.value;
  if (base !== "") {
    if (samePath(path, base)) return "🏠";
    const suffix = (name: string): boolean =>
      samePath(path, base.includes("\\") ? `${base}\\${name}` : `${base}/${name}`);
    if (suffix("Desktop")) return "🖥";
    if (suffix("Downloads")) return "⬇";
    if (suffix("Documents")) return "📄";
  }
  return "📁";
}

/**
 * A root row's click. With the middle browser on it jumps the browser to
 * the directory (the tree as a jump-in surface); with the browser folded
 * away the tree is the navigation, so the click expands in place.
 */
function onRootClick(dir: string): void {
  if (middleBrowserEnabled.value) {
    openFilesView();
    void browseTo(dir);
    return;
  }
  void toggleTreeNode(dir);
}

async function pickFolder(): Promise<void> {
  const picked = await window.awefork.pickDirectory();
  if (picked) addPlace(picked);
}
</script>
