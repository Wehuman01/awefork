import type { BackendId } from "../../shared/backend";

/**
 * Where one backend's queued interaction requests render. Session-scoped asks
 * — opencode permission/form and every codex approval/input — that belong to
 * the session on screen live inline at the tail of that session's message
 * flow; everything else (asks with no correlatable session) keeps the modal
 * dialog. Pure and side-effect free so the split is unit-testable without
 * mounting a component or booting the store.
 *
 * Typed over a request shape so both the mutable store type and Vue's
 * DeepReadonly mirror (what components actually hold) flow through unchanged,
 * keeping each caller's discriminated union intact.
 */
type Queue<R> = Readonly<Record<string, readonly R[]>>;

/** The fields the split reads off a request; every variant carries both. */
type Classifiable = { readonly kind: string; readonly sessionId: string | null };

/**
 * The ask kinds that render inline when they match the selection: both
 * opencode ask kinds and every codex interaction kind (command/file/permission
 * approvals, user input, MCP elicitation) — all carry a real session.
 */
const INLINE_KINDS = new Set([
  "opencode-permission",
  "opencode-form",
  "command-approval",
  "file-approval",
  "permission-approval",
  "user-input",
  "mcp-elicitation",
]);

/**
 * opencode's placeholder session for a form with no real session (an MCP
 * elicitation's hack id): it names nothing to attach a card to, so it must
 * never match a selection that happens to equal it.
 */
const GLOBAL_SESSION = "global";

/**
 * Whether an ask belongs to the session currently on screen. Only these kinds
 * are hoisted inline; a null `sessionId` (an ask with no correlatable session)
 * never matches, so it stays in the modal.
 * `hostVisible` folds in whether the inline card actually has a pane to render
 * in (see `inlineHostVisible` in state): when it does not, nothing is inline,
 * so the modal picks the ask up instead of it vanishing from both surfaces.
 *
 * An empty-string sessionId counts as no session, like null: it names nothing
 * to attach a card to, so it must not match a selection that happens to be "".
 */
function isInlineInteraction(
  request: Classifiable,
  selectedId: string | null,
  hostVisible: boolean,
): boolean {
  return (
    hostVisible &&
    INLINE_KINDS.has(request.kind) &&
    Boolean(selectedId) &&
    Boolean(request.sessionId) &&
    request.sessionId !== GLOBAL_SESSION &&
    request.sessionId === selectedId
  );
}

/**
 * Whether an ask is parked on another session: it has a real session of its
 * own, so it waits for that session's pane instead of hijacking the global
 * modal. Multiple sessions' asks therefore never fight over one dialog — each
 * renders inside its own context pane when selected. Codex asks keep their
 * auto-deny countdown while parked, same as in the modal.
 */
function isParkedInteraction(
  request: Classifiable,
  selectedId: string | null,
  hostVisible: boolean,
): boolean {
  return (
    hostVisible &&
    Boolean(selectedId) &&
    INLINE_KINDS.has(request.kind) &&
    Boolean(request.sessionId) &&
    request.sessionId !== GLOBAL_SESSION &&
    request.sessionId !== selectedId
  );
}

/**
 * The request to render inline at the tail of the selected session's message
 * flow: the first queued ask of this backend that belongs to `selectedId`.
 * Returns null when nothing qualifies — the modal then owns the queue. Pass
 * `hostVisible: false` when the pane that hosts the card is off screen so the
 * modal takes over rather than the ask going unrendered.
 */
export function pickInlineInteraction<R extends Classifiable>(
  backend: BackendId,
  interactions: Queue<R>,
  selectedId: string | null,
  hostVisible = true,
): R | null {
  return (
    (interactions[backend] ?? []).find((request) =>
      isInlineInteraction(request, selectedId, hostVisible),
    ) ?? null
  );
}

/**
 * The request the modal dialog shows: the first queued ask that neither
 * renders inline nor parks on another session's pane. Falls back to the queue
 * head when the first ask is inline but a later one is not — the functions
 * read the same predicates, so every non-parked request renders in exactly
 * one place.
 */
export function pickModalInteraction<R extends Classifiable>(
  backend: BackendId,
  interactions: Queue<R>,
  selectedId: string | null,
  hostVisible = true,
): R | null {
  const queue = interactions[backend] ?? [];
  return (
    queue.find(
      (request) =>
        !isInlineInteraction(request, selectedId, hostVisible) &&
        !isParkedInteraction(request, selectedId, hostVisible),
    ) ?? null
  );
}

/**
 * How many further inline asks wait behind the one on screen — same backend,
 * inline-kind, same session. The inline card's "N more" line reads this so an
 * ask queued for another session is not counted as one waiting inline here.
 * Zero when no session is selected or the host is off screen, mirroring
 * `pickInlineInteraction`.
 */
export function countPendingInline<R extends Classifiable>(
  backend: BackendId,
  interactions: Queue<R>,
  selectedId: string | null,
  hostVisible = true,
): number {
  const queue = interactions[backend] ?? [];
  const inline = queue.filter((request) => isInlineInteraction(request, selectedId, hostVisible));
  return Math.max(0, inline.length - 1);
}
