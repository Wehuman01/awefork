/**
 * Shared open-request state for the one FileMenu instance app.vue mounts.
 * Any file surface — the sidebar tree, the list, the icon grid — calls
 * openFileMenu(entry, x, y); the menu itself watches this module, so no
 * component has to own (or re-render) another's popup.
 */
import { reactive } from "vue";
import type { FileEntry } from "../../shared/file-types";

interface FileMenuState {
  entry: FileEntry | null;
  x: number;
  y: number;
  /** Bumped per request so re-opening the same entry still re-runs. */
  seq: number;
}

const state = reactive<FileMenuState>({ entry: null, x: 0, y: 0, seq: 0 });

export const fileMenu = state;

export function openFileMenu(entry: FileEntry, x: number, y: number): void {
  state.entry = entry;
  state.x = x;
  state.y = y;
  state.seq += 1;
}

export function closeFileMenu(): void {
  state.entry = null;
}
