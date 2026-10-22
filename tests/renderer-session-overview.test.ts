import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareOverviewRows,
  markOverviewSeen,
  matchesOverviewAgent,
  matchesOverviewFilter,
  matchesOverviewQuery,
  mergeOverviewLedger,
  type OverviewReadLedger,
  type OverviewRow,
  overviewCounts,
  overviewKey,
  projectOf,
  projectOverviewStatus,
  pruneOverviewLedger,
  recordOverviewSettle,
  summarizeMessages,
} from "../src/renderer/src/session-overview";
import type { BackendId } from "../src/shared/backend";
import { OverviewLedgerStore, readOverviewLedger } from "../src/shared/overview-ledger";
import type { SessionSummary } from "../src/shared/types";

/**
 * The session overview's projection rules, exercised without a store, a server
 * or a DOM. These are the invariants the panel and the trigger both trust: a
 * status only claims what awefork actually observed, and a seen watermark only
 * ever advances to a revision the user was really shown.
 */

function session(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    title: `会话 ${id}`,
    directory: "/Users/peng/Project/awefork",
    parentSessionId: null,
    origin: "root",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...extra,
  };
}

function row(
  backend: BackendId,
  id: string,
  status: OverviewRow["status"],
  activityAt = 0,
): OverviewRow {
  return { backend, session: session(id), status, pending: 0, activityAt };
}

describe("overview status projection", () => {
  it("lets a queued ask outrank a live run", () => {
    expect(
      projectOverviewStatus({
        waiting: true,
        running: true,
        result: { revision: 2, seen: 0, settledAt: 10, failed: false },
        unknown: false,
      }),
    ).toBe("waiting");
  });

  it("prefers the live run over an older unseen result", () => {
    expect(
      projectOverviewStatus({
        waiting: false,
        running: true,
        result: { revision: 2, seen: 0, settledAt: 10, failed: false },
        unknown: false,
      }),
    ).toBe("running");
  });

  it("reports a completed run as unread until its revision is seen", () => {
    const result = { revision: 3, seen: 2, settledAt: 10, failed: false };
    expect(projectOverviewStatus({ waiting: false, running: false, result, unknown: false })).toBe(
      "unread",
    );
    expect(
      projectOverviewStatus({
        waiting: false,
        running: false,
        result: { ...result, seen: 3 },
        unknown: false,
      }),
    ).toBe("read");
  });

  it("calls an explicitly failed run failed until it has been looked at", () => {
    const result = { revision: 1, seen: 0, settledAt: 10, failed: true };
    expect(projectOverviewStatus({ waiting: false, running: false, result, unknown: false })).toBe(
      "failed",
    );
    // Once the user has seen that failure it is history, not a lit badge.
    expect(
      projectOverviewStatus({
        waiting: false,
        running: false,
        result: { ...result, seen: 1 },
        unknown: false,
      }),
    ).toBe("read");
  });

  it("never claims a result for a run that was only observed, never finished", () => {
    expect(
      projectOverviewStatus({
        waiting: false,
        running: false,
        result: null,
        unknown: true,
      }),
    ).toBe("unknown");
  });

  it("treats a session with no evidence at all as idle, not unknown", () => {
    expect(
      projectOverviewStatus({ waiting: false, running: false, result: null, unknown: false }),
    ).toBe("idle");
  });

  it("keeps a lost run unknown even when an older result was already seen", () => {
    expect(
      projectOverviewStatus({
        waiting: false,
        running: false,
        result: { revision: 1, seen: 1, settledAt: 10, failed: false },
        unknown: true,
      }),
    ).toBe("unknown");
  });

  it("still shows an unseen result over a lost connection", () => {
    expect(
      projectOverviewStatus({
        waiting: false,
        running: false,
        result: { revision: 2, seen: 1, settledAt: 10, failed: false },
        unknown: true,
      }),
    ).toBe("unread");
  });
});

