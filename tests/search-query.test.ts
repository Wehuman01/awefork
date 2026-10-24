import { describe, expect, it } from "vitest";
import {
  bodySearchTerms,
  firstMatchRange,
  gatesOk,
  type LocalMatchContext,
  localTextMatched,
  parseSearchQuery,
  type ScopeSet,
} from "../src/shared/search-query";

const ALL_SCOPES: ScopeSet = { title: true, tag: true, body: true };
const LOCAL_ONLY: ScopeSet = { title: true, tag: true, body: false };

const ctx = (overrides: Partial<LocalMatchContext> = {}): LocalMatchContext => ({
  title: "Login retry logic",
  tags: ["bug", "perf"],
  directory: "/Users/peng/Desktop/Project/wehuman/awefork",
  pinned: false,
  fork: false,
  running: false,
  ...overrides,
});

describe("parseSearchQuery", () => {
  it("parses empty input into a match-everything query", () => {
    const parsed = parseSearchQuery("   ");
    expect(parsed.includes).toEqual([]);
    expect(parsed.excludes).toEqual([]);
    expect(parsed.flags.size).toBe(0);
  });

  it("collects plain terms and lowercases them", () => {
    const parsed = parseSearchQuery("Retry retry");
    expect(parsed.includes).toEqual([
      { text: "retry", scope: null },
      { text: "retry", scope: null },
    ]);
  });

  it("keeps spaces inside quoted phrases", () => {
    const parsed = parseSearchQuery('"error handling" tail');
    expect(parsed.includes).toEqual([
      { text: "error handling", scope: null },
      { text: "tail", scope: null },
    ]);
  });

  it("supports #tag and the prefix scopes", () => {
    const parsed = parseSearchQuery("#Bug body:timeout title:login dir:awefork");
    expect(parsed.includes).toEqual([
      { text: "bug", scope: "tag" },
      { text: "timeout", scope: "body" },
      { text: "login", scope: "title" },
      { text: "awefork", scope: "dir" },
    ]);
  });

  it("reads phrases after a scope prefix", () => {
    const parsed = parseSearchQuery('body:"429 too many"');
    expect(parsed.includes).toEqual([{ text: "429 too many", scope: "body" }]);
  });

  it("collects negated tokens as excludes, quoted or bare", () => {
    const parsed = parseSearchQuery('retry -login -"exact exclude"');
    expect(parsed.includes).toEqual([{ text: "retry", scope: null }]);
    expect(parsed.excludes).toEqual(["login", "exact exclude"]);
  });

  it("maps is: aliases to flags", () => {
    const parsed = parseSearchQuery("is:pinned is:fork is:running");
    expect([...parsed.flags].sort()).toEqual(["fork", "pinned", "running"]);
  });

  it("degrades an unknown is: token into a plain term", () => {
    const parsed = parseSearchQuery("is:mistake");
    expect(parsed.flags.size).toBe(0);
    expect(parsed.includes).toEqual([{ text: "mistake", scope: null }]);
  });

  it("treats an unbalanced quote as an open phrase", () => {
    const parsed = parseSearchQuery('"still open');
    expect(parsed.includes).toEqual([{ text: "still open", scope: null }]);
  });

  it("drops stray punctuation-only tokens instead of matching them", () => {
    for (const stray of ["-", '"', "#", "body:", "is:"]) {
      const parsed = parseSearchQuery(stray);
      expect(parsed.includes, stray).toEqual([]);
      expect(parsed.excludes, stray).toEqual([]);
      expect(parsed.flags.size, stray).toBe(0);
    }
  });

  it("applies a prefix across whitespace and full-width colons", () => {
    // "body: run" — the space after the colon must not drop the scope.
    expect(parseSearchQuery("body: run").includes).toEqual([{ text: "run", scope: "body" }]);
    // CJK keyboards emit full-width colons.
    expect(parseSearchQuery("body:timeout").includes).toEqual([{ text: "timeout", scope: "body" }]);
    expect(parseSearchQuery("is:pinned").flags.has("pinned")).toBe(true);
    expect(parseSearchQuery("# perf").includes).toEqual([{ text: "perf", scope: "tag" }]);
  });
});

