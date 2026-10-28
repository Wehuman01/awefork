/**
 * Status-panel diagnostics: what the main process's console said.
 *
 * A packaged launch has no terminal, so a backend child dying or a spawn
 * failing used to fail silently. The main process keeps a bounded tail of
 * its console.error/warn lines (see main/diagnostics.ts); these are the
 * shapes that cross the bridge to the panel.
 */

export type DiagnosticLevel = "error" | "warn";

export interface DiagnosticEntry {
  /** Monotonic per app session; a late subscriber can order what it missed. */
  seq: number;
  at: number;
  level: DiagnosticLevel;
  text: string;
}

/**
 * One message on the live feed: either a newly recorded entry, or the
 * app-global clear (every window's panel converges on it).
 */
export interface DiagnosticUpdate {
  entry?: DiagnosticEntry;
  cleared?: boolean;
}
