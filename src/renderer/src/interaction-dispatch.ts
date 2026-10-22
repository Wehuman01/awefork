import type { BackendId } from "../../shared/backend";

/**
 * Where one backend's queued interaction requests render: every ask —
 * permission, form, codex approval, user input — lives inline at the tail of
 * the context pane's message flow. There is no global modal: an ask for the
 * session on screen shows there, an ask parked on another session waits for
 * that session's pane, and an ask with no correlatable session (null, empty,
 * or opencode's "global" placeholder) rides whatever pane is visible rather
 * than vanishing. Pure and side-effect free so the split is unit-testable
 * without mounting a component or booting the store.
 *
 * Typed over a request shape so both the mutable store type and Vue's
 * DeepReadonly mirror (what components actually hold) flow through unchanged,
 * keeping each caller's discriminated union intact.
 */
type Queue<R> = Readonly<Record<string, readonly R[]>>;

/** The fields the split reads off a request; every variant carries both. */
type Classifiable = { readonly kind: string; readonly sessionId: string | null };

/**
 * opencode's placeholder session for a form with no real session (an MCP
 * elicitation's hack id): it names nothing to attach a card to, so it must
 * never match a selection that happens to equal it — it renders as a
 * sessionless ask on whatever pane is visible instead.
 */
const GLOBAL_SESSION = "global";

/**
 * An ask with no session of its own (null, empty, or the "global"
 * placeholder). It has no pane to park on, so the visible pane adopts it —
 * with no modal, that is the only alternative to rendering nowhere.
 */
function isSessionless(request: Classifiable): boolean {
  return !request.sessionId || request.sessionId === GLOBAL_SESSION;
}

/**
 * Whether an ask renders in the pane on screen: it belongs to the selected
 * session, or it is sessionless and the visible pane adopts it. `hostVisible`
 * folds in whether the inline card actually has a pane to render in (see
 * `inlineHostVisible` in state); when it does not (compare mode, no visible
 * session), nothing renders anywhere and the ask simply waits.
 *
 * An empty-string sessionId counts as no session, like null: it names nothing
 * to attach a card to, so it must not match a selection that happens to be "".
 */
function isInlineInteraction(
  request: Classifiable,
  selectedId: string | null,
  hostVisible: boolean,
): boolean {
  if (!hostVisible || !selectedId) return false;
  return request.sessionId === selectedId || isSessionless(request);
}

/**
 * The request to render inline at the tail of the selected session's message
 * flow: the first queued ask of this backend that the visible pane owns.
 * Returns null when nothing qualifies — the ask then waits for its pane.
 * Pass `hostVisible: false` when the pane that hosts the card is off screen.
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
 * How many further asks wait behind the one on screen for this same pane —
 * same backend, same session (or sessionless). The inline card's "N more"
 * line reads this so the count matches what swapping the card forward shows.
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
