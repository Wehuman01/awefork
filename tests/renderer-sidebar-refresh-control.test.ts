import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SIDEBAR_PATH = resolve(import.meta.dirname, "../src/renderer/src/components/side-bar.vue");

describe("sidebar refresh control", () => {
  it("keeps the refresh control beside search instead of the project heading", async () => {
    const sidebar = await readFile(SIDEBAR_PATH, "utf8");

    expect(sidebar).toMatch(
      /<div class="search-row">[\s\S]*class="search-refresh"[\s\S]*@click="emitRefresh"/,
    );
    expect(sidebar).not.toMatch(/class="head-icon" title="重新加载会话"/);
  });
});
