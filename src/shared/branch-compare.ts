import { chainToTip, type TurnGraph, type TurnNode } from "./canvas-graph.js";

/**
 * Alignment plan for the dual-pane branch comparison (issue #12).
 *
 * Both branches are described by their story paths — `chainToTip` from each
 * session's last node walks the graph's fork/sequence edges back to the story
 * root, so the two chains already agree node-for-node on the shared trunk
 * (inherited copies are trimmed from the graph; the fork edge lands directly
 * on the parent's anchor card). The deepest node both chains share is the
 * fork point; everything after it is the divergence the comparison shows.
 *
 * This covers every shape for free: parent vs child, siblings off one anchor,
 * cousins through intermediate branches (the upstream turns then appear
 * inside a side's list, attributed to their own session), and empty-context
 * forks (their fork edge hangs off the same anchor card).
 */

export interface ComparePlan {
  /** Deepest node both branches share — the 分叉点 card. */
  anchor: TurnNode;
  /** The shared story path root-first, anchor included — the collapsible band. */
  common: TurnNode[];
  /** The divergent path toward the left branch, anchor excluded, stubs dropped. */
  left: TurnNode[];
  /** The divergent path toward the right branch, anchor excluded, stubs dropped. */
  right: TurnNode[];
}

/**
 * Build the comparison plan for two sessions on one canvas. Returns null when
 * a comparison makes no sense: same session twice, a session with no rendered
 * nodes, or two different stories (their chains never meet).
 */
export function buildComparePlan(graph: TurnGraph, idA: string, idB: string): ComparePlan | null {
  if (idA === idB) return null;
  const tipOf = (sessionId: string): TurnNode | null => {
    let tip: TurnNode | null = null;
    for (const node of graph.nodes) {
      if (node.sessionId === sessionId) tip = node;
    }
    return tip;
  };
  const tipA = tipOf(idA);
  const tipB = tipOf(idB);
  if (!tipA || !tipB) return null;

  const chainA = chainToTip(graph, tipA.id);
  const chainB = chainToTip(graph, tipB.id);
  let shared = 0;
  while (
    shared < chainA.length &&
    shared < chainB.length &&
    chainA[shared]?.id === chainB[shared]?.id
  ) {
    shared += 1;
  }
  // Chains that never meet are two different stories on the canvas.
  if (shared === 0) return null;
  const anchor = chainA[shared - 1];
  if (!anchor) return null;

  const divergent = (chain: TurnNode[]): TurnNode[] =>
    chain.slice(shared).filter((node) => node.kind === "turn");

  return {
    anchor,
    common: chainA.slice(0, shared),
    left: divergent(chainA),
    right: divergent(chainB),
  };
}
