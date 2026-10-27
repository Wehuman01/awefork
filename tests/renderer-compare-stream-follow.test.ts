import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src/renderer/src/components");
const CONTEXT_PATH = resolve(SRC, "branch-context.vue");

/**
 * The compare columns follow a streaming run exactly like the pane's
 * message list: a column the reader parked at the bottom keeps up with
 * the run, one they scrolled up keeps its place and counts the turns
 * that land below, and the "was I at the bottom" question is answered
 * BEFORE the DOM updates — afterwards the grown column would make a
 * followed reader look parked mid-column and the follow would stop.
 * Comparing two live runs is the case this exists for: one side streams
 * while the other is being read. The behavior lives in watcher wiring,
 * so it is pinned here as source invariants.
 */

describe("compare column stream follow", () => {
  it("asks where the reader is before the DOM updates", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");
    const watchBlock = context.slice(context.indexOf("watch([pairColumns, freeColumns]"));
    expect(watchBlock).toMatch(/const wasAtBottom/);
    // The position read must precede the nextTick re-pin. Reading it after
    // would compare against the already-grown column and stop the follow.
    expect(watchBlock.indexOf("scrollHeight - el.scrollTop - el.clientHeight")).toBeLessThan(
      watchBlock.indexOf("void nextTick"),
    );
  });

  it("counts turns, not rebuilds, while the reader is away", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");
    // A streamed delta rebuilds the columns many times per turn, so the
    // pill's number is a turn-count delta — and only while the reader is
    // actually reading back, so content that predates their scroll is
    // never announced as new.
    expect(context).toMatch(/else if \(colAway\.value\[index\] && turns > colTurnsSeen\[index\]\)/);
    expect(context).toMatch(/colNewTurns\.value\[index\] \+= turns - colTurnsSeen\[index\]/);
  });

  it("keeps the away state current even with sync scroll off", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");
    // The away flag is the follow's source of truth, so the scroll handler
    // updates it before the sync toggle's early return — otherwise a
    // reader who never turned sync on would never be counted as away.
    expect(context).toMatch(
      /function onColScroll\(index: number, event: Event\): void \{\s*syncColAway\(index\);/,
    );
  });

  it("offers the way back in both compare modes", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");
    // The pill rides each column's own bottom; both modes render it and
    // jump that column to its newest turn.
    expect(context.match(/class="cmp-jump"/g)).toHaveLength(2);
    expect(context).toMatch(/@click="pinColBottom\(ci, true\)"/);
  });

  it("opens a running side on its newest turn", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");
    // Comparing two live runs means the stream is the point: the running
    // side lands at the bottom, a settled pair opens at the fork.
    expect(context).toMatch(/if \(store\.running\[pair\.leftId\]\) pinColBottom\(0, false\)/);
    expect(context).toMatch(/if \(store\.running\[pair\.rightId\]\) pinColBottom\(1, false\)/);
  });

  it("re-anchors a synced pair when a column's content changes", async () => {
    const context = await readFile(CONTEXT_PATH, "utf8");
    // A column whose content grew (or shrank) invalidates the ratio the
    // pair was carried to; the relayed ratio is re-applied to the other
    // column's own new range instead of leaving the pair out of step.
    expect(context).toMatch(/lastSyncFrom = index;/);
    expect(context).toMatch(/el\.scrollTop = lastSyncRatio \* span;/);
  });
});
