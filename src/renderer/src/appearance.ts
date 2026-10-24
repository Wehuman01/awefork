/**
 * Appearance preferences that are pure `<html>` attributes: density, motion
 * and the canvas dot grid. They live outside theme.ts because they change
 * layout and paint, not the palette — but they share the same boot rule:
 * stamp before the first frame, then follow every change.
 *
 * The CSS does the work (see the `html[data-*]` rules in style.css), so a
 * preference costs one attribute write and no component re-render.
 */
import { watch } from "vue";
import { settings } from "./settings";

function stamp(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.density = settings.appearance.density;
  root.dataset.motion = settings.appearance.motion ? "on" : "off";
  root.dataset.dotGrid = settings.appearance.dotGrid ? "on" : "off";
}

/** Called once at boot, right after initTheme(). */
export function initAppearance(): void {
  stamp();
  watch(
    () => [settings.appearance.density, settings.appearance.motion, settings.appearance.dotGrid],
    () => stamp(),
  );
}
