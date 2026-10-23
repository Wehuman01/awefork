import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src/renderer/src/components");
const CELL_PATH = resolve(SRC, "cmp-cell.vue");
const CONTEXT_PATH = resolve(SRC, "branch-context.vue");

/**
 * The compare lens renders two columns side by side, so a card's fold state
 * must never ride on the other column's card. Two guards keep that true and
 * both are checked here as source invariants: the card resets its fold when
 * either the card or its column changes, and the free side-by-side columns
 * namespace their cell ids by side so colliding message ids stay distinct.
 */

describe("compare card fold isolation", () => {
  it("resets the fold when the card or its column changes", async () => {
    const cell = await readFile(CELL_PATH, "utf8");

    // The watch key carries the side: a slot reused across a plan rebuild, or
    // the same card id appearing in the other column, folds shut either way.
    expect(cell).toMatch(/watch\(\s*\(\) => \[props\.side, props\.cell\?\.id\]/);
    // A bare cell-id key would let a rebuilt plan's new card inherit the
    // previous occupant's expansion.
    expect(cell).not.toMatch(/watch\(\s*\(\) => props\.cell\?\.id/);
  });

  it("namespaces free side-by-side cell ids by column", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");

    // Two independent stories may mint the same message ids; the side prefix
    // keeps the columns' cell ids apart.
    expect(context).toMatch(/const side = sides\[ci\];/);
    expect(context).toMatch(/id: `\$\{side\}:\$\{id\}:\$\{turn\.messageId\}`/);
  });
});
