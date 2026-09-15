/**
 * One-line digests of every branch on the canvas.
 *
 * A "branch" is a session with nodes in the turn graph: the story root plus
 * each fork. The digest answers "what grew here and where did it split off"
 * without walking the canvas — turn count, tokens, latest activity, and the
 * fork point (parent session + the turn it forked after). `jumpNodeId` lands
 * selection on the branch's latest node, stubs included.
 */

import type { TurnGraph, TurnNode } from "./canvas-graph.js";
import type { LineageMap, SessionSummary } from "./types.js";

export interface BranchDigest {
  sessionId: string;
  title: string;
  /** Where this branch forked from; null for story roots. */
  forkedFrom: { sessionId: string; sessionTitle: string; turnTitle: string } | null;
  /**
   * 1-based attempt among the forks that split off the same turn carrying the
   * same first prompt — the retry-as-fork family. null when the branch is
   * alone (no retries happened), so UIs only label actual repeats.
   */
  attempt: number | null;
  /** Turns the branch itself added (inherited turns belong to the parent). */
  turnCount: number;
  outputTokens: number;
  /** Latest own turn's title; "" when the branch is still an empty stub. */
  lastTurnTitle: string;
  lastActivityAt: number;
  hasError: boolean;
  /** The branch's last own turn node, else its stub; null when neither renders. */
  jumpNodeId: string | null;
}

export function buildBranchDigests(
  graph: TurnGraph,
  sessions: SessionSummary[],
  lineage: LineageMap,
): BranchDigest[] {
  const nodesBySession = new Map<string, TurnNode[]>();
  for (const node of graph.nodes) {
    const list = nodesBySession.get(node.sessionId);
    if (list) list.push(node);
    else nodesBySession.set(node.sessionId, [node]);
  }
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const entries: { createdAt: number; digest: BranchDigest }[] = [];
  for (const [sessionId, nodes] of nodesBySession) {
    const session = sessionById.get(sessionId);
    if (!session) continue;
    const turns = nodes.filter((n) => n.kind === "turn");
    const last = turns[turns.length - 1] ?? null;
    const stub = nodes.find((n) => n.kind === "stub") ?? null;

    const record = lineage[sessionId];
    const parent = record ? sessionById.get(record.parentId) : undefined;
    let forkedFrom: BranchDigest["forkedFrom"] = null;
    if (record && parent) {
      forkedFrom = {
        sessionId: parent.id,
        sessionTitle: parent.title,
        turnTitle: forkPointTitle(graph, record.parentId, record.atMessageId),
      };
    }

    entries.push({
      createdAt: session.createdAt,
      digest: {
        sessionId,
        title: session.title,
        forkedFrom,
        attempt: null,
        turnCount: turns.length,
        outputTokens: turns.reduce((sum, n) => sum + n.outputTokens, 0),
        lastTurnTitle: last?.title ?? "",
        lastActivityAt: last?.createdAt ?? session.updatedAt,
        hasError: nodes.some((n) => n.error !== null),
        jumpNodeId: last?.id ?? stub?.id ?? null,
      },
    });
  }

  numberRetryAttempts(entries, lineage, nodesBySession);

  // Story order: a parent is always created before its forks, so creation
  // time keeps roots ahead of the branches that split off them.
  return entries
    .sort(
      (a, b) => a.createdAt - b.createdAt || a.digest.sessionId.localeCompare(b.digest.sessionId),
    )
    .map((entry) => entry.digest);
}

/** Title of the parent node a fork grew from: the recorded turn, else the parent's last node. */
function forkPointTitle(graph: TurnGraph, parentId: string, atMessageId: string | null): string {
  const parentNodes = graph.nodes
    .filter((n) => n.sessionId === parentId)
    .sort((a, b) => a.col - b.col);
  const forkNode = atMessageId
    ? parentNodes.find((n) => n.messageId === atMessageId)
    : parentNodes[parentNodes.length - 1];
  return forkNode?.title ?? "";
}

/**
 * Label retry families: forks off the same turn whose first own turn repeats
 * the same prompt are attempts of one another (a retried turn grows the retry
 * as a new fork). Deliberate parallel branches — different prompts off the
 * same fork point — never join a family, so they stay unlabeled.
 */
function numberRetryAttempts(
  entries: Array<{ createdAt: number; digest: BranchDigest }>,
  lineage: LineageMap,
  nodesBySession: Map<string, TurnNode[]>,
): void {
  const firstTurnTitle = (sessionId: string): string => {
    let first: TurnNode | undefined;
    for (const node of nodesBySession.get(sessionId) ?? []) {
      if (node.kind !== "turn") continue;
      if (!first || node.col < first.col) first = node;
    }
    return first?.title ?? "";
  };

  const families = new Map<string, Array<{ createdAt: number; digest: BranchDigest }>>();
  for (const entry of entries) {
    const record = lineage[entry.digest.sessionId];
    if (!record || !entry.digest.forkedFrom) continue;
    const key = `${record.parentId}\u0000${record.atMessageId ?? ""}\u0000${firstTurnTitle(entry.digest.sessionId)}`;
    const family = families.get(key);
    if (family) family.push(entry);
    else families.set(key, [entry]);
  }
  for (const family of families.values()) {
    if (family.length < 2) continue;
    const ordered = [...family].sort(
      (a, b) => a.createdAt - b.createdAt || a.digest.sessionId.localeCompare(b.digest.sessionId),
    );
    ordered.forEach((member, index) => {
      member.digest.attempt = index + 1;
    });
  }
}
