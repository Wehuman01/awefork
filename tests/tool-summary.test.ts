import { describe, expect, it } from "vitest";
import { toolSummary } from "../src/renderer/src/tool-summary";

describe("toolSummary", () => {
  it("keeps a lone tool call as its full label", () => {
    expect(toolSummary(["read"])).toBe("read");
    // codex's command preview survives when there is only one call
    expect(toolSummary(["shell · rg login"])).toBe("shell · rg login");
  });

  it("folds codex's command-preview chips into one family count", () => {
    expect(
      toolSummary([
        "shell · /bin/zsh -lc 'rtk git st…",
        "shell · /bin/zsh -lc 'rtk git di…",
        "patch",
        "patch",
      ]),
    ).toBe("shell ×2 · patch ×2");
  });

  it("keeps first-seen order across families", () => {
    expect(toolSummary(["read", "edit", "read", "bash"])).toBe("read ×2 · edit · bash");
  });

  it("treats an empty or blank label as its own family", () => {
    expect(toolSummary([" · odd"])).toBe(" · odd");
  });

  it("truncates a long line at a group boundary, never mid name", () => {
    const names = ["read", "edit", "bash", "grep", "webfetch", "task", "patch", "skill"];
    const summary = toolSummary(names);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(49);
    // every kept group is whole — no "rea…" style cut
    for (const group of summary.slice(0, -1).split(" · ")) {
      expect(names.some((name) => name === group || name.startsWith(`${group} `))).toBe(true);
    }
  });

  it("returns an empty line for no tool calls", () => {
    expect(toolSummary([])).toBe("");
  });
});
