import type { BackendId } from "./backend";
import type { ArchiveState, SessionSummary } from "./types";

/**
 * One backend's session listing as the overview's cross-window cache holds
 * it. Every window fetches the agents it is not showing; the fetch any window
 * paid for is the fetch every window renders, so two windows can never
 * project different session sets (and therefore different counts) for the
 * same backend.
 */
export interface OverviewListing {
  sessions: SessionSummary[];
  /** The backend's own delete grace window (overlay sidecar). */
  trash: string[];
  /** The backend's own archive (overlay sidecar). */
  archive: ArchiveState;
  /** When this listing was observed; the newer fetch wins. */
  fetchedAt: number;
  /** Why the last list attempt failed; null after a success. */
  error: string | null;
}

/**
 * A run main's registry watched start (message.started without the matching
 * idle). A window that opened after the start never observed it, so the
 * registry's set is the evidence every window seeds its run state from.
 */
export interface OverviewRunningEntry {
  backend: BackendId;
  sessionId: string;
}

/**
 * True when `incoming` outranks `current`. Not-older wins keeps every window
 * on the same fetch generation: whichever window paid for the freshest
 * listing decides what all of them render, and two windows that fetched in
 * the same millisecond simply take the later arrival (equivalent data). A
 * malformed timestamp never wins.
 */
export function overviewListingIsNewer(
  current: OverviewListing | undefined,
  incoming: OverviewListing,
): boolean {
  if (!incoming || !Number.isFinite(incoming.fetchedAt)) return false;
  return current === undefined || incoming.fetchedAt >= current.fetchedAt;
}
