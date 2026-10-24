/**
 * The text splice behind every path insertion — a drag-drop onto a draft,
 * the context menu's insert action. Pure, so the rules stay testable:
 *
 * - the path lands verbatim: no URL encoding, no `file://`, no shell
 *   escaping, spaces and CJK intact;
 * - it replaces the selection when there is one, otherwise splices in at
 *   the caret, leaving the rest of the text untouched;
 * - it takes its own line, with newlines added only where text would
 *   otherwise glue onto it;
 * - the returned caret says where the next keystroke goes.
 */

export interface Caret {
  start: number;
  end: number;
}

export interface InsertResult {
  text: string;
  caret: Caret;
}

/** Clamp a caret into the text it refers to (stale carets happen). */
function clamp(text: string, caret: Caret | null | undefined): Caret {
  if (!caret) return { start: text.length, end: text.length };
  const start = Math.min(Math.max(caret.start, 0), text.length);
  const end = Math.min(Math.max(caret.end, start), text.length);
  return { start, end };
}

/**
 * Splice `insert` into `text` at `caret` (or the end). Multi-item batches
 * are the caller's job — join them with "\n" and call once, so the whole
 * batch shares one line separation.
 */
export function insertPathText(text: string, insert: string, caret?: Caret | null): InsertResult {
  const at = clamp(text, caret);
  const head = text.slice(0, at.start);
  const tail = text.slice(at.end);
  // A newline before only when the previous line has content; one after
  // keeps following text on its own line.
  const prefix = head === "" || head.endsWith("\n") ? "" : "\n";
  const line = `${prefix}${insert}\n`;
  return {
    text: `${head}${line}${tail}`,
    caret: { start: head.length + line.length, end: head.length + line.length },
  };
}

/** Several paths, one per line, in the order given — a batch drop's payload. */
export function joinPaths(paths: readonly string[]): string {
  return paths.join("\n");
}
