/**
 * Query grammar for the sidebar's enhanced session search.
 *
 * One input box, tokenized into structured pieces so the sidebar can match
 * some surfaces locally (title / tags / directory) and hand the rest to the
 * main-process body scan. Tokens:
 *
 *   词             plain term — matched against every enabled scope
 *   "精确短语"     quoted term — same as a term, spaces allowed
 *   body:词        scoped term — only the session body must contain it
 *   title:词 / tag:词 / dir:词 / #标签   other scopes
 *   -词 / -"短语"  exclusion — vetoes the session when found on any surface
 *   is:收藏 / is:fork / is:运行中        state flag the session must carry
 *
 * Semantics (kept narrow on purpose, so the two matchers can't drift):
 *   gates     flags + dir-scoped terms + exclusions apply to the session as
 *             a whole; a gate failure hides it everywhere.
 *   matching  when include terms exist, at least ONE enabled scope must
 *             contain every term it owes (its own scoped terms plus the
 *             unscoped ones). A scope that owes no terms never counts as a
 *             match — `title:登录` alone cannot be satisfied by tags.
 *             With no include terms at all the query is a pure filter.
 */

/** Surfaces a term can be pinned to. `dir` is gate-only, never a match scope. */
export type SearchScope = "title" | "tag" | "body" | "dir";

/** `is:` state flags; every parsed flag is required. */
export type SearchFlag = "pinned" | "fork" | "running";

export interface ScopedTerm {
  /** Lowercased match text — a word, or a quoted phrase with spaces. */
  text: string;
  /** null = try every enabled scope; otherwise only this scope. */
  scope: SearchScope | null;
}

export interface ParsedSearchQuery {
  includes: ScopedTerm[];
  /** Lowercased substrings that veto a session when found on any surface. */
  excludes: string[];
  flags: Set<SearchFlag>;
}

/** Which surfaces the plain (unscoped) terms search — the ✦ panel's checkboxes. */
export interface ScopeSet {
  title: boolean;
  tag: boolean;
  body: boolean;
}

/** The local surfaces the sidebar matches without a body scan. */
export interface LocalMatchContext {
  title: string;
  tags: string[];
  directory: string;
  pinned: boolean;
  fork: boolean;
  running: boolean;
}

const FLAG_ALIASES: Record<string, SearchFlag> = {
  pinned: "pinned",
  pin: "pinned",
  star: "pinned",
  收藏: "pinned",
  星标: "pinned",
  fork: "fork",
  running: "running",
  run: "running",
  运行中: "running",
};

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const query: ParsedSearchQuery = { includes: [], excludes: [], flags: new Set() };
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i] ?? "")) i++;
    if (i >= input.length) break;

    let negate = false;
    if (input[i] === "-" && i + 1 < input.length && !/\s/.test(input[i + 1] ?? "")) {
      negate = true;
      i++;
    }

    let scope: SearchScope | null = null;
    let flagToken = false;
    if (input[i] === "#") {
      scope = "tag";
      i++;
      while (i < input.length && /\s/.test(input[i] ?? "")) i++;
    } else {
      const rest = input.slice(i);
      // Full-width colon accepted — CJK keyboards emit ： constantly.
      const prefix = /^(body|title|tag|dir)[:：]/i.exec(rest);
      if (prefix) {
        scope = (prefix[1] ?? "").toLowerCase() as SearchScope;
        i += prefix[0].length;
      } else if (/^is[:：]/i.test(rest)) {
        flagToken = !negate;
        i += 3;
      }
      // "body: 演" — whitespace after a prefix still applies it to the next
      // token; a truly dangling prefix just fades away.
      while (i < input.length && /\s/.test(input[i] ?? "")) i++;
    }

    const token = readToken(input, i);
    i = token.end;
    if (token.text.length === 0) continue;
    // A lone "-" is a stray dash, not a term that hides almost everything.
    if (!negate && token.text === "-") continue;
    const text = token.text.toLowerCase();

    if (negate) {
      query.excludes.push(text);
    } else if (flagToken) {
      const flag = FLAG_ALIASES[text];
      if (flag) query.flags.add(flag);
      // An unknown is:x still searches as a plain term — a typo degrades
      // into a search instead of silently matching everything.
      else query.includes.push({ text, scope: null });
    } else {
      query.includes.push({ text, scope });
    }
  }
  return query;
}

/** Read one token from `start`: a quoted run, or text up to whitespace. */
function readToken(input: string, start: number): { text: string; end: number } {
  if (input[start] === '"') {
    const close = input.indexOf('"', start + 1);
    if (close === -1) return { text: input.slice(start + 1), end: input.length };
    return { text: input.slice(start + 1, close), end: close + 1 };
  }
  let end = start;
  while (end < input.length && !/\s/.test(input[end] ?? "")) end++;
  return { text: input.slice(start, end), end };
}

/** Every include term `scope` must supply: its own scoped ones plus unscoped. */
function termsOwed(includes: ScopedTerm[], scope: SearchScope): string[] {
  return includes.filter((t) => t.scope === null || t.scope === scope).map((t) => t.text);
}

/** True when every term appears in the text (case-insensitive substring). */
export function textHasAll(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Session-wide gates: flags, dir-scoped terms, and exclusions over the local
 * surface (title + tags + directory). A gate failure hides the session no
 * matter which scope matched — body-scan exclusions apply the same rule and
 * are merged in by the caller.
 */
export function gatesOk(parsed: ParsedSearchQuery, ctx: LocalMatchContext): boolean {
  for (const flag of parsed.flags) {
    if (!ctx[flag]) return false;
  }
  const dirTerms = termsOwed(parsed.includes, "dir");
  if (dirTerms.length > 0 && !textHasAll(ctx.directory, dirTerms)) return false;
  if (parsed.excludes.length > 0) {
    const surface = `${ctx.title}\n${ctx.tags.join("\n")}\n${ctx.directory}`;
    if (parsed.excludes.some((term) => surface.toLowerCase().includes(term))) return false;
  }
  return true;
}

/**
 * Do the LOCAL scopes (title, tags) satisfy the query on their own? A scope
 * counts only when it owes at least one term and contains them all. Body
 * satisfaction comes from the main-process scan; the caller ORs it in.
 */
export function localTextMatched(
  parsed: ParsedSearchQuery,
  ctx: LocalMatchContext,
  scopes: ScopeSet,
): boolean {
  if (parsed.includes.length === 0) return true;
  if (scopes.title) {
    const owed = termsOwed(parsed.includes, "title");
    if (owed.length > 0 && textHasAll(ctx.title, owed)) return true;
  }
  if (scopes.tag) {
    const owed = termsOwed(parsed.includes, "tag");
    if (owed.length > 0 && textHasAll(ctx.tags.join("\n"), owed)) return true;
  }
  return false;
}

/**
 * The term list the main-process body scan needs: unscoped terms plus
 * body-scoped ones, pre-lowercased. Null when the body can't match anything
 * (nothing owed to it) and a scan would be wasted work.
 */
export function bodySearchTerms(parsed: ParsedSearchQuery): string[] | null {
  const owed = termsOwed(parsed.includes, "body");
  return owed.length > 0 ? owed : null;
}

/** Earliest case-insensitive occurrence of any term — for title highlighting. */
export function firstMatchRange(
  text: string,
  terms: string[],
): { start: number; length: number } | null {
  const haystack = text.toLowerCase();
  let best: { start: number; length: number } | null = null;
  for (const term of terms) {
    const index = haystack.indexOf(term);
    if (index !== -1 && (best === null || index < best.start)) {
      best = { start: index, length: term.length };
    }
  }
  return best;
}
