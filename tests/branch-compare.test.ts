import { describe, expect, it } from "vitest";
import { buildComparePlan } from "../src/shared/branch-compare";
import { buildTurnGraph } from "../src/shared/canvas-graph";
import type { ChatMessage, ForkRecord, LineageMap, SessionSummary } from "../src/shared/types";

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

function chain(...pairs: [string, string][]): ChatMessage[] {
  return pairs.flatMap(([userId, assistantId], i) => [
    {
      id: userId,
      role: "user" as const,
      text: `prompt ${userId}`,
      toolNames: [],
      modelId: null,
      providerId: null,
      variant: null,
      attachmentNames: [],
      createdAt: i * 10,
      completedAt: null,
      outputTokens: null,
      error: null,
    },
    {
      id: assistantId,
      role: "assistant" as const,
      text: `reply ${assistantId}`,
      toolNames: [],
      modelId: `fake/model-${i + 1}`,
      providerId: "oc-fake",
      variant: null,
      attachmentNames: [],
      createdAt: i * 10 + 5,
      completedAt: null,
      outputTokens: null,
      error: null,
    },
  ]);
}

function fork(
  parentId: string,
  atMessageId: string | null,
  extra: Partial<ForkRecord> = {},
): ForkRecord {
  return { parentId, atMessageId, createdAt: 500, ...extra };
}

/** Root session `a` with three turns; branches hang off a-u1 / a-u2. */
const ROOT = chain(["a-u1", "a-r1"], ["a-u2", "a-r2"], ["a-u3", "a-r3"]);

function ids(nodes: { id: string }[] | null | undefined): string[] {
  return (nodes ?? []).map((n) => n.id);
}

describe("buildComparePlan", () => {
  it("aligns a parent with its child on the fork anchor", () => {
    const graph = buildTurnGraph({
      sessions: [session("a"), session("b", { origin: "fork", createdAt: 500 })],
      lineage: { b: fork("a", "a-u1") },
      messages: {
        a: ROOT,
        b: chain(["a-u1", "a-r1"], ["b-u2", "b-r2"]),
      },
    });

    const plan = buildComparePlan(graph, "a", "b");
    expect(ids(plan?.common)).toEqual(["a:a-u1"]);
    expect(plan?.anchor.id).toBe("a:a-u1");
    expect(ids(plan?.left)).toEqual(["a:a-u2", "a:a-u3"]);
    expect(ids(plan?.right)).toEqual(["b:b-u2"]);
  });

  it("aligns siblings that forked from the same turn", () => {
    const graph = buildTurnGraph({
      sessions: [
        session("a"),
        session("b", { origin: "fork", createdAt: 500 }),
        session("c", { origin: "fork", createdAt: 600 }),
      ],
      lineage: { b: fork("a", "a-u1"), c: fork("a", "a-u1") },
      messages: {
        a: ROOT,
        b: chain(["a-u1", "a-r1"], ["b-u2", "b-r2"]),
        c: chain(["a-u1", "a-r1"], ["c-u2", "c-r2"]),
      },
    });

    const plan = buildComparePlan(graph, "b", "c");
    expect(plan?.anchor.id).toBe("a:a-u1");
    expect(ids(plan?.common)).toEqual(["a:a-u1"]);
    expect(ids(plan?.left)).toEqual(["b:b-u2"]);
    expect(ids(plan?.right)).toEqual(["c:c-u2"]);
  });

  it("keeps an empty-context fork's own turns and anchors at the recorded cut", () => {
    const graph = buildTurnGraph({
      sessions: [session("a"), session("b", { origin: "fork", createdAt: 500 })],
      lineage: { b: fork("a", "a-u1", { context: "none" }) },
      messages: {
        a: ROOT,
        // The fork copied nothing; its only turn is its own prompt.
        b: chain(["b-u1", "b-r1"]),
      },
    });

    const plan = buildComparePlan(graph, "a", "b");
    expect(plan?.anchor.id).toBe("a:a-u1");
    expect(ids(plan?.left)).toEqual(["a:a-u2", "a:a-u3"]);
    expect(ids(plan?.right)).toEqual(["b:b-u1"]);
  });

  it("compares a branch forked from the parent's tip (parent side runs empty)", () => {
    const graph = buildTurnGraph({
      sessions: [session("a"), session("b", { origin: "fork", createdAt: 500 })],
      lineage: { b: fork("a", "a-u2") },
      messages: {
        a: chain(["a-u1", "a-r1"], ["a-u2", "a-r2"]),
        b: chain(["a-u1", "a-r1"], ["a-u2", "a-r2"], ["b-u3", "b-r3"]),
      },
    });

    const plan = buildComparePlan(graph, "a", "b");
    expect(plan?.anchor.id).toBe("a:a-u2");
    expect(plan?.left).toEqual([]);
    expect(ids(plan?.right)).toEqual(["b:b-u3"]);
  });

  it("attributes upstream turns inside a side's divergent path for cousins", () => {
    const graph = buildTurnGraph({
      sessions: [
        session("a"),
        session("b", { origin: "fork", createdAt: 500 }),
        session("c", { origin: "fork", createdAt: 600 }),
      ],
      lineage: { b: fork("a", "a-u1"), c: fork("b", "b-u2") },
      messages: {
        a: ROOT,
        b: chain(["a-u1", "a-r1"], ["b-u2", "b-r2"]),
        c: chain(["a-u1", "a-r1"], ["b-u2", "b-r2"], ["c-u3", "c-r3"]),
      },
    });

    const plan = buildComparePlan(graph, "a", "c");
    expect(plan?.anchor.id).toBe("a:a-u1");
    expect(ids(plan?.left)).toEqual(["a:a-u2", "a:a-u3"]);
    // The path to c passes through b's own turn — attributed to b, not c.
    expect(ids(plan?.right)).toEqual(["b:b-u2", "c:c-u3"]);
    expect(plan?.right.map((n) => n.sessionId)).toEqual(["b", "c"]);
  });

  it("drops the stub of a turn-less branch from the columns", () => {
    const graph = buildTurnGraph({
      sessions: [session("a"), session("b", { origin: "fork", createdAt: 500 })],
      lineage: { b: fork("a", "a-u1") },
      messages: { a: ROOT, b: [] },
    });

    const plan = buildComparePlan(graph, "a", "b");
    expect(plan?.anchor.id).toBe("a:a-u1");
    expect(plan?.right).toEqual([]);
    expect(ids(plan?.left)).toEqual(["a:a-u2", "a:a-u3"]);
  });

  it("returns null for the same session twice", () => {
    const graph = buildTurnGraph({
      sessions: [session("a")],
      lineage: {},
      messages: { a: ROOT },
    });
    expect(buildComparePlan(graph, "a", "a")).toBeNull();
  });

  it("returns null when the two chains never meet (different stories)", () => {
    const graph = buildTurnGraph({
      sessions: [session("a"), session("d")],
      lineage: {},
      messages: { a: ROOT, d: chain(["d-u1", "d-r1"]) },
    });
    expect(buildComparePlan(graph, "a", "d")).toBeNull();
  });
});
