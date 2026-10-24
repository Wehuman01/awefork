import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageLoader, createMessagePublisher } from "../src/renderer/src/message-loader";
import type { ChatMessage } from "../src/shared/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session message requests", () => {
  it("shares a pending read while keeping sessions and backends independent", async () => {
    const pending = deferred<ChatMessage[]>();
    const fetch = vi.fn(() => pending.promise);
    const publish = vi.fn();
    const loader = createMessageLoader({ fetch, publish });
    const first = loader.load("codex", "s1");
    expect(loader.load("codex", "s1")).toBe(first);
    const otherSession = loader.load("codex", "s2");
    const otherBackend = loader.load("opencode", "s1");
    expect(fetch).toHaveBeenCalledTimes(3);
    pending.resolve([]);
    await Promise.all([first, otherSession, otherBackend]);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("queues one fresh read after a pre-completion poll instead of reusing its snapshot", async () => {
    const old = deferred<ChatMessage[]>();
    const final = deferred<ChatMessage[]>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(final.promise);
    const loader = createMessageLoader({ fetch, publish: vi.fn() });
    const poll = loader.load("codex", "s1");
    const finish = loader.load("codex", "s1", true);
    expect(loader.load("codex", "s1", true)).toBe(finish);
    expect(loader.load("codex", "s1")).toBe(finish);
    expect(fetch).toHaveBeenCalledTimes(1);
    old.resolve([]);
    await poll;
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    const rows = [{ id: "final" }] as ChatMessage[];
    final.resolve(rows);
    expect(await finish).toBe(rows);
  });

  it("requests another snapshot when a new force refresh arrives after the queued read started", async () => {
    const first = deferred<ChatMessage[]>();
    const second = deferred<ChatMessage[]>();
    const third = deferred<ChatMessage[]>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const loader = createMessageLoader({ fetch, publish: vi.fn() });
    const initial = loader.load("codex", "s1");
    const refresh = loader.load("codex", "s1", true);
    first.resolve([]);
    await initial;
    await Promise.resolve();
    const newer = loader.load("codex", "s1", true);
    expect(newer).not.toBe(refresh);
    second.resolve([]);
    await refresh;
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(3);
    third.resolve([]);
    await newer;
  });

  it("still runs a queued force refresh after the earlier request fails", async () => {
    const pending = deferred<ChatMessage[]>();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const loader = createMessageLoader({ fetch, publish: vi.fn() });
    const poll = loader.load("codex", "s1");
    const rejection = expect(poll).rejects.toThrow("offline");
    const refresh = loader.load("codex", "s1", true);
    pending.reject(new Error("offline"));
    await rejection;
    expect(await refresh).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not publish a snapshot started before a local send or deletion", async () => {
    const pending = deferred<ChatMessage[]>();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const publish = vi.fn();
    const loader = createMessageLoader({ fetch, publish });
    const oldGeneration = loader.generation("codex", "s1");
    const old = loader.load("codex", "s1");
    loader.invalidate("codex", "s1");
    pending.resolve([]);
    await old;
    expect(publish).not.toHaveBeenCalled();
    expect(loader.generation("codex", "s1")).toBeGreaterThan(oldGeneration);
    await loader.load("codex", "s1");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("makes a new run's poll wait for a fresh snapshot when an older read is still pending", async () => {
    const pending = deferred<ChatMessage[]>();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const publish = vi.fn();
    const loader = createMessageLoader({ fetch, publish });
    const old = loader.load("codex", "s1");
    loader.invalidate("codex", "s1");
    const current = loader.load("codex", "s1");
    expect(current).not.toBe(old);
    pending.resolve([]);
    await current;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("message publication", () => {
  it("publishes independent replies in one frame and resolves reads only after applying them", async () => {
    let frame!: FrameRequestCallback;
    const raf = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const apply = vi.fn();
    const publish = createMessagePublisher({ apply, generation: () => 0 });
    const loader = createMessageLoader({ fetch: async () => [], publish });
    let resolved = false;
    const first = loader.load("codex", "s1").then(() => {
      resolved = true;
    });
    const second = loader.load("codex", "s2");
    await Promise.resolve();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(resolved).toBe(false);
    frame(0);
    await Promise.all([first, second]);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(resolved).toBe(true);
  });

  it("drops a queued publication superseded by a local send", async () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let generation = 0;
    const apply = vi.fn();
    const publish = createMessagePublisher({ apply, generation: () => generation });
    const old = publish("codex", "s1", []);
    generation++;
    frame(0);
    await old;
    expect(apply).not.toHaveBeenCalled();
  });

  it("flushes on a timer when a hidden window stops producing animation frames", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const apply = vi.fn();
    const publish = createMessagePublisher({ apply, generation: () => 0 });
    const pending = publish("codex", "s1", []);
    await vi.advanceTimersByTimeAsync(32);
    await pending;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(1);
  });
});
