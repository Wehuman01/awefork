<template>
  <div class="ft-node">
    <div class="ft-row" :class="{ active: isActive }">
      <button
        type="button"
        class="ft-caret"
        :style="{ marginLeft: `${depth * 12}px` }"
        :aria-expanded="expanded"
        :title="t('files.toggleTree')"
        @click.stop="toggle"
        >{{ expanded ? "▾" : "▸" }}</button
      >
      <span
        class="ft-row-label"
        role="button"
        tabindex="0"
        :title="entry.path"
        draggable="true"
        @click="browse"
        @keydown.enter.prevent="browse"
        @dragstart="startPathDrag($event, [entry.path])"
        @contextmenu.prevent="openFileMenu(entry, $event.clientX, $event.clientY)"
      >
        <span class="ft-row-icon" aria-hidden="true">{{ entry.isSymlink ? "🔗" : "📁" }}</span>
        <span class="ft-row-name">{{ entry.name }}</span>
      </span>
    </div>
    <FileTreeNode
      v-if="expanded"
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
  files,
  isTreeNodeExpanded,
  startPathDrag,
  toggleTreeNode,
  visibleTreeChildren,
} from "../files";
import { t } from "../i18n";
import { openFilesView } from "../layout";

const props = defineProps<{
  entry: FileEntry;
  /** Indentation depth; the project roots render at 1. */
  depth: number;
}>();

const expanded = computed(() => isTreeNodeExpanded(props.entry.path));
const isActive = computed(
  () => browsingDir.value !== null && samePath(browsingDir.value, props.entry.path),
);

/** Children load on first expand — never a recursive scan up front. */
const children = computed(() => visibleTreeChildren(props.entry.path).filter((e) => e.isDir));

function toggle(): void {
  void toggleTreeNode(props.entry.path);
}

function browse(): void {
  openFilesView();
  void browseTo(props.entry.path);
}
</script>
