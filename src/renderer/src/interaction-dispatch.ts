import type { BackendId } from "../../shared/backend";

/**
 * Where one backend's queued interaction requests render. opencode permission
 * asks that belong to the session on screen live inline at the tail of that
 * session's message flow; everything else (codex approvals, asks for other
 * sessions) keeps the modal dialog. Pure and side-effect free so the split is
 * unit-testable without mounting a component or booting the store.
 *
 * Typed over a request shape so both the mutable store type and Vue's
 * DeepReadonly mirror (what components actually hold) flow through unchanged,
 * keeping each caller's discriminated union intact.
 */
type Queue<R> = Readonly<Record<string, readonly R[]>>;

/**
 * Whether an opencode permission ask belongs to the session currently on
 * screen. Only this kind is hoisted inline; a null `sessionId` (an ask with no
 * correlatable session) never matches, so it stays in the modal.
 */
function isInlineInteraction(
  request: { readonly kind: string; readonly sessionId: string | null },
  selectedId: string | null,
): boolean {
  return (
    request.kind === "opencode-permission" &&
    selectedId !== null &&
    request.sessionId === selectedId
  );
}

/**
 * The request to render inline at the tail of the selected session's message
 * flow: the first queued ask of this backend that belongs to `selectedId`.
 * Returns null when nothing qualifies — the modal then owns the queue.
 */
export function pickInlineInteraction<
  R extends { readonly kind: string; readonly sessionId: string | null },
>(backend: BackendId, interactions: Queue<R>, selectedId: string | null): R | null {
  return (
    (interactions[backend] ?? []).find((request) => isInlineInteraction(request, selectedId)) ??
    null
  );
}

/**
 * The request the modal dialog shows: the first queued ask that does NOT
 * belong inline. Falls back to the queue head when the first ask is inline but
 * a later one is not — the two functions are complementary, so every queued
 * request renders in exactly one place.
 */
export function pickModalInteraction<
  R extends { readonly kind: string; readonly sessionId: string | null },
>(backend: BackendId, interactions: Queue<R>, selectedId: string | null): R | null {
  const queue = interactions[backend] ?? [];
  return queue.find((request) => !isInlineInteraction(request, selectedId)) ?? null;
}
