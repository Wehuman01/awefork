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
 *
 * Each adapter fetch costs one or two IPC round trips, so the scan is shaped
 * around them: bodies are cached pre-lowered (repeat searches only run
 * substring checks), fetches are matched as they land instead of after every
 * target has been fetched, and a scan with no exclusions stops fetching once
 * the hit quota is filled. Exclusion-bearing scans must visit every target —
 * a veto is only knowable from the body itself.
 */

import type {
  BodySearchHit,
  BodySearchRequest,
  BodySearchResult,
  SessionSearchTarget,
} from "../shared/awefork-api.js";
import { snippetAround } from "../shared/turn-search.js";
import type { AgentAdapter, ChatMessage } from "../shared/types.js";

/** Hard safety cap for the main-process scan, only hit when the renderer
 * explicitly asks for "all". The UI default is 1000; raise this only if the
 * renderer lets users pick a larger number. */
export const MAX_SEARCH_TARGETS = 5000;
/** Sessions that may report hits; later matches only count toward `scanned`. */
export const MAX_HIT_SESSIONS = 60;
/** Snippet rows shown per matched session. */
export const MAX_HITS_PER_SESSION = 2;
/** Cached sessions kept per backend; least recently used evicted first. Must
 * comfortably cover the renderer's default scan size or every keystroke
 * refetches the overflow. */
const MAX_CACHE_SESSIONS = 1200;
/** Concurrent adapter message fetches while scanning. */
export const FETCH_POOL = 8;

/** One cached searchable message row. */
interface BodyRow {
  id: string;
  text: string;
  /** Tool names joined into one searchable line ("" when none). */
  tools: string;
  /** `text` + `tools` pre-lowered at fetch time — terms run `indexOf`
   * against this, so repeat searches never re-lower whole bodies. */
  lowered: string;
}

interface CachedSession {
  updatedAt: number;
  rows: BodyRow[];
}

/** A session's scan verdict: `snippetRows` only on a match, empty otherwise. */
interface Verdict {
  matched: boolean;
  excluded: boolean;
  snippetRows: BodyRow[];
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
    rows.push({ id: message.id, text, tools, lowered: `${text}\n${tools}`.toLowerCase() });
  }
  return rows;
}

/**
 * A session body-match: the session-wide verdict plus the rows worth a
 * snippet (each contains at least one term). Terms arrive lowercased and
 * rows are cached pre-lowered, so every comparison here is a plain
 * case-insensitive `includes`/`indexOf`.
 */

/** rows array → its joined lowered body. Rows identities persist in the
 *  session cache, so repeat searches (every keystroke) skip the join. */
const joinedLoweredOf = (() => {
  const cache = new WeakMap<readonly BodyRow[], string>();
  return (rows: readonly BodyRow[]): string => {
    let joined = cache.get(rows);
    if (joined === undefined) {
      joined = rows.map((row) => row.lowered).join("\n");
      cache.set(rows, joined);
    }
    return joined;
  };
})();

function matchSession(rows: BodyRow[], request: BodySearchRequest): Verdict {
  const joinedLowered = joinedLoweredOf(rows);
  if (request.excludes.some((term) => joinedLowered.includes(term))) {
    return { matched: false, excluded: true, snippetRows: [] };
  }
  // AND across the whole body: terms may sit in different messages.
  if (!request.terms.every((term) => joinedLowered.includes(term))) {
    return { matched: false, excluded: false, snippetRows: [] };
  }
  const snippetRows: BodyRow[] = [];
  for (const row of rows) {
    if (request.terms.some((term) => row.lowered.includes(term))) {
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
  /** Fetches in flight, keyed `id\nupdatedAt` — overlapping searches (a new
   * keystroke, the churn watcher) share them instead of double-fetching. */
  const pending = new Map<string, Promise<BodyRow[] | null>>();

  const rowsFor = (
    adapter: AgentAdapter,
    target: SessionSearchTarget,
  ): Promise<BodyRow[] | null> => {
    const cached = cache.get(target.id);
    if (cached && cached.updatedAt === target.updatedAt) {
      // Re-insert so the LRU evicts least-recently-used, not scan order.
      cache.delete(target.id);
      cache.set(target.id, cached);
      return Promise.resolve(cached.rows);
    }
    const key = `${target.id}\n${target.updatedAt}`;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const fetch = adapter
      .messages(target.id)
      .then((messages) => {
        const rows = toRows(messages);
        if (cache.size >= MAX_CACHE_SESSIONS) {
          // Evict just the oldest entry: a wholesale clear here thrashes once
          // scans outgrow the cap — every later search refetches nearly all.
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(target.id, { updatedAt: target.updatedAt, rows });
        return rows;
      })
      .catch(() => {
        // One unreadable session (deleted mid-scan, backend hiccup) must not
        // fail the search — it just reports as unscanned.
        return null;
      })
      .finally(() => pending.delete(key));
    pending.set(key, fetch);
    return fetch;
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

      // Pool the fetches and match each body the moment it lands: matching
      // after every fetch completes would hold the first result hostage to
      // the slowest session. Targets arrive most-recent-first, so tracking
      // the decided prefix lets a quota-filling scan stop fetching early —
      // with no exclusions, bodies past the 60th matched session can never
      // add a hit. Exclusion scans keep fetching everything: a veto is only
      // knowable from the body itself.
      const verdicts = new Array<Verdict | undefined>(capped.length);
      let cursor = 0;
      let frontier = 0;
      let prefixMatched = 0;
      const stopEarly = request.excludes.length === 0;
      const workers = Array.from({ length: Math.min(FETCH_POOL, capped.length) }, async () => {
        while (cursor < capped.length && !(stopEarly && prefixMatched >= MAX_HIT_SESSIONS)) {
          const index = cursor++;
          const target = capped[index];
          if (target === undefined) continue;
          const rows = await rowsFor(adapter, target);
          if (rows === null) continue;
          verdicts[index] = matchSession(rows, request);
          // Advance the decided prefix; its matched count gates the stop.
          while (verdicts[frontier] !== undefined) {
            if (verdicts[frontier]?.matched) prefixMatched++;
            frontier++;
          }
        }
      });
      await Promise.all(workers);

      // Collect in target order so the hit set is exactly the first
      // MAX_HIT_SESSIONS matched sessions in recency order, whatever the
      // fetch completion order was.
      const hits: BodySearchHit[] = [];
      const excludedSessionIds: string[] = [];
      let scanned = 0;
      let hitSessions = 0;
      for (let index = 0; index < capped.length; index++) {
        const verdict = verdicts[index];
        const target = capped[index];
        if (verdict === undefined || target === undefined) continue;
        scanned++;
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
