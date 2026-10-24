import { BACKEND_LABELS, type BackendId } from "../../shared/backend";
import {
  markOverviewSeen,
  mergeOverviewLedger,
  type OverviewReadEntry,
  type OverviewReadLedger,
  overviewKey,
  pruneOverviewLedger,
  recordOverviewSettle,
} from "../../shared/overview-ledger-types";
import type { SessionSummary } from "../../shared/types";

// The ledger's types and pure folds are shared with the main process (the one
// writer) — re-exported so components and tests keep importing them from the
// renderer's overview module.
export {
  markOverviewSeen,
  mergeOverviewLedger,
  type OverviewReadEntry,
  type OverviewReadLedger,
  overviewKey,
  pruneOverviewLedger,
  recordOverviewSettle,
};

/**
 * Pure projection behind the canvas session overview (画布会话总览).
 *
 * The panel lists sessions from every connected agent; the interesting part is
 * not the list but the *status* it claims. Everything here is a pure function
 * of observable facts — a queued ask, a run in flight, awefork's own record of
 * a settled run, and how much of that record the user has actually seen — so
 * the projection is testable without a store, a server or a DOM.
 *
 * The unread ledger itself is NOT owned here: the main process keeps the one
 * authoritative copy (shared/overview-ledger.ts) so every window agrees on
 * which results are new. This module holds only the pure folds —
 * recordOverviewSettle, markOverviewSeen, pruneOverviewLedger — which the
 * renderer applies to its in-memory copy after main confirms the write, and
 * which main mirrors for its own file.
 *
 * Honesty rules this module exists to enforce:
 * - "running" needs positive evidence (a run awefork watches), never a guess
 *   from a quiet session.
 * - "unread" needs an explicit ending plus an unseen revision. A lost
 *   connection or a silent timeout is "unknown", never a completed result.
 * - "idle" is the baseline when no run was observed. It does not confirm
 *   that an external terminal is inactive.
 * - The revision is awefork's own observation counter. It is NOT the agent's
 *   turn id or the run's exact completion time, and is never shown as either.
 */

/** The states the overview projects from run / wait / result / read facts. */
export type OverviewStatus =
  | "waiting"
  | "unread"
  | "running"
  | "unknown"
  | "failed"
  | "read"
  | "idle";

/**
 * Display and sort order: what needs the user first, plain idle last. The
 * panel's tabs reuse the first five; `read`/`idle` only show under 全部.
 */
export const OVERVIEW_STATUS_ORDER: readonly OverviewStatus[] = [
  "waiting",
  "unread",
  "running",
  "unknown",
  "failed",
  "read",
  "idle",
];

/** Panel tab id: every session, or one projected status. */
export type OverviewFilter = "all" | OverviewStatus;

/** One session as the panel lists it: where it lives plus its projection. */
export interface OverviewRow {
  backend: BackendId;
  session: SessionSummary;
  status: OverviewStatus;
  /** Queued asks for this session (0 = none). */
  pending: number;
  /** Epoch ms of the most relevant observed activity, used for sorting. */
  activityAt: number;
}

/** The two text blocks the summary shows for one session. */
export interface OverviewSummary {
  /** The session's last prompt with actual text. */
  prompt: string;
  /** Its last assistant reply with actual text. */
  reply: string;
}

/**
 * Last prompt and last reply of a conversation. Tool-call-only assistant rows
 * carry no text and are skipped, so the summary never shows an empty bubble
 * where the agent only ran tools. Takes the structural minimum so a deep-readonly
 * store row and a freshly fetched message both fit.
 */
export function summarizeMessages(
  messages: readonly { role: "user" | "assistant"; text: string }[],
): OverviewSummary {
  let prompt = "";
  let reply = "";
  for (const message of messages) {
    if (!message.text.trim()) continue;
    if (message.role === "user") prompt = message.text;
    else reply = message.text;
  }
  return { prompt, reply };
}

/** The facts a status is projected from; everything absent means "no evidence". */
export interface OverviewEvidence {
  /** A live interaction request is queued for this session. */
  waiting: boolean;
  /** A run is in flight, visible or parked in another backend's slot. */
  running: boolean;
  /** The last settled result awefork recorded or recovered, if any. */
  result: OverviewReadEntry | null;
  /** A run was observed but its ending never confirmed (timeout, disconnect). */
  unknown: boolean;
}

/**
 * Project one session's status. Precedence follows the design: an ask blocks
 * the run, a live run outranks an old result, an unseen result outranks a lost
 * connection, and only a recorded ending can claim "unread"/"failed". A
 * session with no evidence at all is "idle" — not "unread" and not "unknown",
 * because nothing was ever observed to lose.
 *
 * Seen and unseen results differ only in what they ask of the user: an unseen
 * result is 新结果 (or 失败 for an errored run), a seen one is 已查看. A failure
 * the user already looked at is history, not a badge that stays lit forever.
 */
export function projectOverviewStatus(evidence: OverviewEvidence): OverviewStatus {
  if (evidence.waiting) return "waiting";
  if (evidence.running) return "running";
  const result = evidence.result;
  if (result) {
    const unseen = result.seen < result.revision;
    if (unseen) return result.failed ? "failed" : "unread";
    // A result the user already saw is history. A run awefork then lost track
    // of is the newer fact, so it reads as unknown rather than as "seen".
    return evidence.unknown ? "unknown" : "read";
  }
  return evidence.unknown ? "unknown" : "idle";
}

/** Sort rank of a status; unknown ids sink to the end rather than throw. */
export function overviewStatusRank(status: OverviewStatus): number {
  const rank = OVERVIEW_STATUS_ORDER.indexOf(status);
  return rank >= 0 ? rank : OVERVIEW_STATUS_ORDER.length;
}

/** Status first (what needs the user), then the most recent activity. */
export function compareOverviewRows(a: OverviewRow, b: OverviewRow): number {
  const rank = overviewStatusRank(a.status) - overviewStatusRank(b.status);
  if (rank !== 0) return rank;
  return b.activityAt - a.activityAt;
}

/** The project name shown per row: the directory's last segment. */
export function projectOf(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return name || directory;
}

/**
 * First-version search: title, project path and agent name. Body search stays
 * in the sidebar's enhanced search — the overview must not scan every session.
 */
export function matchesOverviewQuery(row: OverviewRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [
    row.session.title,
    row.session.directory,
    projectOf(row.session.directory),
    BACKEND_LABELS[row.backend],
    row.backend,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

/** True when the row belongs to the active status tab. */
export function matchesOverviewFilter(row: OverviewRow, filter: OverviewFilter): boolean {
  return filter === "all" || row.status === filter;
}

/** True when the row belongs to the selected agent (or every agent). */
export function matchesOverviewAgent(row: OverviewRow, agent: "all" | BackendId): boolean {
  return agent === "all" || row.backend === agent;
}

/** Per-status counts for the panel's tabs and the trigger's stats. */
export function overviewCounts(rows: readonly OverviewRow[]): Record<OverviewStatus, number> {
  const counts: Record<OverviewStatus, number> = {
    waiting: 0,
    unread: 0,
    running: 0,
    unknown: 0,
    failed: 0,
    read: 0,
    idle: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
