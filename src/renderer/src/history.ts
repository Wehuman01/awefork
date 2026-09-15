import { reactive, readonly } from "vue";
import type { BackendId } from "../../shared/backend";

/**
 * Operation history: a linear journal of what the user did this run, with
 * undo/redo driven by inverse closures. Undoable entries carry undo+redo;
 * lock entries (sends, turn deletes, aborts, interaction replies) record
 * what happened but seal everything below them — linear undo cannot cross
 * an irreversible operation, so the panel greys the sealed range out.
 *
 * Persistence is deliberately run-scoped: the journal dies with the window,
 * and pending soft deletes flush on the next boot (see state.ts flushTrash).
 */

export type HistoryKind =
  | "pin"
  | "mark"
  | "tags"
  | "tagColor"
  | "tagDelete"
  | "archiveSession"
  | "archiveDirectory"
  | "restoreSession"
  | "restoreDirectory"
  | "addDirectory"
  | "removeDirectory"
  | "createSession"
  | "cloneSession"
  | "renameSession"
  | "deleteSession"
  | "sendPrompt"
  | "deleteTurn"
  | "abortRun"
  | "respondInteraction";

export interface HistoryEntry {
  id: number;
  time: number;
  backend: BackendId;
  kind: HistoryKind;
  label: string;
  undoable: boolean;
  /** Sticky red mark: the last undo/redo attempt on this entry failed. */
  failed: boolean;
  /**
   * Inverse of the operation. true = the cursor may move; false = stop the
   * walk silently (e.g. the user cancelled a re-confirm); throw = mark the
   * entry failed and toast the reason. Closures must route every IPC through
   * `backend`, never the active one — undo has to work after a backend
   * switch.
   */
  undo?: () => Promise<boolean>;
  redo?: () => Promise<boolean>;
}

interface HistoryState {
  entries: HistoryEntry[];
  /** entries[0..cursor) are applied; [cursor..] are undone and redoable. */
  cursor: number;
  /** One-line feedback for undo/redo walks; auto-clears like the toasts. */
  toast: string | null;
  panelOpen: boolean;
  busy: boolean;
}

/** Oldest entries fall off the front once the journal outgrows this. */
const MAX_ENTRIES = 200;

const state = reactive<HistoryState>({
  entries: [],
  cursor: 0,
  toast: null,
  panelOpen: false,
  busy: false,
});

export const history = readonly(state);

let nextId = 1;

function truncateRedo(): void {
  if (state.cursor < state.entries.length) state.entries.splice(state.cursor);
}

function pushEntry(entry: HistoryEntry): HistoryEntry {
  if (pending > 0) {
    // A walk is mid-flight and can span seconds of IPC. Its cursor writes
    // must land before this entry resets the cursor, or the journal
    // misreads the just-performed op as undone — so append through the
    // same serialized queue instead of cutting in front of the walk.
    queue = queue.then(() => {
      appendEntry(entry);
    });
    return entry;
  }
  appendEntry(entry);
  return entry;
}

function appendEntry(entry: HistoryEntry): void {
  truncateRedo();
  state.entries.push(entry);
  if (state.entries.length > MAX_ENTRIES) {
    state.entries.splice(0, state.entries.length - MAX_ENTRIES);
  }
  state.cursor = state.entries.length;
}

/**
 * Record an undoable operation. Any new operation truncates the redo
 * segment — the standard linear-history rule, same as editors/Photoshop.
 */
export function track(spec: {
  backend: BackendId;
  kind: HistoryKind;
  label: string;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}): HistoryEntry {
  truncateRedo();
  return pushEntry({
    id: nextId++,
    time: Date.now(),
    backend: spec.backend,
    kind: spec.kind,
    label: spec.label,
    undoable: true,
    failed: false,
    undo: spec.undo,
    redo: spec.redo,
  });
}

/** Record an irreversible operation: visible in the journal, seals everything below. */
export function trackEvent(spec: {
  backend: BackendId;
  kind: HistoryKind;
  label: string;
}): HistoryEntry {
  truncateRedo();
  return pushEntry({
    id: nextId++,
    time: Date.now(),
    backend: spec.backend,
    kind: spec.kind,
    label: spec.label,
    undoable: false,
    failed: false,
  });
}

// ── feedback ─────────────────────────────────────────────────────────

