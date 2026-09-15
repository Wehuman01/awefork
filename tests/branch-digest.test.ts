import { describe, expect, it } from "vitest";
import { buildBranchDigests } from "../src/shared/branch-digest";
import { buildTurnGraph } from "../src/shared/canvas-graph";
import type { ChatMessage, ForkRecord, SessionSummary } from "../src/shared/types";

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

function msg(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return {
    id,
    role,
    text,
    toolNames: [],
    modelId: role === "assistant" ? "fake/model" : null,
    providerId: role === "assistant" ? "oc-fake" : null,
    variant: null,
    attachmentNames: [],
    createdAt: 1000,
    completedAt: role === "assistant" ? 1100 : null,
    outputTokens: role === "assistant" ? 500 : null,
    error: null,
  };
}

/** Root a (2 turns) with fork b after a-u1 (1 own turn) and empty fork c. */
function story() {
  const sessions = [
    session("a", { title: "主线", createdAt: 100, updatedAt: 800 }),
    session("b", { title: "JWT 路线", origin: "fork", createdAt: 500, updatedAt: 900 }),
    session("c", { title: "空分支", origin: "fork", createdAt: 600, updatedAt: 600 }),
  ];
  const lineage: Record<string, ForkRecord> = {
    b: { parentId: "a", atMessageId: "a-u1", createdAt: 500 },
    c: { parentId: "a", atMessageId: null, createdAt: 600 },
  };
  const messages: Record<string, ChatMessage[]> = {
    a: [
      msg("a-u1", "user", "第一个问题"),
      msg("a-u1-r", "assistant", "第一个回答"),
      msg("a-u2", "user", "第二个问题"),
      msg("a-u2-r", "assistant", "第二个回答"),
    ],
    b: [
      msg("a-u1", "user", "第一个问题"),
      msg("a-u1-r", "assistant", "第一个回答"),
      msg("b-u2", "user", "JWT 怎么做"),
      msg("b-u2-r", "assistant", "这样这样做"),
    ],
    c: [
      msg("a-u1", "user", "第一个问题"),
      msg("a-u1-r", "assistant", "第一个回答"),
      msg("a-u2", "user", "第二个问题"),
      msg("a-u2-r", "assistant", "第二个回答"),
    ],
  };
  return { sessions, lineage, messages };
}

