import { describe, expect, it } from "vitest";
import { type BranchMarkdownTurn, buildBranchMarkdown } from "../src/shared/branch-markdown.js";

const turn = (over: Partial<BranchMarkdownTurn> = {}): BranchMarkdownTurn => ({
  title: "帮我看看这个报错",
  prompt: "帮我看看这个报错",
  reply: "这是 token 过期导致的。",
  toolNames: [],
  model: "glm-4.7",
  variant: null,
  durationMs: 4200,
  outputTokens: 830,
  error: null,
  ...over,
});

// 2026-09-17 21:30 local — the builder renders local time deterministically.
const input = (turns: BranchMarkdownTurn[]) => ({
  title: "修登录 bug",
  exportedAt: new Date(2026, 8, 17, 21, 30).getTime(),
  turns,
});

describe("buildBranchMarkdown", () => {
  it("renders the header with export time, turn count and summed tokens", () => {
    const md = buildBranchMarkdown(input([turn(), turn({ outputTokens: 12400 })]));
    expect(md).toMatch(/^# 修登录 bug\n\n/);
    expect(md).toContain("> 导出于 2026-09-17 21:30 · 2 个回合 · 输出 13.2k tok");
  });

  it("numbers turns and renders metadata only for what a turn reports", () => {
    const md = buildBranchMarkdown(input([turn({ variant: "high", toolNames: ["bash", "read"] })]));
    expect(md).toContain("## 1. 帮我看看这个报错");
    expect(md).toContain("- 模型：glm-4.7（high 档）");
    expect(md).toContain("- 耗时 4.2s · 输出 830 tok");
    expect(md).toContain("- 工具：bash、read");
    expect(md).not.toContain("⚠ 失败");
  });

  it("fences the full prompt and embeds the reply verbatim", () => {
    const md = buildBranchMarkdown(
      input([
        turn({
          prompt: "第一行\n\n```js\ncode()\n```",
          reply: "回复**加粗**也保留",
        }),
      ]),
    );
    expect(md).toContain("````\n第一行\n\n```js\ncode()\n```\n````");
    expect(md).toContain("**回复**\n\n回复**加粗**也保留\n");
  });

  it("picks a longer fence when the prompt itself contains long backtick runs", () => {
    const six = "`".repeat(6);
    const seven = "`".repeat(7);
    const md = buildBranchMarkdown(input([turn({ prompt: `${six}\nraw\n${six}` })]));
    expect(md).toContain(`${seven}\n${six}\nraw\n${six}\n${seven}`);
  });

  it("marks failures and omits the reply section for a failed tool-only turn", () => {
    const md = buildBranchMarkdown(
      input([turn({ reply: "", toolNames: ["bash"], error: "timeout after 30s" })]),
    );
    expect(md).toContain("- ⚠ 失败：timeout after 30s");
    expect(md).not.toContain("*(无文本回复)*");
    expect(md).not.toContain("**回复**");
  });

  it("notes tool-only turns that succeeded without text", () => {
    const md = buildBranchMarkdown(input([turn({ reply: "", toolNames: ["bash"] })]));
    expect(md).toContain("*(无文本回复)*");
  });

  it("separates turns with blank lines around the rule so replies can't become setext headings", () => {
    const md = buildBranchMarkdown(input([turn(), turn()]));
    expect(md).toContain("这是 token 过期导致的。\n\n---\n\n## 2.");
    // Rules only sit between turns; the document ends with the last turn.
    expect(md).toMatch(/这是 token 过期导致的。\n$/);
  });

  it("renders an empty branch as just the header", () => {
    const md = buildBranchMarkdown(input([]));
    expect(md).toBe("# 修登录 bug\n\n> 导出于 2026-09-17 21:30 · 0 个回合 · 输出 0 tok\n");
  });
});
