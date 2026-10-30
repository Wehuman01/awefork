/**
 * Canvas scope: decide which sessions belong on the canvas.
 *
 * Rule: the canvas shows the story you are looking at — the selected
 * session's whole fork tree, found by walking up to the top of its story
 * first, so a fresh fork keeps the source line and its sibling branches
 * visible. Everything else, starred or not, stays in the sidebar index —
 * the canvas is a workbench, not the archive; stars are bookmarks.
 */

import type { LineageMap, SessionSummary } from "./types.js";

/**
 * The story root a session belongs to: walk parents (awefork lineage first,
 * agent parentage as fallback) until the chain leaves the known set. The same
 * walk selectCanvasSessions uses to keep whole stories together — exported so
 * canvas tabs can dedupe on it: one story, one tab.
 *
 * Two sources of parentage, two rules. A lineage link is awefork's own
 * durable record — it stays true no matter what a listing dropped, so the
 * walk follows it even when the parent's row is missing (a partial listing
 * must not tear a story apart: the tab strip dedupes on this root, and a
 * re-root over a gap is how one story becomes several tabs). A row's own
 * parentSessionId is only as good as the listing that carried it: when that
 * row's parent is missing, the chain genuinely stops there — the agent
 * itself said the parent is gone.
 */
export function storyRootOf(
  sessions: SessionSummary[],
  lineage: LineageMap,
  sessionId: string | null,
): string | null {
  if (!sessionId) return null;
  const byId = new Map(sessions.map((s) => [s.id, s]));
  if (!byId.has(sessionId)) return null;
  let rootId = sessionId;
  const walked = new Set([rootId]);
  for (;;) {
    const viaLineage = lineage[rootId]?.parentId;
    const parent = viaLineage ?? byId.get(rootId)?.parentSessionId;
    // A lineage link crosses a listing gap (it is true regardless); a row
    // link does not (the parent is only known through the listing).
    if (!parent || walked.has(parent)) break;
    if (!viaLineage && !byId.has(parent)) break;
    walked.add(parent);
    rootId = parent;
  }
  return rootId;
}

export function selectCanvasSessions(
  sessions: SessionSummary[],
  lineage: LineageMap,
  selectedId: string | null,
): SessionSummary[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));

  if (!selectedId || !byId.has(selectedId)) return [];

  const childrenOf = new Map<string, string[]>();
  for (const session of sessions) {
    const parent = lineage[session.id]?.parentId ?? session.parentSessionId;
    // A lineage link may name a parent whose row this listing dropped: the
    // child still belongs under it (the walk below can land on such a root),
    // so record the edge even when the parent has no row of its own.
    if (parent) push(childrenOf, parent, session.id);
  }

  const keep = new Set<string>();
  const addSubtree = (rootId: string): void => {
    const queue = [rootId];
    for (let i = 0; i < queue.length; i += 1) {
      const id = queue[i];
      // The root itself may be a lineage-only parent (no row this refresh);
      // its visible descendants still form the story.
      if (!id || keep.has(id)) continue;
      keep.add(id);
      for (const child of childrenOf.get(id) ?? []) queue.push(child);
    }
  };

  // Whole story, not just the branch below the selection: walk up to the
  // story's root, then keep its entire fork tree (siblings included). Same
  // two-rule parentage as storyRootOf: a lineage link crosses a listing gap
  // (the root may carry no row this refresh), a row link does not.
  let rootId = selectedId;
  const walked = new Set([rootId]);
  for (;;) {
    const viaLineage = lineage[rootId]?.parentId;
    const parent = viaLineage ?? byId.get(rootId)?.parentSessionId;
    if (!parent || walked.has(parent)) break;
    if (!viaLineage && !byId.has(parent)) break;
    walked.add(parent);
    rootId = parent;
  }
  addSubtree(rootId);

  return sessions.filter((s) => keep.has(s.id));
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
