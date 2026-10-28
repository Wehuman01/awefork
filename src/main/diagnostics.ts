import { format } from "node:util";
import type { DiagnosticEntry, DiagnosticLevel } from "../shared/diagnostics.js";

export type { DiagnosticEntry, DiagnosticLevel } from "../shared/diagnostics.js";

/**
 * Main-process diagnostics: the ring buffer behind the status panel.
 *
 * A packaged launch has no terminal, so everything the main process used to
 * say with console.error/warn — a backend child dying, a spawn failing, an
 * event subscription collapsing — was invisible exactly when it mattered.
 * The buffer keeps a bounded tail of those lines; the panel reads it through
 * IPC and streams new entries as they land.
 *
 * Pure by design: no electron import, injectable clock, so the buffer and
 * its subscription are testable without an app.
 */
export interface DiagnosticsOptions {
  /** Ring capacity; oldest entries drop out first. */
  limit?: number;
  /** Per-entry character cap; the head survives, the tail is cut. */
  maxEntryChars?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface Diagnostics {
  /** Append one entry; returns it as stored (truncated, sequenced). */
  record(level: DiagnosticLevel, text: string): DiagnosticEntry;
  /** A copy of the buffered entries, oldest first. */
  snapshot(): DiagnosticEntry[];
  /** Drop everything (the panel's clear button). */
  clear(): void;
  /** Live feed for IPC broadcast; returns the unsubscribe. */
  subscribe(listener: (entry: DiagnosticEntry) => void): () => void;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_MAX_ENTRY_CHARS = 8_192;

export function createDiagnostics(options: DiagnosticsOptions = {}): Diagnostics {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const maxEntryChars = Math.max(1, options.maxEntryChars ?? DEFAULT_MAX_ENTRY_CHARS);
  const now = options.now ?? (() => Date.now());
  const entries: DiagnosticEntry[] = [];
  const listeners = new Set<(entry: DiagnosticEntry) => void>();
  let sequence = 0;

  return {
    record(level, text) {
      const entry: DiagnosticEntry = {
        seq: ++sequence,
        at: now(),
        level,
        text: text.length > maxEntryChars ? text.slice(0, maxEntryChars) : text,
      };
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      for (const listener of [...listeners]) {
        try {
          listener(entry);
        } catch {
          // A broken listener must not cost the app its diagnostics.
        }
      }
      return entry;
    },

    snapshot: () => [...entries],

    clear() {
      entries.length = 0;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Marks a console method this module already wrapped, so a second install is a no-op. */
const TEE_MARKER = Symbol("aweforkDiagnosticsTee");

/**
 * Mirror console.error/warn into the buffer. Every backend child's death,
 * spawn failure and subscription collapse already goes through those two
 * methods, so the tee captures the whole existing surface without touching
 * a single call site — and the original still runs, so dev terminals keep
 * their output. The entry is recorded BEFORE the original runs: a console
 * that throws must not cost the app its diagnostics. Returns the uninstall.
 */
export function installConsoleTee(
  diagnostics: Diagnostics,
  consoleObj: Console = globalThis.console,
): () => void {
  const originals = new Map<DiagnosticLevel, (...args: unknown[]) => void>();
  for (const level of ["error", "warn"] as const) {
    const original = consoleObj[level] as unknown as ((...args: unknown[]) => void) & {
      [TEE_MARKER]?: boolean;
    };
    if (typeof original !== "function" || original[TEE_MARKER]) continue;
    originals.set(level, original);
    const wrapped = (...args: unknown[]): void => {
      try {
        diagnostics.record(level, format(...args));
      } catch {
        // Recording must never break the caller's console.
      }
      original.apply(consoleObj, args);
    };
    (wrapped as unknown as { [TEE_MARKER]?: boolean })[TEE_MARKER] = true;
    consoleObj[level] = wrapped as unknown as Console[typeof level];
  }
  return () => {
    for (const [level, original] of originals) {
      consoleObj[level] = original as unknown as Console[typeof level];
    }
  };
}

/**
 * A promise nobody awaited is the other invisible failure of a packaged
 * launch: the rejection has nowhere to print. Hook it into the same buffer.
 * `processObj` is injectable so tests can emit the event by hand instead of
 * producing a real unhandled rejection. Returns the uninstall.
 */
export function hookUnhandledRejections(
  diagnostics: Diagnostics,
  processObj: NodeJS.Process = process,
): () => void {
  const listener = (reason: unknown): void => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    diagnostics.record("error", `unhandled rejection: ${detail}`);
  };
  processObj.on("unhandledRejection", listener);
  return () => {
    processObj.off("unhandledRejection", listener);
  };
}
