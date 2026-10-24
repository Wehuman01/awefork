import { describe, expect, it } from "vitest";
import type { Caret } from "../src/renderer/src/path-insert";
import { insertPathText, joinPaths } from "../src/renderer/src/path-insert";

/**
 * The splice behind every path insertion (drag-drop onto a draft, the
 * context menu's insert action). The rules under test: the path lands
 * verbatim, on its own line, at the caret or over the selection, and the
 * caret reports where the next keystroke goes.
 */
describe("insertPathText", () => {
  const path = "/Users/peng/Desktop/Project/product/wehuman/awesome/awefork/docs/a.md";

  it("lands the path verbatim — no encoding, no file://, no escaping", () => {
    const result = insertPathText("请帮我看一下这个文件：", path);
    expect(result.text).toBe(`请帮我看一下这个文件：\n${path}\n`);
    expect(result.text).not.toContain("file://");
    expect(result.text).not.toContain("%20");
  });

  it("keeps spaces and CJK in the path intact", () => {
    const spaced = "/Users/peng/My Docs/笔记 文件.md";
    const result = insertPathText("", spaced);
    expect(result.text).toBe(`${spaced}\n`);
  });

  it("adds no leading newline to an empty draft", () => {
    expect(insertPathText("", path).text).toBe(`${path}\n`);
  });

  it("adds no leading newline after an existing line break", () => {
    expect(insertPathText("第一行\n", path).text).toBe(`第一行\n${path}\n`);
  });

  it("separates a following line from the inserted path", () => {
    // Caret mid-text: the path takes its own line on both sides.
    const text = `前\n${path}\n后`;
    const result = insertPathText(text, "/x/y", { start: 2, end: 2 });
    expect(result.text).toBe(`前\n/x/y\n${path}\n后`);
  });

  it("replaces the selection instead of duplicating around it", () => {
    const result = insertPathText("前缀旧内容后缀", path, { start: 2, end: 5 });
    expect(result.text).toBe(`前缀\n${path}\n后缀`);
  });

  it("splices at the caret when the caret is mid-text", () => {
    const text = "前中后";
    const result = insertPathText(text, path, { start: 1, end: 1 });
    expect(result.text).toBe(`前\n${path}\n中后`);
  });

  it("defaults the caret to the end of the text", () => {
    const result = insertPathText("已有文本", path);
    expect(result.text).toBe(`已有文本\n${path}\n`);
  });

  it("reports the caret after the inserted line", () => {
    const result = insertPathText("abc", path, { start: 3, end: 3 });
    // "abc\n" + path + "\n" — the caret sits at the very end.
    expect(result.caret).toEqual({ start: result.text.length, end: result.text.length });
  });

  it("clamps a stale caret into the text it refers to", () => {
    const result = insertPathText("abc", path, { start: 99, end: 120 });
    expect(result.text).toBe(`abc\n${path}\n`);
  });

  it("treats an inverted caret as a selection at the start point", () => {
    const result = insertPathText("abcdef", path, { start: 4, end: 2 });
    expect(result.text).toBe(`abcd\n${path}\nef`);
  });

  it("stacks consecutive drops one per line, each keeping its own caret", () => {
    // Two files dropped in a row: the second lands after the first, on its
    // own line, and the caret keeps moving down.
    let text = "";
    let caret: Caret | undefined;
    for (const dropped of ["/a/first.md", "/b/second.md"]) {
      const result = insertPathText(text, dropped, caret);
      text = result.text;
      caret = result.caret;
    }
    expect(text).toBe("/a/first.md\n/b/second.md\n");
    expect(caret).toEqual({ start: text.length, end: text.length });
  });
});

describe("joinPaths", () => {
  it("joins several paths one per line, in order", () => {
    expect(joinPaths(["/a", "/b", "/c"])).toBe("/a\n/b\n/c");
  });

  it("keeps a single path unwrapped", () => {
    expect(joinPaths(["/a"])).toBe("/a");
  });
});