describe("overview ordering", () => {
  it("sorts what needs the user first and idle last", () => {
    const rows = [
      row("opencode", "a", "idle", 900),
      row("opencode", "b", "waiting", 100),
      row("opencode", "c", "unread", 500),
      row("opencode", "d", "running", 700),
      row("opencode", "e", "unknown", 300),
      row("opencode", "f", "failed", 200),
      row("opencode", "g", "read", 800),
    ];
    expect([...rows].sort(compareOverviewRows).map((item) => item.session.id)).toEqual([
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "a",
    ]);
  });

  it("breaks ties by the most recent activity", () => {
    const rows = [row("opencode", "old", "waiting", 100), row("codex", "new", "waiting", 500)];
    expect([...rows].sort(compareOverviewRows).map((item) => item.session.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("counts every projected status, including the idle fallback", () => {
    const counts = overviewCounts([
      row("opencode", "a", "waiting"),
      row("opencode", "b", "unread"),
      row("codex", "c", "unread"),
      row("codex", "d", "idle"),
    ]);
    expect(counts.waiting).toBe(1);
    expect(counts.unread).toBe(2);
    expect(counts.idle).toBe(1);
    expect(counts.running).toBe(0);
  });
});

describe("overview filtering", () => {
  const target: OverviewRow = {
    backend: "codex",
    session: session("s1", {
      title: "修复登录后的会话过期",
      directory: "/Users/peng/Project/awefork3",
    }),
    status: "unread",
    pending: 0,
    activityAt: 0,
  };

  it("matches title, project path and agent name", () => {
    expect(matchesOverviewQuery(target, "登录")).toBe(true);
    expect(matchesOverviewQuery(target, "awefork3")).toBe(true);
    expect(matchesOverviewQuery(target, "codex")).toBe(true);
    expect(matchesOverviewQuery(target, "opencode")).toBe(false);
    expect(matchesOverviewQuery(target, "   ")).toBe(true);
  });

  it("filters by tab and by agent", () => {
    expect(matchesOverviewFilter(target, "all")).toBe(true);
    expect(matchesOverviewFilter(target, "unread")).toBe(true);
    expect(matchesOverviewFilter(target, "running")).toBe(false);
    expect(matchesOverviewAgent(target, "all")).toBe(true);
    expect(matchesOverviewAgent(target, "codex")).toBe(true);
    expect(matchesOverviewAgent(target, "opencode")).toBe(false);
  });

  it("shows the project name, not the whole path", () => {
    expect(projectOf("/Users/peng/Project/awefork3")).toBe("awefork3");
    expect(projectOf("/Users/peng/Project/awefork3/")).toBe("awefork3");
    expect(projectOf("C:\\work\\awefork")).toBe("awefork");
    expect(projectOf("/")).toBe("/");
  });
});

describe("unread ledger", () => {
  it("keys a session by backend and native id, never by title", () => {
    expect(overviewKey("codex", "s1")).toBe("codex:s1");
    expect(overviewKey("opencode", "s1")).toBe("opencode:s1");
  });

  it("bumps the revision on each settle and keeps the seen watermark", () => {
    const key = overviewKey("codex", "s1");
    let ledger: OverviewReadLedger = {};
    ledger = recordOverviewSettle(ledger, key, { settledAt: 10, failed: false });
    expect(ledger[key]).toEqual({ revision: 1, seen: 0, settledAt: 10, failed: false });
    ledger = markOverviewSeen(ledger, key);
    expect(ledger[key]?.seen).toBe(1);
    // A second run finishing makes the session unread again.
    ledger = recordOverviewSettle(ledger, key, { settledAt: 20, failed: false });
    expect(ledger[key]).toEqual({ revision: 2, seen: 1, settledAt: 20, failed: false });
  });

  it("does not clear a result that landed after the one the user was shown", () => {
    const key = overviewKey("codex", "s1");
    let ledger = recordOverviewSettle({}, key, { settledAt: 10, failed: false });
    // The user opens the session while revision 1 is what is on screen.
    const shown = ledger[key]?.revision ?? 0;
    // A newer run settles before the click is processed.
    ledger = recordOverviewSettle(ledger, key, { settledAt: 20, failed: false });
    ledger = markOverviewSeen(ledger, key, shown);
    expect(ledger[key]?.seen).toBe(1);
    expect(ledger[key]?.revision).toBe(2);
  });

  it("never advances past the newest revision", () => {
    const key = overviewKey("codex", "s1");
    const ledger = recordOverviewSettle({}, key, { settledAt: 10, failed: false });
    expect(markOverviewSeen(ledger, key, 99)[key]?.seen).toBe(1);
  });

  it("returns the same ledger when there is nothing to mark", () => {
    const key = overviewKey("codex", "s1");
    const ledger = recordOverviewSettle({}, key, { settledAt: 10, failed: false });
    expect(markOverviewSeen(ledger, "codex:missing")).toBe(ledger);
    const seen = markOverviewSeen(ledger, key);
    expect(markOverviewSeen(seen, key)).toBe(seen);
  });

  it("keeps the newest entries only, so the sidecar cannot grow forever", () => {
    let ledger: OverviewReadLedger = {};
    for (let i = 0; i < 320; i += 1) {
      ledger = recordOverviewSettle(ledger, `codex:s${i}`, { settledAt: i, failed: false });
    }
    const pruned = pruneOverviewLedger(ledger);
    expect(Object.keys(pruned)).toHaveLength(300);
    // The oldest ten are the ones dropped.
    expect(pruned["codex:s0"]).toBeUndefined();
    expect(pruned["codex:s319"]).toBeDefined();
  });

  it("merges two windows' copies into the same union, whichever lands second", () => {
    const a = overviewKey("opencode", "a");
    const b = overviewKey("opencode", "b");
    // Window 1 settled a (revision 1) and saw it; window 2 settled a again
    // (revision 2) and b (revision 1) while 1 was offline.
    const left = recordOverviewSettle(
      markOverviewSeen(recordOverviewSettle({}, a, { settledAt: 10, failed: false }), a),
      a,
      {
        settledAt: 30,
        failed: false,
      },
    );
    const right = recordOverviewSettle(
      recordOverviewSettle({}, b, { settledAt: 20, failed: false }),
      a,
      { settledAt: 20, failed: false },
    );
    const forward = mergeOverviewLedger(left, right);
    const backward = mergeOverviewLedger(right, left);
    // Commutative: the union does not depend on which window wrote first.
    expect(forward).toEqual(backward);
    expect(forward[a]).toEqual({ revision: 2, seen: 1, settledAt: 30, failed: false });
    expect(forward[b]).toEqual({ revision: 1, seen: 0, settledAt: 20, failed: false });
  });

  it("lets the newest settle carry the failure flag, in both directions", () => {
    const key = overviewKey("codex", "s1");
    const failedFirst = { [key]: { revision: 2, seen: 0, settledAt: 30, failed: true } };
    const succeededLater = { [key]: { revision: 1, seen: 0, settledAt: 10, failed: false } };
    expect(mergeOverviewLedger(failedFirst, succeededLater)[key]).toEqual({
      revision: 2,
      seen: 0,
      settledAt: 30,
      failed: true,
    });
    expect(mergeOverviewLedger(succeededLater, failedFirst)[key]).toEqual({
      revision: 2,
      seen: 0,
      settledAt: 30,
      failed: true,
    });
  });
});

describe("unread ledger persistence (main-owned sidecar)", () => {
  /** A fresh temp file per test; the store owns the path end to end. */
  function sidecarPath(name: string): string {
    return join(tmpdir(), `overview-read-test-${name}-${randomUUID()}.json`);
  }

  it("round-trips a ledger through the sidecar file", async () => {
    const path = sidecarPath("roundtrip");
    try {
      const store = new OverviewLedgerStore(path);
      const key = overviewKey("codex", "s1");
      const { entry } = await store.recordSettle(key, { settledAt: 42, failed: false });
      expect(entry).toEqual({ revision: 1, seen: 0, settledAt: 42, failed: false });
      // A second store over the same file reads what the first wrote: this is
      // what a restart (and a second window) actually sees.
      const reopened = new OverviewLedgerStore(path);
      expect((await reopened.snapshot()).ledger).toEqual({ [key]: entry });
    } finally {
      await rm(path, { force: true });
    }
  });

  it("keeps an interrupted run unknown after restart and deduplicates a shared settle id", async () => {
    const path = sidecarPath("unknown-and-dedupe");
    const key = overviewKey("codex", "s1");
    try {
      const beforeRestart = new OverviewLedgerStore(path);
      await beforeRestart.setUnknown(key, true, "event-running");
      const afterRestart = new OverviewLedgerStore(path);
      expect((await afterRestart.snapshot()).unknown[key]).toBe("event-running");

      const { entry: first } = await afterRestart.recordSettle(key, {
        settledAt: 42,
        failed: false,
        settleId: "event-running",
      });
      expect((await afterRestart.snapshot()).unknown[key]).toBeUndefined();

      await afterRestart.setUnknown(key, true, "event-next");
      const secondWindow = new OverviewLedgerStore(path);
      const { entry: duplicate, changed } = await secondWindow.recordSettle(key, {
        settledAt: 43,
        failed: false,
        settleId: "event-running",
      });
      expect(changed).toBe(false);
      expect(duplicate.revision).toBe(first.revision);
      expect((await secondWindow.snapshot()).unknown[key]).toBe("event-next");
      expect((await secondWindow.snapshot()).ledger[key]?.settledAt).toBe(42);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("mints a revision for the next launch's first run even after an id restarts", async () => {
    // Regression: main stamps every event with a per-launch counter, so without
    // a launch-scoped prefix the ids read "event-1" again on the next launch.
    // The ledger dedupes a settle id it has already recorded, so the first new
    // run after a restart was swallowed as an already-settled duplicate — its
    // unread result vanished for every window and every restart after it.
    const path = sidecarPath("launch-id-collision");
    const key = overviewKey("codex", "s1");
    try {
      const firstLaunch = new OverviewLedgerStore(path);
      const { entry: launch1 } = await firstLaunch.recordSettle(key, {
        settledAt: 100,
        failed: false,
        settleId: "event-1",
      });
      expect(launch1.revision).toBe(1);

      // Same sidecar, same session, the next launch's first id: it must land
      // as its own revision instead of deduping against the previous launch.
      const secondLaunch = new OverviewLedgerStore(path);
      const { entry: launch2, changed } = await secondLaunch.recordSettle(key, {
        settledAt: 200,
        failed: false,
        settleId: "e7f3c1a9b204-1",
      });
      expect(changed).toBe(true);
      expect(launch2.revision).toBe(2);
      expect(launch2.settledAt).toBe(200);
      // The seen watermark carries over: the new run is unread again.
      expect(launch2.seen).toBe(launch1.seen);

      // The dedupe still does its job: the same settle id arriving twice
      // (a duplicate broadcast of one ending) must not mint a second revision.
      const { entry: duplicate, changed: duplicateChanged } = await secondLaunch.recordSettle(key, {
        settledAt: 300,
        failed: false,
        settleId: "e7f3c1a9b204-1",
      });
      expect(duplicateChanged).toBe(false);
      expect(duplicate.revision).toBe(2);
      expect((await secondLaunch.snapshot()).ledger[key]?.settledAt).toBe(200);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("drops malformed entries instead of trusting them", async () => {
    const path = sidecarPath("malformed");
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          "codex:good": { revision: 2, seen: 1, settledAt: 5, failed: false },
          "codex:junk": { revision: "many", seen: 1, settledAt: 5 },
          "codex:negative": { revision: -1, seen: 0, settledAt: 5 },
          "codex:seenAhead": { revision: 2, seen: 9, settledAt: 5, failed: true },
          "codex:notAnObject": 7,
        }),
      );
      const ledger = await readOverviewLedger(path);
      expect(Object.keys(ledger).sort()).toEqual(["codex:good", "codex:seenAhead"]);
      // A seen watermark past the revision is clamped, never left impossible.
      expect(ledger["codex:seenAhead"]?.seen).toBe(2);
      expect(ledger["codex:seenAhead"]?.failed).toBe(true);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("survives an unreadable sidecar", async () => {
    const path = sidecarPath("corrupt");
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{not json");
      expect(await readOverviewLedger(path)).toEqual({});
      // And the store keeps working over it: the next write replaces the junk.
      const store = new OverviewLedgerStore(path);
      await store.recordSettle("codex:s1", { settledAt: 7, failed: false });
      expect((await store.snapshot()).ledger).toEqual({
        "codex:s1": { revision: 1, seen: 0, settledAt: 7, failed: false },
      });
    } finally {
      await rm(path, { force: true });
    }
  });

  it("merges a window's copy per entry, never wholesale", async () => {
    const path = sidecarPath("merge");
    try {
      const store = new OverviewLedgerStore(path);
      const a = overviewKey("opencode", "a");
      const b = overviewKey("opencode", "b");
      await store.recordSettle(a, { settledAt: 10, failed: false });
      await store.recordSettle(b, { settledAt: 20, failed: false });

      // The window ran ahead offline: a newer revision on a, a brand-new
      // session c, and a seen watermark on b. Nothing may be rolled back.
      const merged = await store.merge({
        [a]: { revision: 3, seen: 3, settledAt: 30, failed: false },
        [overviewKey("opencode", "c")]: { revision: 1, seen: 0, settledAt: 40, failed: true },
        [b]: { revision: 1, seen: 1, settledAt: 15, failed: false },
      });
      expect(merged[a]).toEqual({ revision: 3, seen: 3, settledAt: 30, failed: false });
      expect(merged[b]).toEqual({ revision: 1, seen: 1, settledAt: 20, failed: false });
      expect(merged[overviewKey("opencode", "c")]).toEqual({
        revision: 1,
        seen: 0,
        settledAt: 40,
        failed: true,
      });
    } finally {
      await rm(path, { force: true });
    }
  });

  it("keeps a window's mark-seen from being erased by a stale replay", async () => {
    const path = sidecarPath("seen");
    try {
      const store = new OverviewLedgerStore(path);
      const key = overviewKey("codex", "s1");
      await store.recordSettle(key, { settledAt: 10, failed: false });
      await store.markSeen(key);
      // A window that was offline when the watermark moved replays its older
      // copy: the merge takes the max seen, so the badge stays cleared.
      const merged = await store.merge({
        [key]: { revision: 1, seen: 0, settledAt: 10, failed: false },
      });
      expect(merged[key]?.seen).toBe(1);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("reports whether a forgotten session existed", async () => {
    const path = sidecarPath("forget");
    try {
      const store = new OverviewLedgerStore(path);
      const key = overviewKey("codex", "s1");
      await store.recordSettle(key, { settledAt: 10, failed: false });
      expect(await store.forget(key)).toBe(true);
      expect(await store.forget(key)).toBe(false);
      expect((await store.snapshot()).ledger).toEqual({});
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("summary extraction", () => {
  it("takes the last prompt and the last reply with text", () => {
    const summary = summarizeMessages([
      { role: "user", text: "第一个问题" },
      { role: "assistant", text: "第一个回答" },
      { role: "user", text: "第二个问题" },
      { role: "assistant", text: "   " },
      { role: "assistant", text: "第二个回答" },
    ]);
    expect(summary).toEqual({ prompt: "第二个问题", reply: "第二个回答" });
  });

  it("stays empty for an empty session", () => {
    expect(summarizeMessages([])).toEqual({ prompt: "", reply: "" });
  });
});
