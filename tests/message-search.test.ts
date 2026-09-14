import { describe, expect, it } from "vitest";
import {
  createMessageSearcher,
  FETCH_POOL,
  MAX_HIT_SESSIONS,
  MAX_HITS_PER_SESSION,
  type SessionSearchTarget,
} from "../src/main/message-search";
import type { AgentAdapter, ChatMessage } from "../src/shared/types";

function message(id: string, text: string, toolNames: string[] = []): ChatMessage {
  return {
    id,
    role: text === "" ? "assistant" : "user",
    text,
    thinking: "",
    toolNames,
    modelId: null,
    providerId: null,
    variant: null,
    attachmentNames: [],
    createdAt: 0,
    completedAt: 1,
    error: null,
  } as ChatMessage;
}

function adapterWith(
  bodies: Record<string, ChatMessage[]>,
  calls: string[] = [],
  delayMs = 0,
): AgentAdapter {
  return {
    kind: "test",
    listSessions: async () => [],
    messages: async (sessionId: string) => {
      calls.push(sessionId);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const body = bodies[sessionId];
      if (body === undefined) throw new Error("no such session");
      return body;
    },
  } as unknown as AgentAdapter;
}

const target = (id: string, updatedAt = 1): SessionSearchTarget => ({ id, updatedAt });

