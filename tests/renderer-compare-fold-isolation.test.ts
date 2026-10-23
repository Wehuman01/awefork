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

  it("lets both compare modes flow as independent columns", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");

    // The aligned mode used to bind left[i] and right[i] into one grid row,
    // which forced both cells to share the row's height: an open card then
    // left a wall of dead space under its folded neighbour and pushed that
    // column's next turn out of sight. Both modes now render the same two
    // independently scrolling columns.
    expect(context).toMatch(/v-for="\(col, ci\) in pairColumns"/);
    expect(context).toMatch(/v-for="cell in col\.cells"/);
    expect(context).not.toMatch(/v-for="\(row, i\) in pairRows"/);
    expect(context).not.toMatch(/class="pair"/);
    expect(context).not.toMatch(/stepPager/);
  });

  it("keeps the column head off the aligned mode", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");

    // The aligned header cards above already name both sides and mark the
    // current one. A column head there would only repeat them, and its
    // "选中" would tear the lens down mid-comparison — selecting a session
    // is the compare exit switch. Only the free side-by-side mode, whose two
    // timelines share no header, keeps the head.
    const aligned = context.slice(
      context.indexOf("in pairColumns"),
      context.indexOf("<!-- 不同源"),
    );
    expect(aligned).not.toMatch(/cmp-fcol-head/);
    expect(context.slice(context.indexOf("<!-- 不同源"))).toMatch(/cmp-fcol-head/);
  });
});
