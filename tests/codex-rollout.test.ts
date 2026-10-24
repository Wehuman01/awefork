import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTurnContexts } from "../src/main/codex-rollout.js";

const roots: string[] = [];

function makeHome(): string {
  const home = join(tmpdir(), `awefork-rollout-${Math.random().toString(36).slice(2)}`, ".codex");
  mkdirSync(home, { recursive: true });
  roots.push(join(home, ".."));
  return home;
}

/** Write a session's rollout the way codex lays it out: sessions/<y>/<m>/<d>. */
function writeRollout(home: string, sessionId: string, records: unknown[]): string {
  const day = join(home, "sessions", "2026", "10", "24");
  mkdirSync(day, { recursive: true });
  const path = join(day, `rollout-2026-10-24T11-18-14-${sessionId}.jsonl`);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readTurnContexts", () => {
  it("maps each turn's model and effort from its turn_context record", async () => {
    const home = makeHome();
    writeRollout(home, "sess-1", [
      { type: "session_meta", payload: { id: "sess-1" } },
      {
        type: "turn_context",
        payload: { turn_id: "turn-a", model: "gpt-6.1-sol", effort: "ultra" },
      },
      { type: "response_item", payload: { type: "message", role: "user" } },
      {
        type: "turn_context",
        payload: { turn_id: "turn-b", model: "stepfun-cn-2/step-5-preview", effort: "high" },
      },
    ]);

    expect(await readTurnContexts(home, "sess-1")).toEqual({
      "turn-a": { model: "gpt-6.1-sol", effort: "ultra" },
      "turn-b": { model: "stepfun-cn-2/step-5-preview", effort: "high" },
    });
  });

  it("skips unrelated records, torn lines and contexts without a turn id", async () => {
    const home = makeHome();
    const path = writeRollout(home, "sess-2", [
      { type: "event_msg", payload: { type: "thread_settings_applied" } },
      { type: "turn_context", payload: { model: "no-turn-id", effort: "high" } },
      { type: "turn_context", payload: { turn_id: "", model: "empty-id", effort: "high" } },
    ]);
    // A torn final line: the turn is still writing its record.
    const complete = JSON.stringify({
      type: "turn_context",
      payload: { turn_id: "turn-torn", model: "gpt-6.1-sol" },
    });
    writeFileSync(path, `${complete.slice(0, complete.length - 12)}\n`);

    expect(await readTurnContexts(home, "sess-2")).toEqual({});
  });

  it("returns nothing for a session with no rollout (compressed or pruned)", async () => {
    const home = makeHome();
    expect(await readTurnContexts(home, "never-existed")).toEqual({});
  });

  it("re-parses once the rollout grows, so a live session keeps up", async () => {
    const home = makeHome();
    writeRollout(home, "sess-3", [
      {
        type: "turn_context",
        payload: { turn_id: "turn-a", model: "gpt-6.1-sol", effort: "ultra" },
      },
    ]);
    expect(await readTurnContexts(home, "sess-3")).toEqual({
      "turn-a": { model: "gpt-6.1-sol", effort: "ultra" },
    });

    writeRollout(home, "sess-3", [
      {
        type: "turn_context",
        payload: { turn_id: "turn-a", model: "gpt-6.1-sol", effort: "ultra" },
      },
      {
        type: "turn_context",
        payload: { turn_id: "turn-b", model: "stepfun-cn-2/step-5-preview", effort: "high" },
      },
    ]);
    expect(await readTurnContexts(home, "sess-3")).toEqual({
      "turn-a": { model: "gpt-6.1-sol", effort: "ultra" },
      "turn-b": { model: "stepfun-cn-2/step-5-preview", effort: "high" },
    });
  });
});
