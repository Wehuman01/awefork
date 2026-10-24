import { describe, expect, it } from "vitest";
import { type ArrivingItem, splitArrivingItems } from "../src/renderer/src/drop-split";

function arriving(name: string, isDirectory: boolean | null): ArrivingItem {
  return { file: new File([name], name), isDirectory };
}

/** The production bridge: a File's real absolute path. */
const resolvePath = (file: File): string | null => `/abs/dir/${file.name}`;

describe("splitArrivingItems", () => {
  it("keeps every file when nothing is a directory", () => {
    const result = splitArrivingItems(
      [arriving("a.txt", false), arriving("b.md", false)],
      resolvePath,
    );
    expect(result.pathText).toBe("");
    expect(result.files.map((f) => f.name)).toEqual(["a.txt", "b.md"]);
  });

  it("turns a directory into its absolute path", () => {
    const result = splitArrivingItems([arriving("src", true)], resolvePath);
    expect(result.pathText).toBe("/abs/dir/src");
    expect(result.files).toEqual([]);
  });

  it("joins several directories one per line, in order", () => {
    const result = splitArrivingItems([arriving("src", true), arriving("docs", true)], resolvePath);
    expect(result.pathText).toBe("/abs/dir/src\n/abs/dir/docs");
    expect(result.files).toEqual([]);
  });

  it("splits a mixed batch, keeping file order", () => {
    const result = splitArrivingItems(
      [arriving("a.txt", false), arriving("src", true), arriving("b.md", false)],
      resolvePath,
    );
    expect(result.pathText).toBe("/abs/dir/src");
    expect(result.files.map((f) => f.name)).toEqual(["a.txt", "b.md"]);
  });

  it("keeps a directory whose path will not resolve as a file", () => {
    // The bridge could not name it (the browser demo, a vanished target):
    // the ordinary attachment route reports it honestly instead of the
    // composer inventing a path.
    const result = splitArrivingItems([arriving("src", true)], () => null);
    expect(result.pathText).toBe("");
    expect(result.files.map((f) => f.name)).toEqual(["src"]);
  });

  it("treats an item the OS would not classify as a file", () => {
    const result = splitArrivingItems(
      [arriving("src", null), arriving("a.txt", null)],
      resolvePath,
    );
    expect(result.pathText).toBe("");
    expect(result.files.map((f) => f.name)).toEqual(["src", "a.txt"]);
  });

  it("returns nothing for an empty batch", () => {
    const result = splitArrivingItems([], resolvePath);
    expect(result.pathText).toBe("");
    expect(result.files).toEqual([]);
  });
});
