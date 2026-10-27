import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readForkParents } from "../src/main/codex-rollout.js";

const roots: string[] = [];

function makeHome(): string {
  const home = join(
    tmpdir(),
    `awefork-forkparents-${Math.random().toString(36).slice(2)}`,
    ".codex",
  );
  mkdirSync(home, { recursive: true });
  roots.push(join(home, ".."));
  return home;
}

/** Write a session's rollout the way codex lays it out: sessions/<y>/<m>/<d>. */
function writeRollout(home: string, sessionId: string, records: unknown[]): string {
  const day = join(home, "sessions", "2026", "10", "27");
  mkdirSync(day, { recursive: true });
  const path = join(day, `rollout-2026-10-27T09-59-44-${sessionId}.jsonl`);
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readForkParents", () => {
  it("maps each session to the parent its rollout recorded", async () => {
    const home = makeHome();
    writeRollout(home, "child-1", [
      {
        type: "session_meta",
        payload: {
          session_id: "child-1",
          id: "child-1",
          forked_from_id: "parent-1",
          forked_from_ordinal_exclusive: 972,
        },
      },
    ]);
    writeRollout(home, "parent-1", [
      { type: "session_meta", payload: { session_id: "parent-1", id: "parent-1" } },
    ]);

    expect(await readForkParents(home)).toEqual({ "child-1": "parent-1" });
  });

  it("treats a session without a forked_from_id as a root", async () => {
    const home = makeHome();
    writeRollout(home, "root-1", [
      { type: "session_meta", payload: { session_id: "root-1", id: "root-1" } },
    ]);

    expect(await readForkParents(home)).toEqual({});
  });

  it("reads the parent's id from the record's id, not the file name", async () => {
    const home = makeHome();
    // codex writes the forked-from parent into forked_from_id; the file's own
    // name carries the session's id. A record whose session_id disagrees with
    // the file name is a copy of another session's prefix — the id that
    // matters is the one the record names.
    writeRollout(home, "forked-copy", [
      {
        type: "session_meta",
        payload: {
          session_id: "forked-copy",
          id: "forked-copy",
          forked_from_id: "real-parent",
        },
      },
    ]);

    expect(await readForkParents(home)).toEqual({ "forked-copy": "real-parent" });
  });

  it("ignores a record whose parent is itself", async () => {
    const home = makeHome();
    writeRollout(home, "self-1", [
      {
        type: "session_meta",
        payload: {
          session_id: "self-1",
          id: "self-1",
          forked_from_id: "self-1",
        },
      },
    ]);

    expect(await readForkParents(home)).toEqual({});
  });

  it("skips a session whose parent is an empty string", async () => {
    const home = makeHome();
    writeRollout(home, "blank-1", [
      {
        type: "session_meta",
        payload: {
          session_id: "blank-1",
          id: "blank-1",
          forked_from_id: "",
        },
      },
    ]);

    expect(await readForkParents(home)).toEqual({});
  });

  it("returns nothing for a home without rollouts", async () => {
    const home = makeHome();
    expect(await readForkParents(home)).toEqual({});
  });

  it("finds a session nested under a home's own sessions root", async () => {
    const home = makeHome();
    const nested = join(home, "sessions", "2026", "10", "27");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "rollout-2026-10-27T12-29-43-deep-child.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        payload: { session_id: "deep-child", id: "deep-child", forked_from_id: "deep-parent" },
      })}\n`,
    );

    expect(await readForkParents(home)).toEqual({ "deep-child": "deep-parent" });
  });

  it("reads a session whose first record is longer than one read chunk", async () => {
    const home = makeHome();
    const day = join(home, "sessions", "2026", "10", "27");
    mkdirSync(day, { recursive: true });
    // The session_meta record carries the model's base instructions, so its
    // length is not bounded — the read must not stop at a fixed chunk.
    const long = "x".repeat(200_000);
    writeFileSync(
      join(day, "rollout-2026-10-27T12-29-43-long-child.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          session_id: "long-child",
          id: "long-child",
          forked_from_id: "long-parent",
          base_instructions: { text: long },
        },
      })}\n${JSON.stringify({ type: "event_msg", payload: { type: "noise" } })}\n`,
    );

    expect(await readForkParents(home)).toEqual({ "long-child": "long-parent" });
  });

  it("reads nothing from a first line longer than the cap", async () => {
    const home = makeHome();
    const day = join(home, "sessions", "2026", "10", "27");
    mkdirSync(day, { recursive: true });
    // A first line with no newline and more content than a session_meta record
    // ever carries: the read stops at the cap instead of pulling the whole
    // file in, and the session reads as having no parent.
    writeFileSync(
      join(day, "rollout-2026-10-27T12-29-43-oversize.jsonl"),
      `{"type":"session_meta","payload":{"session_id":"oversize","forked_from_id":"parent","pad":"${"x".repeat(2 * 1024 * 1024)}"}`,
    );

    expect(await readForkParents(home)).toEqual({});
  });

  it("caches a home's parents, so a second read does not walk the tree again", async () => {
    const home = makeHome();
    writeRollout(home, "cached-1", [
      {
        type: "session_meta",
        payload: {
          session_id: "cached-1",
          id: "cached-1",
          forked_from_id: "cached-parent",
        },
      },
    ]);

    expect(await readForkParents(home)).toEqual({ "cached-1": "cached-parent" });

    // A fork written after the read is not in the cached answer.
    writeRollout(home, "cached-2", [
      {
        type: "session_meta",
        payload: {
          session_id: "cached-2",
          id: "cached-2",
          forked_from_id: "cached-parent",
        },
      },
    ]);
    expect(await readForkParents(home)).toEqual({ "cached-1": "cached-parent" });
  });
});
