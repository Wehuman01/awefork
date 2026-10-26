import { computed, reactive, ref, watch } from "vue";
import { settings } from "./settings";

/**
 * Shell layout state: the two side panels' widths and folded state, the
 * middle column's canvas/file view and the sidebar's sessions/file tab,
 * persisted to localStorage, plus the command palette's open flag.
 * Shared by app.vue (drag handles, view tabs), side-bar.vue (file tab)
 * and the file surfaces (which switch the middle view when they need to
 * show something).
 */

export interface PanelState {
  width: number;
  collapsed: boolean;
  /** Width to restore on un-collapse. */
  saved: number;
}

export type PanelSide = "sidebar" | "context";

/** What the middle column shows: the branch canvas or the file browser. */
export type MainView = "canvas" | "files" | "preview";

/** What the sidebar shows: the session navigation or the file tree. */
export type SidebarView = "sessions" | "files";

const LAYOUT_KEY = "awefork:layout";

export const DEFAULTS: Record<PanelSide, PanelState> = {
  sidebar: { width: 232, collapsed: false, saved: 232 },
  context: { width: 336, collapsed: false, saved: 336 },
};

export const PANEL_LIMITS: Record<PanelSide, { min: number; max: number }> = {
  sidebar: { min: 180, max: 420 },
  context: { min: 300, max: 680 },
};

/** Whether the session view's bottom file dock is expanded. */
export const fileDockOpen = ref(true);

function load(): Record<PanelSide, PanelState> {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const extra = JSON.parse(raw) as { fileDockOpen?: unknown };
      if (typeof extra.fileDockOpen === "boolean") fileDockOpen.value = extra.fileDockOpen;
    }
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<Record<PanelSide, Partial<PanelState>>>;
    const merge = (side: PanelSide): PanelState => {
      const saved = parsed[side];
      if (!saved || typeof saved.width !== "number") return { ...DEFAULTS[side] };
      const { min, max } = PANEL_LIMITS[side];
      return {
        width: Math.min(max, Math.max(min, saved.width)),
        collapsed: Boolean(saved.collapsed),
        saved: typeof saved.saved === "number" ? saved.saved : DEFAULTS[side].saved,
      };
    };
    return { sidebar: merge("sidebar"), context: merge("context") };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const panels = reactive(load());

/** True while the ⌘K palette overlay is up. */
export const paletteOpen = ref(false);

/** True while the floating settings page is up. */
export const settingsOpen = ref(false);

/** Labs gate for the file browsing system; every files entry consults it. */
export const fileBrowserEnabled = computed(() => settings.labs.fileBrowser);

/**
 * The middle column's file browser. Off (with the labs gate on) folds the
 * files view away: the sidebar is the only file navigation, and a file
 * picked there previews in the middle column until ✕/Esc or a session
 * pick returns to the canvas.
 */
export const middleBrowserEnabled = computed(() => settings.files.middleBrowser);

/** Which surface the middle column shows; the settings page owns the default,
 *  and the files option only applies while the labs gate is on. */
export const mainView = ref<MainView>(
  fileBrowserEnabled.value &&
    settings.files.middleBrowser &&
    settings.canvas.defaultView === "files"
    ? "files"
    : "canvas",
);

/** Which surface the sidebar shows. */
export const sidebarView = ref<SidebarView>("sessions");

// Turning the experiment off mid-session folds every files surface back to
// its session counterpart, so no dead view can stay on screen.
watch(fileBrowserEnabled, (on) => {
  if (on) return;
  if (mainView.value === "files" || mainView.value === "preview") mainView.value = "canvas";
  if (sidebarView.value === "files") sidebarView.value = "sessions";
});

// Folding the middle browser away mid-session must not leave the files
// view on screen with no browser behind it; the standalone preview may
// stay — both layouts can show it.
watch(middleBrowserEnabled, (on) => {
  if (on) return;
  if (mainView.value === "files") mainView.value = "canvas";
});

export function togglePalette(): void {
  paletteOpen.value = !paletteOpen.value;
}

/** Open or close the floating settings page; the ⚙ button and ⌘, share it. */
export function toggleSettings(open?: boolean): void {
  settingsOpen.value = open ?? !settingsOpen.value;
  // Only one overlay at a time — a palette left up behind the panel would
  // swallow the next Escape.
  if (settingsOpen.value) paletteOpen.value = false;
}

/** Switch the middle column; called by the tabs and by file surfaces that
 *  need to show something (a preview, a located entry). */
export function setMainView(view: MainView): void {
  mainView.value = view;
}

/** No-op while the labs gate is off: dock/tree jump-ins must not resurrect
 *  a hidden view. */
export function openFilesView(): void {
  if (!fileBrowserEnabled.value) return;
  mainView.value = "files";
}

/** Show the standalone preview in the middle column (no-browser mode). */
export function openPreviewView(): void {
  mainView.value = "preview";
}

/** Leave the standalone preview for the canvas; a no-op anywhere else, so
 *  session picks and the preview's own ✕ can call it unconditionally. */
export function leavePreviewView(): void {
  if (mainView.value === "preview") mainView.value = "canvas";
}

export function openCanvasView(): void {
  mainView.value = "canvas";
}

export function setSidebarView(view: SidebarView): void {
  sidebarView.value = view;
}

export function persistLayout(): void {
  localStorage.setItem(
    LAYOUT_KEY,
    JSON.stringify({
      sidebar: { ...panels.sidebar },
      context: { ...panels.context },
      fileDockOpen: fileDockOpen.value,
    }),
  );
}

export function toggleFileDock(): void {
  fileDockOpen.value = !fileDockOpen.value;
  persistLayout();
}

export function togglePanel(side: PanelSide): void {
  const panel = panels[side];
  if (panel.collapsed) {
    panel.collapsed = false;
    panel.width = panel.saved;
  } else {
    panel.saved = panel.width;
    panel.collapsed = true;
  }
  persistLayout();
}

/**
 * The settings page's "reset layout": both panels back to their default
 * width and unfolded, and the file dock reopened. Only the layout blob is
 * touched — every other preference keeps its value.
 */
export function resetLayout(): void {
  for (const side of ["sidebar", "context"] as const) {
    panels[side] = structuredClone(DEFAULTS[side]);
  }
  fileDockOpen.value = true;
  persistLayout();
}

export function panelStyle(side: PanelSide): Record<string, string> {
  const panel = panels[side];
  if (panel.collapsed) {
    // border-box boxes cannot shrink below their own padding + border, so a
    // bare width 0 still leaves a visible stub on the padded panels.
    return { width: "0px", flexBasis: "0px", overflow: "hidden", padding: "0", borderWidth: "0" };
  }
  return { width: `${panel.width}px`, flexBasis: `${panel.width}px`, overflow: "hidden" };
}
