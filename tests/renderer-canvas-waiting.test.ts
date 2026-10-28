import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src/renderer/src");
const CANVAS_PATH = resolve(SRC, "components/session-canvas.vue");
const CSS_PATH = resolve(SRC, "style.css");
const I18N_PATH = resolve(SRC, "i18n-messages.ts");

/**
 * A session with a queued ask is waiting for the user, not working — the run
 * stays open until the decision lands, so `running` alone painted it the sky
 * of a live run on the canvas and in the minimap. The overview already reads
 * that state amber; these guards pin the wiring that brings the same amber to
 * both canvas surfaces and keeps it above the run's sky.
 */

describe("canvas waiting tint", () => {
  it("derives waiting from a queued ask on a running tip", async () => {
    const canvas = await readFile(CANVAS_PATH, "utf8");
    expect(canvas).toMatch(/function isNodeWaiting\(node: TurnNode\): boolean \{/);
    // tip-only, like running: an ask belongs to the session, the tip card is
    // the one that carries it
    expect(canvas).toMatch(/isNodeRunning\(node\) &&/);
    expect(canvas).toMatch(/store\.interactions\[store\.activeBackend\]/);
    expect(canvas).toMatch(/\.some\(\(ask\) => ask\.sessionId === node\.sessionId\)/);
  });

  it("binds the waiting class on the card, the flag and the minimap dot", async () => {
    const canvas = await readFile(CANVAS_PATH, "utf8");
    expect(canvas).toMatch(/running: isNodeRunning\(node\),\n\s+waiting: isNodeWaiting\(node\),/);
    // The map dot's classes are built once per graph change (mmDots) and the
    // template binds that descriptor — a per-frame class object was the jank.
    expect(canvas).toMatch(/isNodeRunning\(node\) \? "running" : ""/);
    expect(canvas).toMatch(/isNodeWaiting\(node\) \? "waiting" : ""/);
    expect(canvas).toMatch(/:class="dot\.className"/);
    expect(canvas).toMatch(/:class="\{ waiting: isNodeWaiting\(node\) \}"/);
    // the flag names the state instead of claiming the run is working
    expect(canvas).toMatch(
      /isNodeWaiting\(node\) \? t\("canvas\.waiting"\) : t\("canvas\.running"\)/,
    );
  });

  it("paints waiting amber, ordered after the run's sky so it wins", async () => {
    const css = await readFile(CSS_PATH, "utf8");
    const running = css.indexOf(".turn.running {");
    const waiting = css.indexOf(".turn.waiting {");
    expect(running).toBeGreaterThan(-1);
    expect(waiting).toBeGreaterThan(running);
    expect(css.slice(waiting, waiting + 120)).toMatch(/border-color: var\(--ask\)/);

    const mmRunning = css.indexOf(".mm-node.running {");
    const mmWaiting = css.indexOf(".mm-node.waiting {");
    expect(mmWaiting).toBeGreaterThan(mmRunning);
    expect(css.slice(mmWaiting, mmWaiting + 140)).toMatch(/background: var\(--ask\)/);

    expect(css).toMatch(/\.running-flag\.waiting \{\s*color: var\(--ask-deep\);/);
  });

  it("names the state in both languages", async () => {
    const i18n = await readFile(I18N_PATH, "utf8");
    expect(i18n).toMatch(/"canvas\.waiting": \{ zh: "◐ 等你处理", en: "◐ Needs you" \},/);
  });
});