describe("gatesOk", () => {
  it("rejects a session missing any required flag", () => {
    const parsed = parseSearchQuery("is:pinned");
    expect(gatesOk(parsed, ctx({ pinned: true }))).toBe(true);
    expect(gatesOk(parsed, ctx())).toBe(false);
  });

  it("matches dir-scoped terms against the directory path", () => {
    expect(gatesOk(parseSearchQuery("dir:awefork"), ctx())).toBe(true);
    expect(gatesOk(parseSearchQuery("dir:elsewhere"), ctx())).toBe(false);
  });

  it("never gates a plain term on the directory path", () => {
    // The regression: unscoped terms leaked into the dir gate, so any query
    // word absent from every directory path ("awesh", multi-word terms) hid
    // all sessions — and words that happened to sit in a path ("awes" inside
    // …/awesome/…) passed only that directory's sessions.
    expect(gatesOk(parseSearchQuery("awesh"), ctx())).toBe(true);
    expect(gatesOk(parseSearchQuery("login"), ctx())).toBe(true);
    expect(gatesOk(parseSearchQuery("awes dir:awefork"), ctx())).toBe(true);
    expect(gatesOk(parseSearchQuery("awes dir:elsewhere"), ctx())).toBe(false);
  });

  it("vetoes the session when an exclude hits title, tags, or directory", () => {
    expect(gatesOk(parseSearchQuery("-login"), ctx())).toBe(false);
    expect(gatesOk(parseSearchQuery("-bug"), ctx())).toBe(false);
    expect(gatesOk(parseSearchQuery("-/elsewhere/"), ctx())).toBe(true);
  });
});

describe("localTextMatched", () => {
  it("matches unscoped terms across title and tags", () => {
    const parsed = parseSearchQuery("retry");
    expect(localTextMatched(parsed, ctx(), ALL_SCOPES)).toBe(true);
    expect(localTextMatched(parsed, ctx({ title: "other" }), ALL_SCOPES)).toBe(false);
  });

  it("requires every unscoped term inside ONE scope", () => {
    // retry is in the title, bug is a tag — no single local scope has both.
    expect(localTextMatched(parseSearchQuery("retry bug"), ctx(), ALL_SCOPES)).toBe(false);
    expect(localTextMatched(parseSearchQuery("login retry"), ctx(), ALL_SCOPES)).toBe(true);
  });

  it("honors scope pinning", () => {
    expect(localTextMatched(parseSearchQuery("title:bug"), ctx(), ALL_SCOPES)).toBe(false);
    expect(localTextMatched(parseSearchQuery("tag:bug"), ctx(), ALL_SCOPES)).toBe(true);
  });

  it("never counts a scope that owes no terms", () => {
    // Only title:login exists; tags owe nothing and must not satisfy the query.
    expect(localTextMatched(parseSearchQuery("title:login"), ctx(), ALL_SCOPES)).toBe(true);
    expect(localTextMatched(parseSearchQuery("title:timeout"), ctx(), ALL_SCOPES)).toBe(false);
  });

  it("matches everything when there are no include terms", () => {
    expect(localTextMatched(parseSearchQuery("is:fork"), ctx(), LOCAL_ONLY)).toBe(true);
  });

  it("skips disabled scopes", () => {
    const parsed = parseSearchQuery("retry");
    expect(localTextMatched(parsed, ctx(), { title: false, tag: true, body: false })).toBe(false);
  });
});

describe("bodySearchTerms", () => {
  it("merges unscoped and body-scoped terms", () => {
    expect(bodySearchTerms(parseSearchQuery("body:timeout retry title:login"))).toEqual([
      "timeout",
      "retry",
    ]);
  });

  it("returns null when the body owes nothing", () => {
    expect(bodySearchTerms(parseSearchQuery("title:login is:fork"))).toBeNull();
    expect(bodySearchTerms(parseSearchQuery(""))).toBeNull();
  });
});

describe("firstMatchRange", () => {
  it("finds the earliest term occurrence", () => {
    expect(firstMatchRange("Login retry logic", ["retry", "login"])).toEqual({
      start: 0,
      length: 5,
    });
  });

  it("is case-insensitive and null without a hit", () => {
    expect(firstMatchRange("Retry logic", ["retry"])).toEqual({ start: 0, length: 5 });
    expect(firstMatchRange("abc", ["zzz"])).toBeNull();
  });
});
