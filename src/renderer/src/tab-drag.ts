import { type Ref, ref } from "vue";

/**
 * Drag-to-reorder for the tab strips (canvas story tabs, file browser tabs).
 *
 * A tab drag carries its own type, so a path dragged out of the sidebar — or
 * in from the Finder — is never mistaken for one: those drops belong to the
 * surface under the pointer, and the strip stays out of their way.
 */
export const TAB_DRAG_TYPE = "application/x-awefork-tab";

export interface TabDropMarker {
  /** The tab the dragged one would land against. */
  id: string;
  /** Which edge of that tab: in front of it, or behind it. */
  side: "before" | "after";
}

export interface TabDrag {
  /** The tab being dragged, or null between drags. */
  draggingId: Ref<string | null>;
  /** Where the dragged tab would land, or null while the gesture is inert. */
  marker: Ref<TabDropMarker | null>;
  onDragStart(tabId: string, event: DragEvent): void;
  onDragOver(tabId: string, event: DragEvent): void;
  onDragLeave(tabId: string, event: DragEvent): void;
  onDrop(tabId: string, event: DragEvent): void;
  onDragEnd(): void;
}

/**
 * Wire one strip to `reorder(tabId, beforeTabId)` — move a tab in front of
 * another, or to the end when beforeTabId is null. `ids` reads the strip's
 * current order, which is what turns "behind that tab" into the tab that
 * follows it.
 */
export function createTabDrag(
  ids: () => readonly string[],
  reorder: (tabId: string, beforeTabId: string | null) => void,
): TabDrag {
  const draggingId = ref<string | null>(null);
  const marker = ref<TabDropMarker | null>(null);

  function isTabDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes(TAB_DRAG_TYPE) ?? false;
  }

  /** Pointer left half of the tab lands the drag in front of it, right half behind. */
  function sideOf(event: DragEvent): TabDropMarker["side"] {
    const box = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (!box) return "before";
    return event.clientX < box.left + box.width / 2 ? "before" : "after";
  }

  function clear(): void {
    draggingId.value = null;
    marker.value = null;
  }

  return {
    draggingId,
    marker,

    onDragStart(tabId, event) {
      const dt = event.dataTransfer;
      // One drag at a time; a second start belongs to a gesture already live.
      if (!dt || draggingId.value !== null) return;
      dt.setData(TAB_DRAG_TYPE, tabId);
      dt.effectAllowed = "move";
      draggingId.value = tabId;
    },

    onDragOver(tabId, event) {
      if (!isTabDrag(event)) return;
      // Claim the drop so the strip owns tab drags, and stop the event here:
      // the file browser's surface-level path handlers must never see one.
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (draggingId.value === null || draggingId.value === tabId) {
        // Hovering the dragged tab itself (or a stale drag) offers no landing.
        marker.value = null;
        return;
      }
      marker.value = { id: tabId, side: sideOf(event) };
    },

    onDragLeave(tabId, event) {
      // Moving onto the tab's own × is not leaving the tab.
      const root = event.currentTarget as HTMLElement | null;
      const related = event.relatedTarget as Node | null;
      if (related && root?.contains(related)) return;
      if (marker.value?.id === tabId) marker.value = null;
    },

    onDrop(tabId, event) {
      if (!isTabDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const dragged = draggingId.value;
      clear();
      if (dragged === null || dragged === tabId) return;
      const order = ids();
      const at = order.indexOf(tabId);
      if (at < 0) return;
      const after = sideOf(event) === "after";
      // Behind the last tab is the end of the strip: no tab follows, so the
      // move appends. A landing that is already where the tab sits is a
      // no-op the store's own guard declines.
      const beforeId = after ? (order[at + 1] ?? null) : tabId;
      reorder(dragged, beforeId);
    },

    onDragEnd() {
      // A drag that ends anywhere — a drop, a cancel, Esc — leaves nothing armed.
      clear();
    },
  };
}