describe("buildBranchDigests", () => {
  it("summarizes each session on the canvas: own turns, tokens, last activity", () => {
    const { sessions, lineage, messages } = story();
    const graph = buildTurnGraph({ sessions, lineage, messages });
    const digests = buildBranchDigests(graph, sessions, lineage);

    expect(digests.map((d) => d.sessionId)).toEqual(["a", "b", "c"]);
    const a = digests[0];
    const b = digests[1];
    const c = digests[2];
    expect(a?.turnCount).toBe(2);
    expect(a?.outputTokens).toBe(1000);
    expect(a?.lastTurnTitle).toBe("第二个问题");
    expect(a?.forkedFrom).toBeNull();
    // b inherited a's prefix — only its own turn counts
    expect(b?.turnCount).toBe(1);
    expect(b?.lastTurnTitle).toBe("JWT 怎么做");
    // c forked at latest state: nothing of its own, stub only
    expect(c?.turnCount).toBe(0);
    expect(c?.lastTurnTitle).toBe("");
    expect(c?.jumpNodeId).toBe("c::stub");
  });

  it("records where each fork split off, by turn title when recorded", () => {
    const { sessions, lineage, messages } = story();
    const graph = buildTurnGraph({ sessions, lineage, messages });
    const b = buildBranchDigests(graph, sessions, lineage).find((d) => d.sessionId === "b");

    expect(b?.forkedFrom).toEqual({
      sessionId: "a",
      sessionTitle: "主线",
      turnTitle: "第一个问题",
    });
  });

  it("falls back to the parent's last node when the fork recorded no turn", () => {
    const { sessions, lineage, messages } = story();
    const graph = buildTurnGraph({ sessions, lineage, messages });
    const c = buildBranchDigests(graph, sessions, lineage).find((d) => d.sessionId === "c");

    expect(c?.forkedFrom?.turnTitle).toBe("第二个问题");
  });

  it("flags branches with a failed run and drops lineage pointing outside the story", () => {
    const sessions = [
      session("a"),
      session("b", { origin: "fork", createdAt: 500, updatedAt: 700 }),
    ];
    const lineage: Record<string, ForkRecord> = {
      b: { parentId: "ghost", atMessageId: null, createdAt: 500 },
    };
    const messages: Record<string, ChatMessage[]> = {
      a: [
        msg("a-u1", "user", "问"),
        { ...msg("a-u1-r", "assistant", ""), error: "provider quota exceeded" },
      ],
      b: [msg("b-u1", "user", "问"), msg("b-u1-r", "assistant", "答")],
    };
    const graph = buildTurnGraph({ sessions, lineage, messages });
    const digests = buildBranchDigests(graph, sessions, lineage);

    expect(digests.find((d) => d.sessionId === "a")?.hasError).toBe(true);
    // ghost parent is not on the canvas — the fork digests as a root
    expect(digests.find((d) => d.sessionId === "b")?.forkedFrom).toBeNull();
  });

  it("numbers retries: siblings off one fork point repeating the same prompt", () => {
    // a's turn failed twice; each retry grew a fork carrying the same prompt.
    // b3 explores a different prompt off the same turn — never an attempt.
    const sessions = [
      session("a", { title: "主线" }),
      session("b1", { origin: "fork", createdAt: 500, updatedAt: 800 }),
      session("b2", { origin: "fork", createdAt: 600, updatedAt: 900 }),
      session("b3", { origin: "fork", createdAt: 700, updatedAt: 950 }),
    ];
    const lineage: Record<string, ForkRecord> = {
      b1: { parentId: "a", atMessageId: "a-u1", createdAt: 500 },
      b2: { parentId: "a", atMessageId: "a-u1", createdAt: 600 },
      b3: { parentId: "a", atMessageId: "a-u1", createdAt: 700 },
    };
    const prefix = [msg("a-u1", "user", "修一下登录"), msg("a-u1-r", "assistant", "好")];
    const messages: Record<string, ChatMessage[]> = {
      a: prefix,
      b1: [...prefix, msg("b1-u", "user", "修一下登录"), msg("b1-r", "assistant", "再试一次")],
      b2: [...prefix, msg("b2-u", "user", "修一下登录"), msg("b2-r", "assistant", "这次好了")],
      b3: [...prefix, msg("b3-u", "user", "换个思路"), msg("b3-r", "assistant", "也行")],
    };
    const graph = buildTurnGraph({ sessions, lineage, messages });
    const digests = buildBranchDigests(graph, sessions, lineage);
    const byId = new Map(digests.map((d) => [d.sessionId, d]));

    expect(byId.get("b1")?.attempt).toBe(1);
    expect(byId.get("b2")?.attempt).toBe(2);
    expect(byId.get("b3")?.attempt).toBeNull();
    expect(byId.get("a")?.attempt).toBeNull();
  });

  it("a lone fork of its prompt stays unlabeled", () => {
    const sessions = [session("a"), session("b", { origin: "fork", createdAt: 500 })];
    const lineage: Record<string, ForkRecord> = {
      b: { parentId: "a", atMessageId: "a-u1", createdAt: 500 },
    };
    const messages: Record<string, ChatMessage[]> = {
      a: [msg("a-u1", "user", "问"), msg("a-u1-r", "assistant", "答")],
      b: [
        msg("a-u1", "user", "问"),
        msg("a-u1-r", "assistant", "答"),
        msg("b-u", "user", "问"),
        msg("b-r", "assistant", "答"),
      ],
    };
    const graph = buildTurnGraph({ sessions, lineage, messages });

    expect(
      buildBranchDigests(graph, sessions, lineage).find((d) => d.sessionId === "b")?.attempt,
    ).toBeNull();
  });
});