describe("message searcher", () => {
  it("matches a session whose terms sit in different messages", async () => {
    const adapter = adapterWith({
      s1: [message("m1", "429 之后重试"), message("m2", "三次仍然失败")],
      s2: [message("m1", "完全不相关")],
    });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1"), target("s2")], {
      terms: ["重试", "失败"],
      excludes: [],
    });
    // Two terms, two matching messages — one snippet row each.
    expect(result.hits.map((hit) => hit.sessionId)).toEqual(["s1", "s1"]);
    expect(result.hits.map((hit) => hit.messageId)).toEqual(["m1", "m2"]);
    expect(result.scanned).toBe(2);
  });

  it("searches tool names and highlights the matching surface", async () => {
    const adapter = adapterWith({ s1: [message("m1", "", ["web_search", "edit"])] });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1")], { terms: ["edit"], excludes: [] });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.snippet).toContain("edit");
    expect(result.hits[0]?.messageId).toBe("m1");
  });

  it("reports body exclusions separately so they veto the session", async () => {
    const adapter = adapterWith({ s1: [message("m1", "重试 登录")] });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1")], { terms: ["重试"], excludes: ["登录"] });
    expect(result.hits).toEqual([]);
    expect(result.excludedSessionIds).toEqual(["s1"]);
  });

  it("reuses cached bodies until updatedAt moves", async () => {
    const calls: string[] = [];
    const adapter = adapterWith({ s1: [message("m1", "重试")] }, calls);
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const request = { terms: ["重试"], excludes: [] };
    await searcher.search([target("s1", 1)], request);
    await searcher.search([target("s1", 1)], request);
    expect(calls).toEqual(["s1"]);
    await searcher.search([target("s1", 2)], request);
    expect(calls).toEqual(["s1", "s1"]);
  });

  it("skips unreadable sessions instead of failing the scan", async () => {
    const adapter = adapterWith({ s1: [message("m1", "重试")] });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("gone"), target("s1")], {
      terms: ["重试"],
      excludes: [],
    });
    expect(result.scanned).toBe(1);
    expect(result.hits.map((hit) => hit.sessionId)).toEqual(["s1"]);
  });

  it("caps snippet rows per session at two", async () => {
    const adapter = adapterWith({
      s1: [
        message("m1", "重试 one"),
        message("m2", "重试 two"),
        message("m3", "重试 three"),
        message("m4", "重试 four"),
      ],
    });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1")], { terms: ["重试"], excludes: [] });
    expect(result.hits).toHaveLength(MAX_HITS_PER_SESSION);
  });

  it("matches terms case-insensitively and highlights the right span", async () => {
    const adapter = adapterWith({
      s1: [message("m1", "推荐用 Neon + Vercel 部署网站")],
    });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1")], { terms: ["neon"], excludes: [] });
    expect(result.hits).toHaveLength(1);
    // The snippet must surface the original-case "Neon", and the highlight
    // span must land on those four characters, not somewhere else.
    const hit = result.hits[0]!;
    expect(hit.snippet).toContain("Neon");
    expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe("Neon");
  });

  it("treats uppercase excludes the same as lowercase", async () => {
    const adapter = adapterWith({ s1: [message("m1", "I mentioned Neon yesterday")] });
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1")], {
      terms: ["yesterday"],
      excludes: ["neon"],
    });
    expect(result.hits).toEqual([]);
    expect(result.excludedSessionIds).toEqual(["s1"]);
  });

  it("does nothing without terms or excludes", async () => {
    const calls: string[] = [];
    const adapter = adapterWith({}, calls);
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search([target("s1")], { terms: [], excludes: [] });
    expect(result).toEqual({ hits: [], excludedSessionIds: [], scanned: 0 });
    expect(calls).toEqual([]);
  });

  it("keeps the whole default-size scan cached between searches", async () => {
    // The renderer's default limit is 1000 sessions; the cache must hold
    // them all or every keystroke refetches the overflow (the old wholesale
    // clear at 800 entries did exactly that).
    const calls: string[] = [];
    const bodies: Record<string, ChatMessage[]> = {};
    const targets: SessionSearchTarget[] = [];
    for (let i = 0; i < 1000; i++) {
      bodies[`s${i}`] = [message(`m${i}`, i % 20 === 0 ? "提到 靶子" : "完全无关的正文")];
      targets.push(target(`s${i}`));
    }
    const adapter = adapterWith(bodies, calls);
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const request = { terms: ["靶子"], excludes: [] };
    await searcher.search(targets, request);
    expect(calls).toHaveLength(1000);
    await searcher.search(targets, request);
    expect(calls).toHaveLength(1000);
  });

  it("stops fetching once the hit quota fills when there are no exclusions", async () => {
    const calls: string[] = [];
    const bodies: Record<string, ChatMessage[]> = {};
    const targets: SessionSearchTarget[] = [];
    for (let i = 0; i < 100; i++) {
      bodies[`s${i}`] = [message(`m${i}a`, "重试 one"), message(`m${i}b`, "重试 two")];
      targets.push(target(`s${i}`));
    }
    const adapter = adapterWith(bodies, calls);
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search(targets, { terms: ["重试"], excludes: [] });
    // The quota plus at most one pool's worth of in-flight overshoot — not
    // the full 100 sessions.
    expect(calls.length).toBeGreaterThanOrEqual(MAX_HIT_SESSIONS);
    expect(calls.length).toBeLessThanOrEqual(MAX_HIT_SESSIONS + FETCH_POOL);
    expect(result.scanned).toBe(calls.length);
    // The newest sessions win the quota, deterministically.
    expect(result.hits).toHaveLength(MAX_HIT_SESSIONS * MAX_HITS_PER_SESSION);
    expect([...new Set(result.hits.map((hit) => hit.sessionId))]).toEqual(
      targets.slice(0, MAX_HIT_SESSIONS).map((t) => t.id),
    );
  });

  it("still scans every target when an exclusion is set", async () => {
    const calls: string[] = [];
    const bodies: Record<string, ChatMessage[]> = {};
    const targets: SessionSearchTarget[] = [];
    for (let i = 0; i < 100; i++) {
      bodies[`s${i}`] = [message(`m${i}`, "重试 正文")];
      targets.push(target(`s${i}`));
    }
    const adapter = adapterWith(bodies, calls);
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const result = await searcher.search(targets, { terms: ["重试"], excludes: ["永不出现"] });
    expect(calls).toHaveLength(100);
    expect(result.scanned).toBe(100);
    expect(result.excludedSessionIds).toEqual([]);
    expect(new Set(result.hits.map((hit) => hit.sessionId)).size).toBe(MAX_HIT_SESSIONS);
  });

  it("shares in-flight fetches between overlapping searches", async () => {
    // A keystroke or the churn watcher can start a second scan while the
    // first is still fetching; both must share one fetch per session.
    const calls: string[] = [];
    const bodies: Record<string, ChatMessage[]> = {};
    const targets: SessionSearchTarget[] = [];
    for (let i = 0; i < 20; i++) {
      bodies[`s${i}`] = [message(`m${i}`, "重试 正文")];
      targets.push(target(`s${i}`));
    }
    const adapter = adapterWith(bodies, calls, 5);
    const searcher = createMessageSearcher(() => Promise.resolve(adapter));
    const request = { terms: ["重试"], excludes: [] };
    const [first, second] = await Promise.all([
      searcher.search(targets, request),
      searcher.search(targets, request),
    ]);
    expect(calls).toHaveLength(20);
    expect(new Set(calls).size).toBe(20);
    expect(second.hits).toEqual(first.hits);
  });
});
