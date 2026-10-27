import type { BackendId } from "../../shared/backend";
import type { CanvasTab } from "./state";

/**
 * Canvas-tab restore across restarts, per backend.
 *
 * Tab identity is the story root (a fork tree), not a session id: branches
 * move, forks land mid-story, and a tab parked on the tip would restore to
 * a story whose tip changed overnight. The canvas camera is deliberately
 * NOT persisted — the first paint fits the story anyway, and a stale
 * camera from yesterday's layout fights the fit.
 *
 * Same storage shape as the layout blob (localStorage, per-backend key),
 * validated on read like any untrusted input: a corrupt entry costs the
 * restore, never the boot.
 */

const KEY_PREFIX = "awefork:tabs:";

interface StoredTab {
  /** Story root session id; null = a blank tab. */
  rootId: string | null;
  /** Session the tab had selected when the app last closed. */
  selectedId: string | null;
  /** Turn the tab had locked. */
  selectedTurnId: string | null;
  /** Directory the tab was browsing. */
  directory: string | null;
}

interface StoredTabs {
  tabs: StoredTab[];
  /** Id of the tab that was active on close. */
  activeTabId: string | null;
}

function keyOf(backend: BackendId): string {
  return `${KEY_PREFIX}${backend}`;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

/** Validate one stored tab; a malformed entry reads as a blank tab. */
function pickTab(value: unknown): StoredTab {
  if (typeof value !== "object" || value === null) {
    return { rootId: null, selectedId: null, selectedTurnId: null, directory: null };
  }
  const raw = value as Record<string, unknown>;
  return {
    rootId: isStringOrNull(raw.rootId) ? raw.rootId : null,
    selectedId: isStringOrNull(raw.selectedId) ? raw.selectedId : null,
    selectedTurnId: isStringOrNull(raw.selectedTurnId) ? raw.selectedTurnId : null,
    directory: isStringOrNull(raw.directory) ? raw.directory : null,
  };
}

/** Read the stored tabs for one backend; null when nothing valid is stored. */
export function loadTabs(backend: BackendId): StoredTabs | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyOf(backend));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTabs>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs.slice(0, MAX_TABS).map(pickTab);
    return {
      tabs,
      activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
    };
  } catch {
    return null;
  }
}

/** How many tabs a restore may bring back; the rest drop off the end. */
export const MAX_TABS = 12;

/** Persist the live tabs for one backend; a failed write loses only the
 *  restore, so it stays silent. */
export function saveTabs(
  backend: BackendId,
  tabs: readonly {
    rootId: string | null;
    selectedId: string | null;
    selectedTurnId: string | null;
    directory: string | null;
  }[],
  activeTabId: string | null,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stored: StoredTabs = {
      tabs: tabs.slice(0, MAX_TABS).map((tab) => ({
        rootId: tab.rootId,
        selectedId: tab.selectedId,
        selectedTurnId: tab.selectedTurnId,
        directory: tab.directory,
      })),
      activeTabId,
    };
    localStorage.setItem(keyOf(backend), JSON.stringify(stored));
  } catch {
    // Quota or serialization failure: the restore is a nicety.
  }
}

/** Map stored tabs back into live CanvasTab records with fresh ids. */
export function reviveTabs(stored: StoredTabs): { tabs: CanvasTab[]; activeIndex: number } {
  const tabs: CanvasTab[] = stored.tabs.map((tab) => ({
    id: "",
    rootId: tab.rootId,
    selectedId: tab.selectedId,
    selectedTurnId: tab.selectedTurnId,
    directory: tab.directory,
  }));
  // Fresh ids, tab-restore-1..n; the stored activeTabId names the tab's
  // selected session (ids are minted per launch and cannot be reused).
  let seq = 0;
  let activeIndex = 0;
  for (const [index, tab] of tabs.entries()) {
    seq += 1;
    tab.id = `tab-restore-${seq}`;
    if (stored.activeTabId !== null && stored.tabs[index]?.selectedId === stored.activeTabId) {
      activeIndex = index;
    }
  }
  return { tabs, activeIndex };
}
