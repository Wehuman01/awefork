import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryKind } from "../src/renderer/src/history";

// The history module is a run-scoped singleton, so every test grabs a fresh
// instance via vi.resetModules + dynamic import. It has no window dependency,
// so this stays a pure unit test of the journal/cursor contract.

function kind(): HistoryKind {
  return "pin";
}

async function boot() {
  vi.resetModules();
  return await import("../src/renderer/src/history");
}

type HistoryMod = Awaited<ReturnType<typeof boot>>;

/** Record one undoable entry with scripted undo/redo closures. */
function recordEntry(
  h: HistoryMod,
  undoImpl: () => Promise<boolean> = async () => true,
  redoImpl: () => Promise<boolean> = async () => true,
) {
  const undo = vi.fn(undoImpl);
  const redo = vi.fn(redoImpl);
  const entry = h.track({
    backend: "codex",
    kind: kind(),
    label: "置顶「会话」",
    undo,
    redo,
  });
  return { entry, undo, redo };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("history journal", () => {
  it("tracks an entry at the tail and undo/redo walk the cursor", async () => {
    const h = await boot();
    const { undo, redo, entry } = recordEntry(h);
    expect(h.history.entries).toHaveLength(1);
    expect(h.history.cursor).toBe(1);
    expect(h.history.entries[0]?.id).toBe(entry.id);

    await h.undoSteps(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(h.history.cursor).toBe(0);

    await h.redoSteps(1);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(h.history.cursor).toBe(1);
  });

  it("undoes multiple entries LIFO, newest first", async () => {
    const h = await boot();
    const a = recordEntry(h, async () => true);
    const b = recordEntry(h, async () => true);
    const c = recordEntry(h, async () => true);
    expect(h.history.cursor).toBe(3);

    await h.undoSteps(2);
    // Newest two undone, in reverse order.
    expect(c.undo).toHaveBeenCalledTimes(1);
    expect(b.undo).toHaveBeenCalledTimes(1);
    expect(a.undo).not.toHaveBeenCalled();
    expect(h.history.cursor).toBe(1);
  });

  it("truncates the redo segment when a fresh op lands after an undo", async () => {
    const h = await boot();
    const a = recordEntry(h);
    const b = recordEntry(h);
    await h.undoSteps(1);
    const keptId = h.history.entries[0]?.id;
    expect(h.history.cursor).toBe(1);

    const c = recordEntry(h); // a new operation truncates the undone entry
    expect(h.history.cursor).toBe(2);
    expect(h.history.entries.map((e) => e.id)).toEqual([keptId, c.entry.id]);
  });

  it("stops the undo walk at a lock entry (toast mentions 锁定)", async () => {
    const h = await boot();
    const first = recordEntry(h);
    h.trackEvent({ backend: "codex", kind: "sendPrompt", label: "发送消息「你好」" });
    expect(h.history.cursor).toBe(2);
    expect(h.history.entries[1]?.undoable).toBe(false);

    const ret = await h.undoSteps(1);
    expect(ret).toBe(false);
    expect(first.undo).not.toHaveBeenCalled();
    expect(h.history.cursor).toBe(2);
    expect(h.history.toast).toContain("锁定");
  });

  it("undoTo walks down to the named entry inclusive; unknown id returns false", async () => {
    const h = await boot();
    const a = recordEntry(h);
    const b = recordEntry(h);
    const c = recordEntry(h);

    const ret = await h.undoTo(a.entry.id);
    expect(ret).toBe(true);
    expect(a.undo).toHaveBeenCalledTimes(1);
    expect(b.undo).toHaveBeenCalledTimes(1);
    expect(c.undo).toHaveBeenCalledTimes(1);
    expect(h.history.cursor).toBe(0);

    const missing = await h.undoTo(9999);
    expect(missing).toBe(false);
  });

  it("redoTo walks the entry from an undone position", async () => {
    const h = await boot();
    const a = recordEntry(h);
    const b = recordEntry(h);
    await h.undoSteps(2);
    expect(h.history.cursor).toBe(0);

    const ret = await h.redoTo(b.entry.id);
    expect(ret).toBe(true);
    expect(b.redo).toHaveBeenCalledTimes(1);
    expect(h.history.cursor).toBe(2);
  });

  it("marks an entry failed and toasts the reason when its undo throws", async () => {
    const h = await boot();
    const { entry } = recordEntry(h, async () => {
      throw new Error("server 500");
    });
    await h.undoSteps(1);
    expect(entry.failed).toBe(true);
    expect(h.history.cursor).toBe(1);
    expect(h.history.toast).toContain("server 500");
  });

  it("stops silently and keeps the entry clean when undo returns false", async () => {
    const h = await boot();
    const { entry } = recordEntry(h, async () => false);
    const ret = await h.undoSteps(1);
    expect(ret).toBe(false);
    expect(entry.failed).toBe(false);
    expect(h.history.cursor).toBe(1);
  });

  it("caps the journal at 200 entries", async () => {
    const h = await boot();
    for (let i = 0; i < 205; i += 1) recordEntry(h);
    expect(h.history.entries).toHaveLength(200);
    expect(h.history.cursor).toBe(200);
  });
});
