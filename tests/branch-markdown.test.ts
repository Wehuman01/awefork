import { describe, expect, it } from "vitest";
import { type BranchMarkdownTurn, buildBranchMarkdown } from "../src/shared/branch-markdown.js";

const turn = (over: Partial<BranchMarkdownTurn> = {}): BranchMarkdownTurn => ({
  title: "Look at this error",
  prompt: "Look at this error",
  reply: "The token expired.",
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
  title: "Fix the login bug",
  exportedAt: new Date(2026, 8, 17, 21, 30).getTime(),
  turns,
});

describe("buildBranchMarkdown", () => {
  it("renders the header with export time, turn count and summed tokens", () => {
    const md = buildBranchMarkdown(input([turn(), turn({ outputTokens: 12400 })]));
    expect(md).toMatch(/^# Fix the login bug\n\n/);
    expect(md).toContain("> Exported 2026-09-17 21:30 · 2 turns · 13.2k tok output");
  });

  it("numbers turns and renders metadata only for what a turn reports", () => {
    const md = buildBranchMarkdown(input([turn({ variant: "high", toolNames: ["bash", "read"] })]));
    expect(md).toContain("## 1. Look at this error");
    expect(md).toContain("- Model: glm-4.7 (high tier)");
    expect(md).toContain("- 4.2s · 830 tok output");
    expect(md).toContain("- Tools: bash, read");
    expect(md).not.toContain("⚠ Failed");
  });

  it("fences the full prompt and embeds the reply verbatim", () => {
    const md = buildBranchMarkdown(
      input([
        turn({
          prompt: "First line\n\n```js\ncode()\n```",
          reply: "The reply keeps **bold** too",
        }),
      ]),
    );
    expect(md).toContain("````\nFirst line\n\n```js\ncode()\n```\n````");
    expect(md).toContain("**Reply**\n\nThe reply keeps **bold** too\n");
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
    expect(md).toContain("- ⚠ Failed: timeout after 30s");
    expect(md).not.toContain("*(no text reply)*");
    expect(md).not.toContain("**Reply**");
  });

  it("notes tool-only turns that succeeded without text", () => {
    const md = buildBranchMarkdown(input([turn({ reply: "", toolNames: ["bash"] })]));
    expect(md).toContain("*(no text reply)*");
  });

  it("separates turns with blank lines around the rule so replies can't become setext headings", () => {
    const md = buildBranchMarkdown(input([turn(), turn()]));
    expect(md).toContain("The token expired.\n\n---\n\n## 2.");
    // Rules only sit between turns; the document ends with the last turn.
    expect(md).toMatch(/The token expired\.\n$/);
  });

  it("renders an empty branch as just the header", () => {
    const md = buildBranchMarkdown(input([]));
    expect(md).toBe(
      "# Fix the login bug\n\n> Exported 2026-09-17 21:30 · 0 turns · 0 tok output\n",
    );
  });
});
