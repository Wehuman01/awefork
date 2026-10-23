/**
 * The platform's primary modifier, as the UI names it.
 *
 * macOS calls it ⌘, Windows and Linux call it Ctrl. The app accepts either
 * key everywhere (every handler tests `metaKey || ctrlKey`), but a hint
 * that says "⌘Z" on Windows teaches a key the user's keyboard does not
 * have — so hints read this constant instead of hardcoding a symbol.
 */

/** True when the app runs on macOS. */
export const isMacPlatform: boolean =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

/**
 * The primary modifier, ready to concatenate into a hint: "⌘" on macOS,
 * "Ctrl+" elsewhere. The trailing "+" is part of the non-mac form so a
 * string like "{mod}Z" reads "⌘Z" on macOS and "Ctrl+Z" elsewhere without
 * the call site branching.
 */
export const modKey: string = isMacPlatform ? "⌘" : "Ctrl+";

/** The primary modifier plus a key: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function modWith(key: string): string {
  return isMacPlatform ? `⌘${key}` : `Ctrl+${key}`;
}