const NOTICE_MS = 4000;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function notice(text: string): void {
  state.toast = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    if (state.toast === text) state.toast = null;
  }, NOTICE_MS);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── undo / redo walks ────────────────────────────────────────────────

/**
 * Undo entries from the cursor down to `toIdx` inclusive. Stops at the
 * first lock, silent refusal, or failure — a partial walk keeps whatever
 * progress it made.
 */
async function undoRange(toIdx: number): Promise<boolean> {
  let last: HistoryEntry | null = null;
  let stopped: string | null = null;
  while (state.cursor - 1 >= toIdx) {
    const entry = state.entries[state.cursor - 1];
    if (!entry) break;
    if (!entry.undoable || !entry.undo) {
      stopped = `「${entry.label}」不可撤销，更早的操作已被锁定`;
      break;
    }
    try {
      if (!(await entry.undo())) break;
      entry.failed = false;
      state.cursor -= 1;
      last = entry;
    } catch (error) {
      entry.failed = true;
      stopped = `撤销失败：${messageOf(error)}`;
      break;
    }
  }
  // Why the walk stopped short outranks what it managed before stopping.
  if (stopped) notice(stopped);
  else if (last) notice(`已撤销：${last.label}`);
  return last !== null;
}

/** Redo entries from the cursor up to `toIdx` inclusive. */
async function redoRange(toIdx: number): Promise<boolean> {
  let last: HistoryEntry | null = null;
  let stopped: string | null = null;
  while (state.cursor <= toIdx && state.cursor < state.entries.length) {
    const entry = state.entries[state.cursor];
    if (!entry?.redo) break;
    try {
      if (!(await entry.redo())) break;
      entry.failed = false;
      state.cursor += 1;
      last = entry;
    } catch (error) {
      entry.failed = true;
      stopped = `重做失败：${messageOf(error)}`;
      break;
    }
  }
  if (stopped) notice(stopped);
  else if (last) notice(`已重做：${last.label}`);
  return last !== null;
}

/**
 * Only one walk at a time: rapid ⌘Z presses and panel clicks queue up and
 * execute in order, so the cursor never moves under an in-flight closure.
 */
let queue: Promise<void> = Promise.resolve();
let pending = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  pending += 1;
  state.busy = true;
  const run = queue.then(fn).finally(() => {
    pending -= 1;
    if (pending === 0) state.busy = false;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Undo the newest `n` applied entries; ⌘/Ctrl+Z is undoSteps(1). */
export function undoSteps(n = 1): Promise<boolean> {
  return enqueue(() => undoRange(Math.max(0, state.cursor - n)));
}

/** Redo the oldest `n` undone entries; ⌘/Ctrl+Shift+Z is redoSteps(1). */
export function redoSteps(n = 1): Promise<boolean> {
  return enqueue(() => redoRange(Math.min(state.entries.length - 1, state.cursor + n - 1)));
}

/** Undo until the named entry is undone too (panel row click / toast 撤销). */
export function undoTo(id: number): Promise<boolean> {
  return enqueue(async () => {
    const idx = state.entries.findIndex((entry) => entry.id === id);
    if (idx < 0 || idx >= state.cursor) return false;
    return undoRange(idx);
  });
}

/** Redo until the named entry is applied again (panel row click). */
export function redoTo(id: number): Promise<boolean> {
  return enqueue(async () => {
    const idx = state.entries.findIndex((entry) => entry.id === id);
    if (idx < 0 || idx < state.cursor) return false;
    return redoRange(idx);
  });
}

// ── panel / badge helpers ────────────────────────────────────────────

/** Consecutive undoable entries at the top of the applied stack — the badge number. */
export function undoDepth(): number {
  let depth = 0;
  for (let i = state.cursor - 1; i >= 0; i -= 1) {
    if (!state.entries[i]?.undoable) break;
    depth += 1;
  }
  return depth;
}

export function redoDepth(): number {
  return state.entries.length - state.cursor;
}

/**
 * Newest applied lock (irreversible entry): it and everything below it are
 * sealed. -1 = nothing sealed.
 */
export function lockIndex(): number {
  for (let i = state.cursor - 1; i >= 0; i -= 1) {
    if (!state.entries[i]?.undoable) return i;
  }
  return -1;
}

export function togglePanel(): void {
  state.panelOpen = !state.panelOpen;
}

export function closePanel(): void {
  state.panelOpen = false;
}
