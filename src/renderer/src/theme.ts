/**
 * Light/dark theme switch. The palette itself lives in style.css
 * (`:root` = light, `html[data-theme="dark"]` = dark); this module owns the
 * preference: read from localStorage at boot, stamp
 * `document.documentElement.dataset.theme`, and mirror the choice to the main
 * process so native window chrome follows (skipped in the browser demo).
 */
import { ref } from "vue";

const STORAGE_KEY = "awefork:theme";

export type Theme = "light" | "dark";

export const theme = ref<Theme>(loadTheme());

function loadTheme(): Theme {
  if (typeof localStorage === "undefined") return "light";
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

function apply(next: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
  }
  // New agent windows and the title bar follow the same preference.
  void window.awefork?.setTheme?.(next);
}

/** Called once at boot, before the app mounts, to avoid a light flash. */
export function initTheme(): void {
  apply(theme.value);
}

export function toggleTheme(): void {
  theme.value = theme.value === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, theme.value);
  apply(theme.value);
}
