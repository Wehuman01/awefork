import { describe, expect, it } from "vitest";
import { selectCanvasSessions, storyRootOf } from "../src/shared/canvas-scope";
import type { LineageMap, SessionSummary } from "../src/shared/types";

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    title: `session ${id}`,
    directory: "/repo",
    parentSessionId: null,
    origin: "root",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function lineageOf(pairs: [child: string, parent: string][]): LineageMap {
  return Object.fromEntries(
    pairs.map(([child, parent]) => [child, { parentId: parent, atMessageId: null, createdAt: 1 }]),
  );
}

describe("selectCanvasSessions", () => {
  const sessions = [
    session("root-a"),
    session("root-b"),
    session("a-fork-1", { parentSessionId: "root-a", origin: "fork" }),
    session("a-fork-2", { parentSessionId: "root-a", origin: "fork" }),
    session("a-fork-1-1", { parentSessionId: "a-fork-1", origin: "fork" }),
    session("unrelated"),
  ];
  const lineage = lineageOf([
    ["a-fork-1", "root-a"],
    ["a-fork-2", "root-a"],
    ["a-fork-1-1", "a-fork-1"],
  ]);

  it("returns an empty canvas when nothing is selected", () => {
    expect(selectCanvasSessions(sessions, lineage, null)).toEqual([]);
  });

  it("shows the whole story of the selected session — sibling branches stay", () => {
    const ids = selectCanvasSessions(sessions, lineage, "a-fork-1").map((s) => s.id);
    // walks up to root-a and brings its full fork tree, a-fork-2 included
    expect(ids.sort()).toEqual(["a-fork-1", "a-fork-1-1", "a-fork-2", "root-a"]);
  });

  it("shows only the selected story — an unrelated root never sneaks in", () => {
    const ids = selectCanvasSessions(sessions, lineage, "unrelated").map((s) => s.id);
    expect(ids).toEqual(["unrelated"]);
  });

  it("ignores a selection that no longer exists", () => {
    expect(selectCanvasSessions(sessions, lineage, "ghost")).toEqual([]);
  });

  it("resolves parents through awefork lineage when the agent has none", () => {
    // fork recorded by awefork: the agent API reports parentSessionId null
    const onlyAgent = [session("root-a"), session("a-fork", { origin: "fork" })];
    const agentLineage = lineageOf([["a-fork", "root-a"]]);
    const ids = selectCanvasSessions(onlyAgent, agentLineage, "a-fork").map((s) => s.id);
    expect(ids.sort()).toEqual(["a-fork", "root-a"]);
  });
});

describe("storyRootOf", () => {
  const sessions = [
    session("root-a"),
    session("root-b"),
    session("a-fork-1", { parentSessionId: "root-a", origin: "fork" }),
    session("a-fork-1-1", { parentSessionId: "a-fork-1", origin: "fork" }),
  ];
  const lineage = lineageOf([
    ["a-fork-1", "root-a"],
    ["a-fork-1-1", "a-fork-1"],
  ]);

  it("walks to the top of the chain", () => {
    expect(storyRootOf(sessions, lineage, "a-fork-1-1")).toBe("root-a");
    expect(storyRootOf(sessions, lineage, "root-a")).toBe("root-a");
  });

  it("returns null without a selection or for an unknown session", () => {
    expect(storyRootOf(sessions, lineage, null)).toBeNull();
    expect(storyRootOf(sessions, lineage, "ghost")).toBeNull();
  });

  it("survives a cycle in the parent chain", () => {
    const cyclic = lineageOf([
      ["x", "y"],
      ["y", "x"],
    ]);
    // Any member of the cycle is a valid stop; the guarantee is termination.
    expect(["x", "y"]).toContain(storyRootOf([session("x"), session("y")], cyclic, "x"));
  });
});
