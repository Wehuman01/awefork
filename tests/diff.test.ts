import { describe, expect, it } from "vitest";
import { countLines, lineDiff } from "../src/shared/diff";

describe("countLines", () => {
  it("does not count a single trailing newline as a line (git numstat rule)", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    // A file of one empty line ("`\n`") is one line, not zero.
    expect(countLines("\n")).toBe(1);
    // Only ONE trailing newline folds; a trailing blank line still counts.
    expect(countLines("a\n\n")).toBe(2);
  });
});

describe("lineDiff", () => {
  it("reports nothing for identical content", () => {
    const result = lineDiff("a\nb\nc", "a\nb\nc");
    expect(result).toEqual({ added: 0, removed: 0, hunks: [] });
  });

  it("does not count a trailing newline as a line on either side", () => {
    // "a\nb\n" is 2 lines: a file grown by "c\n" reports +1, matching what
    // countLines-based created/deleted totals report for the same content.
    const result = lineDiff("a\nb\n", "a\nb\nc\n");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(lineDiff("", "a\nb\n").added).toBe(2);
    expect(lineDiff("a\nb\n", "").removed).toBe(2);
  });

  it("counts a pure addition", () => {
    const result = lineDiff("", "one\ntwo");
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.hunks).toHaveLength(1);
    const lines = result.hunks[0]?.lines ?? [];
    expect(lines.map((l) => l.type)).toEqual(["+", "+"]);
  });

  it("counts a pure removal", () => {
    const result = lineDiff("one\ntwo", "");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(2);
    expect((result.hunks[0]?.lines ?? []).map((l) => l.type)).toEqual(["-", "-"]);
  });

  it("nets a modification with context rows in the hunk", () => {
    const before = "keep1\nold\nkeep2\nkeep3";
    const after = "keep1\nnew\nkeep2\nkeep3";
    const result = lineDiff(before, after);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    const hunk = result.hunks[0];
    expect(hunk?.beforeStart).toBe(1);
    expect(hunk?.afterStart).toBe(1);
    expect(hunk?.lines.map((l) => `${l.type}${l.text}`)).toEqual([
      " keep1",
      "-old",
      "+new",
      " keep2",
      " keep3",
    ]);
  });

  it("splits hunks when unchanged runs exceed the context gap", () => {
    const before = ["a", ...Array.from({ length: 12 }, (_, i) => `x${i}`), "b"].join("\n");
    const after = ["A", ...Array.from({ length: 12 }, (_, i) => `x${i}`), "B"].join("\n");
    const result = lineDiff(before, after);
    expect(result.added).toBe(2);
    expect(result.removed).toBe(2);
    expect(result.hunks).toHaveLength(2);
  });

  it("matches a moved tail through shared prefix and suffix", () => {
    const before = "head\na\nb\ntail";
    const after = "head\nb\na\ntail";
    const result = lineDiff(before, after);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it("reports unknown instead of diffing past the LCS cap", () => {
    const big = (prefix: string): string =>
      Array.from({ length: 900 }, (_, i) => `${prefix}${i}`).join("\n");
    const result = lineDiff(big("a"), big("b"));
    expect(result.added).toBeNull();
    expect(result.removed).toBeNull();
    expect(result.hunks).toEqual([]);
  });
});
