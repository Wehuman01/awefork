/**
 * Light/dark theme switch. The palette itself lives in style.css
 * (`:root` = light, `html[data-theme="dark"]` = dark); this module owns the
 * preference and stamps `document.documentElement.dataset.theme`.
 *
 * The preference has three values now: light, dark and "system" (follow the
 * OS appearance). `theme` stays the resolved light/dark the rest of the UI
 * reads — a toolbar glyph, the native window chrome — while the preference
 * itself is what the settings page shows as selected.
 */
import { computed, ref, watch } from "vue";
import { settings, type ThemePreference } from "./settings";

/** Resolved appearance actually painted right now. */
export const theme = ref<"light" | "dark">("light");

/** What the user chose; "system" keeps tracking the OS. */
export const themePreference = computed<ThemePreference>(() => settings.appearance.theme);

const query =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return query?.matches ? "dark" : "light";
  return preference;
}

function apply(preference: ThemePreference): void {
  const next = resolve(preference);
  theme.value = next;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
    // Native scrollbars and form controls follow the painted appearance.
    document.documentElement.style.colorScheme = next;
  }
  // New agent windows and the title bar follow the same preference.
  void window.awefork?.setTheme?.(next);
}

/** Called once at boot, before the app mounts, to avoid a light flash. */
export function initTheme(): void {
  apply(settings.appearance.theme);
  // The OS can flip while "system" is selected; repaint without touching the
  // stored preference.
  query?.addEventListener("change", () => {
    if (settings.appearance.theme === "system") apply("system");
  });
  watch(
    () => settings.appearance.theme,
    (preference) => apply(preference),
  );
}

/** Cycle light → dark → system, for the top bar's one-click toggle. */
export function cycleTheme(): void {
  const order: ThemePreference[] = ["light", "dark", "system"];
  const index = order.indexOf(settings.appearance.theme);
  settings.appearance.theme = order[(index + 1) % order.length] ?? "system";
}

/**
 * The top bar's glyph. "System" gets its own half-filled mark instead of
 * borrowing ☀/☾, so a click never looks like it will do nothing.
 */
export function themeGlyph(): string {
  if (settings.appearance.theme === "system") return "◐";
  return theme.value === "dark" ? "☀" : "☾";
}
