/**
 * Main-process session-body search behind the sidebar's ✦ enhanced search.
 *
 * The renderer sends the sessions to scan (with their updatedAt, so cached
 * bodies can be reused) plus the pre-lowered terms and exclusions the query
 * owes to the body scope. Scanning fetches each session's messages through
 * its backend adapter — no raw storage files, so every backend's layout and
 * auth homes keep working untouched. Message text and tool names form the
 * searchable surface; reasoning parts are skipped (huge, and snippets from
 * them read like noise).
 *
 * A session body-matches when every term appears somewhere in it and no
 * exclusion does. Sessions whose body contains an exclusion come back in
 * `excludedSessionIds`: exclusions veto the whole session (title hits too),
 * so the renderer must know about them even though they carry no hits.
 */

import type {
  BodySearchHit,
  BodySearchRequest,
  BodySearchResult,
  SessionSearchTarget,
} from "../shared/awefork-api.js";
import { snippetAround } from "../shared/turn-search.js";
import type { AgentAdapter, ChatMessage } from "../shared/types.js";

/** Sessions scanned per search — the sidebar stays usable on huge projects. */
export const MAX_SEARCH_TARGETS = 300;
/** Sessions that may report hits; later matches only count toward `scanned`. */
export const MAX_HIT_SESSIONS = 60;
/** Snippet rows shown per matched session. */
export const MAX_HITS_PER_SESSION = 2;
/** Cached sessions kept per backend; over the cap the cache resets wholesale. */
const MAX_CACHE_SESSIONS = 800;
/** Concurrent adapter message fetches while scanning. */
const FETCH_POOL = 8;

/** One cached searchable message row. */
interface BodyRow {
  id: string;
  text: string;
  /** Tool names joined into one searchable line ("" when none). */
  tools: string;
  /** `text` and `tools` joined — the surface terms are matched against. */
  searchable: string;
}

interface CachedSession {
  updatedAt: number;
  rows: BodyRow[];
}

export interface MessageSearcher {
  search(targets: SessionSearchTarget[], request: BodySearchRequest): Promise<BodySearchResult>;
}

function toRows(messages: ChatMessage[]): BodyRow[] {
  const rows: BodyRow[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    const tools = message.toolNames.join(" ");
    if (text.length === 0 && tools.length === 0) continue;
    rows.push({ id: message.id, text, tools, searchable: `${text}\n${tools}` });
  }
  return rows;
}

/**
 * A session body-match: the session-wide verdict plus the rows worth a
 * snippet (each contains at least one term). All comparisons are case
 * insensitive — the query terms arrive lowercased, but session bodies
 * preserve their original casing, so naive `String#includes` would miss
 * any uppercase occurrence.
 */
function matchSession(
  rows: BodyRow[],
  request: BodySearchRequest,
): { matched: boolean; excluded: boolean; snippetRows: BodyRow[] } {
  const joinedLowered = rows.map((row) => row.searchable.toLowerCase()).join("\n");
  if (request.excludes.some((term) => joinedLowered.includes(term))) {
    return { matched: false, excluded: true, snippetRows: [] };
  }
  // AND across the whole body: terms may sit in different messages.
  if (!request.terms.every((term) => joinedLowered.includes(term))) {
    return { matched: false, excluded: false, snippetRows: [] };
  }
  const snippetRows: BodyRow[] = [];
  for (const row of rows) {
    const rowLowered = row.searchable.toLowerCase();
    if (request.terms.some((term) => rowLowered.includes(term))) {
      snippetRows.push(row);
      if (snippetRows.length >= MAX_HITS_PER_SESSION) break;
    }
  }
  return { matched: true, excluded: false, snippetRows };
}

function hitForRow(sessionId: string, row: BodyRow, request: BodySearchRequest): BodySearchHit {
  // Snippet from the prose text when it matched there; tool line otherwise.
  // The chosen source is then lowercased for the index lookup, so the offset
  // feeds snippetAround the original-case string in a position-correct way.
  const textLowered = row.text.toLowerCase();
  const fromText = request.terms.some((term) => textLowered.includes(term));
  const source = fromText ? row.text : row.tools;
  const sourceLowered = fromText ? textLowered : row.tools.toLowerCase();
  let best: { index: number; length: number } | null = null;
  for (const term of request.terms) {
    const index = sourceLowered.indexOf(term);
    if (index !== -1 && (best === null || index < best.index)) {
      best = { index, length: term.length };
    }
  }
  // matchSession only feeds rows that contain a term, so best always exists.
  const { snippet, matchStart } = snippetAround(source, best?.index ?? 0, best?.length ?? 0);
  return {
    sessionId,
    messageId: row.id,
    snippet,
    matchStart,
    matchLength: best?.length ?? 0,
  };
}

export function createMessageSearcher(
  resolveAdapter: () => Promise<AgentAdapter>,
): MessageSearcher {
  const cache = new Map<string, CachedSession>();

  const rowsFor = async (
    adapter: AgentAdapter,
    target: SessionSearchTarget,
  ): Promise<BodyRow[] | null> => {
    const cached = cache.get(target.id);
    if (cached && cached.updatedAt === target.updatedAt) return cached.rows;
    try {
      const rows = toRows(await adapter.messages(target.id));
      if (cache.size >= MAX_CACHE_SESSIONS) cache.clear();
      cache.set(target.id, { updatedAt: target.updatedAt, rows });
      return rows;
    } catch {
      // One unreadable session (deleted mid-scan, backend hiccup) must not
      // fail the search — it just reports as unscanned.
      return null;
    }
  };

  return {
    async search(targets, request) {
      if (request.terms.length === 0 && request.excludes.length === 0) {
        return { hits: [], excludedSessionIds: [], scanned: 0 };
      }
      const adapter = await resolveAdapter();
      const capped = targets
        .filter((target) => typeof target?.id === "string")
        .slice(0, MAX_SEARCH_TARGETS);

      // Pool the fetches: a sequential scan pays full latency per session.
      let cursor = 0;
      const bodies = new Array<BodyRow[] | null>(capped.length);
      const workers = Array.from({ length: Math.min(FETCH_POOL, capped.length) }, async () => {
        while (cursor < capped.length) {
          const index = cursor++;
          const target = capped[index];
          if (target === undefined) continue;
          bodies[index] = await rowsFor(adapter, target);
        }
      });
      await Promise.all(workers);

      const hits: BodySearchHit[] = [];
      const excludedSessionIds: string[] = [];
      let scanned = 0;
      let hitSessions = 0;
      for (let index = 0; index < capped.length; index++) {
        const rows = bodies[index] ?? null;
        const target = capped[index];
        if (rows === null || target === undefined) continue;
        scanned++;
        // Exclusions run even past the hit cap — they veto sessions globally.
        const verdict = matchSession(rows, request);
        if (verdict.excluded) {
          excludedSessionIds.push(target.id);
          continue;
        }
        if (!verdict.matched || hitSessions >= MAX_HIT_SESSIONS) continue;
        hitSessions++;
        for (const row of verdict.snippetRows) {
          hits.push(hitForRow(target.id, row, request));
        }
      }
      return { hits, excludedSessionIds, scanned };
    },
  };
}
