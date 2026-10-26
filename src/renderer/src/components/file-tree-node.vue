<template>
  <div class="ft-node">
    <div class="ft-row" :class="{ active: isActive }">
      <button
        v-if="entry.isDir"
        type="button"
        class="ft-caret"
        :style="{ marginLeft: `${depth * 12}px` }"
        :aria-expanded="expanded"
        :title="t('files.toggleTree')"
        @click.stop="toggle"
        >{{ expanded ? "▾" : "▸" }}</button
      >
      <span v-else class="ft-caret-off" :style="{ marginLeft: `${depth * 12}px` }" aria-hidden="true"></span>
      <span
        class="ft-row-label"
        role="button"
        tabindex="0"
        :title="entry.path"
        draggable="true"
        @click="activate"
        @keydown.enter.prevent="activate"
        @dblclick="open"
        @dragstart="startPathDrag($event, [entry.path])"
        @contextmenu.prevent="openFileMenu(entry, $event.clientX, $event.clientY)"
      >
        <span class="ft-row-icon" aria-hidden="true">{{ icon }}</span>
        <span class="ft-row-name">{{ entry.name }}</span>
      </span>
    </div>
    <FileTreeNode
      v-if="entry.isDir && expanded"
      v-for="child in children"
      :key="child.path"
      :entry="child"
      :depth="depth + 1"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { samePath } from "../../../shared/file-paths";
import type { FileEntry } from "../../../shared/file-types";
import { openFileMenu } from "../file-menu";
import {
  browseTo,
  browsingDir,
  isTreeNodeExpanded,
  previewFromTree,
  selectedPath,
  startPathDrag,
  toggleTreeNode,
  treeChildrenFor,
} from "../files";
import { t } from "../i18n";
import { middleBrowserEnabled, openFilesView } from "../layout";
import { settings } from "../settings";

const props = defineProps<{
  entry: FileEntry;
  /** Indentation depth; the project roots render at 1. */
  depth: number;
}>();

const expanded = computed(() => isTreeNodeExpanded(props.entry.path));
const isActive = computed(
  () =>
    (browsingDir.value !== null && samePath(browsingDir.value, props.entry.path)) ||
    (selectedPath.value !== null && samePath(selectedPath.value, props.entry.path)),
);

/** Children load on first expand — never a recursive scan up front. */
const children = computed(() => treeChildrenFor(props.entry.path));

const icon = computed(() => (props.entry.isSymlink ? "🔗" : props.entry.isDir ? "📁" : "📄"));

function toggle(): void {
  void toggleTreeNode(props.entry.path);
}

/**
 * A click. With the middle browser on, a directory jumps the browser to
 * it — the tree as a jump-in surface — and a file previews it there. With
 * the browser folded away the tree IS the navigation: a directory expands
 * in place, a file becomes the standalone preview in the middle column.
 */
function activate(): void {
  if (!props.entry.isDir) {
    void previewFromTree(props.entry);
    return;
  }
  if (middleBrowserEnabled.value) {
    openFilesView();
    void browseTo(props.entry.path);
    return;
  }
  void toggleTreeNode(props.entry.path);
}

/**
 * A double-click on a file honors the double-click setting: the system
 * app, or the same in-app preview a click already gives. A directory
 * behaves like its click.
 */
function open(): void {
  if (props.entry.isDir) {
    activate();
    return;
  }
  if (settings.files.openOnDouble === "system") {
    void window.awefork.openPath(props.entry.path).catch(() => null);
    return;
  }
  void previewFromTree(props.entry);
}
</script>
