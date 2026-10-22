import { describe, expect, it } from "vitest";
import {
  compareOverviewRows,
  loadOverviewLedger,
  markOverviewSeen,
  matchesOverviewAgent,
  matchesOverviewFilter,
  matchesOverviewQuery,
  type OverviewReadLedger,
  type OverviewRow,
  overviewCounts,
  overviewKey,
  projectOf,
  projectOverviewStatus,
  pruneOverviewLedger,
  recordOverviewSettle,
  saveOverviewLedger,
  summarizeMessages,
} from "../src/renderer/src/session-overview";
import type { BackendId } from "../src/shared/backend";
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
});

describe("unread persistence", () => {
  function memoryStorage(seed: Record<string, string> = {}) {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      map,
    };
  }

  it("round-trips a ledger through storage", () => {
    const storage = memoryStorage();
    (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
    try {
      const ledger = recordOverviewSettle({}, overviewKey("codex", "s1"), {
        settledAt: 42,
        failed: false,
      });
      saveOverviewLedger(ledger);
      expect(loadOverviewLedger()).toEqual(ledger);
    } finally {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    }
  });

  it("drops malformed entries instead of trusting them", () => {
    const storage = memoryStorage({
      "awefork:overview-read": JSON.stringify({
        "codex:good": { revision: 2, seen: 1, settledAt: 5, failed: false },
        "codex:junk": { revision: "many", seen: 1, settledAt: 5 },
        "codex:negative": { revision: -1, seen: 0, settledAt: 5 },
        "codex:seenAhead": { revision: 2, seen: 9, settledAt: 5, failed: true },
        "codex:notAnObject": 7,
      }),
    });
    (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
    try {
      const ledger = loadOverviewLedger();
      expect(Object.keys(ledger).sort()).toEqual(["codex:good", "codex:seenAhead"]);
      // A seen watermark past the revision is clamped, never left impossible.
      expect(ledger["codex:seenAhead"]?.seen).toBe(2);
      expect(ledger["codex:seenAhead"]?.failed).toBe(true);
    } finally {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    }
  });

  it("survives an unreadable store", () => {
    const storage = memoryStorage({ "awefork:overview-read": "{not json" });
    (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
    try {
      expect(loadOverviewLedger()).toEqual({});
    } finally {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
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
