import { describe, expect, it } from "vitest";
import {
  countPendingInline,
  pickInlineInteraction,
} from "../src/renderer/src/interaction-dispatch";
import type { BackendId } from "../src/shared/backend";
import type { AgentFormField, AgentInteractionRequest } from "../src/shared/types";

/**
 * The dispatch decides where a queued interaction renders. There is no global
 * modal: every ask renders inline at the tail of the context pane's message
 * flow — an ask for the session on screen shows there, one parked on another
 * session waits for that session's pane, and a sessionless ask (null, empty,
 * or opencode's "global" placeholder) rides whatever pane is visible. These
 * are the invariants the inline card relies on. Pure helpers, so no store or
 * component mounting is needed.
 */

type Queue = Record<string, AgentInteractionRequest[]>;

function permission(
  requestId: string,
  sessionId: string | null,
  extra: Partial<{ permission: string; patterns: string[]; command: string }> = {},
): AgentInteractionRequest {
  return {
    requestId,
    sessionId,
    kind: "opencode-permission",
    title: "Allow this action?",
    detail: "A bash action matched your ask permission rule.",
    permission: extra.permission ?? "bash",
    patterns: extra.patterns ?? ["rm *"],
    ...(extra.command ? { command: extra.command } : {}),
  };
}

function commandApproval(
  requestId: string,
  sessionId: string | null = "s1",
): AgentInteractionRequest {
  return {
    requestId,
    sessionId,
    kind: "command-approval",
    title: "Allow running the command?",
    detail: "Codex requests to run a command.",
    command: "rm -rf /",
    cwd: "/demo/shop-api",
  };
}

function form(
  requestId: string,
  sessionId: string | null,
  fields: AgentFormField[] = [],
): AgentInteractionRequest {
  return {
    requestId,
    sessionId,
    kind: "opencode-form",
    title: "Your input is needed",
    detail: "opencode needs you to fill in a form to continue.",
    fields,
  };
}

function queue(entries: AgentInteractionRequest[]): Queue {
  return { codex: entries };
}

const BACKEND: BackendId = "codex";

describe("interaction dispatch — inline pick", () => {
  it("picks the first ask for the selected session, any kind", () => {
    const q = queue([permission("a", "s2"), commandApproval("x", "s1"), permission("b", "s1")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("x");
  });

  it("keeps a codex approval inline like every other kind", () => {
    const q = queue([commandApproval("x", "s1")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("x");
  });

  it("parks an ask for another session on neither surface until selected", () => {
    const q = queue([permission("a", "s2")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickInlineInteraction(BACKEND, q, "s2")?.requestId).toBe("a");
  });

  it("adopts a sessionless ask on whatever pane is visible", () => {
    const q = queue([permission("a", null), commandApproval("x", "s2")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("a");
    expect(pickInlineInteraction(BACKEND, q, "s2")?.requestId).toBe("a");
  });

  it("adopts the global placeholder session rather than matching it literally", () => {
    // `sessionID: "global"` is opencode's placeholder for a form with no real
    // session; it must never match a selection that happens to be "global",
    // but with no modal it still renders on the visible pane.
    const q = queue([form("f1", "global")]);

    expect(pickInlineInteraction(BACKEND, q, "global")?.requestId).toBe("f1");
    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("f1");
  });

  it("never matches an empty-string sessionId against a real selection", () => {
    const q = queue([permission("a", "")]);

    expect(pickInlineInteraction(BACKEND, q, "")).toBeNull();
    // Sessionless: renders on any real pane instead of matching "".
    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("a");
  });

  it("renders nothing while the pane is off screen — the ask waits", () => {
    const q = queue([permission("a", "s1"), commandApproval("x", null)]);

    expect(pickInlineInteraction(BACKEND, q, "s1", false)).toBeNull();
    expect(pickInlineInteraction(BACKEND, q, null)).toBeNull();
  });

  it("ignores requests parked on another backend", () => {
    const q: Queue = { codex: [], opencode: [permission("a", "s1")] };

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickInlineInteraction("opencode", q, "s1")?.requestId).toBe("a");
  });

  it("returns null for a backend with no queue at all", () => {
    expect(pickInlineInteraction("opencode", {}, "s1")).toBeNull();
  });
});

describe("interaction dispatch — inline queue depth", () => {
  it("counts every further ask waiting for the same pane", () => {
    const q = queue([
      permission("a", "s1"),
      commandApproval("x", "s1"),
      permission("b", "s1"),
      permission("c", "s2"),
    ]);

    // One shown + two behind for s1 = 2; the other session's ask is not
    // waiting on this pane.
    expect(countPendingInline(BACKEND, q, "s1")).toBe(2);
    expect(countPendingInline(BACKEND, q, "s2")).toBe(0);
  });

  it("counts a sessionless ask toward the visible pane's depth", () => {
    const q = queue([permission("a", "s1"), commandApproval("x", null)]);

    expect(countPendingInline(BACKEND, q, "s1")).toBe(1);
  });

  it("is zero for a single ask, no selection, and a hidden host", () => {
    const q = queue([permission("a", "s1")]);

    expect(countPendingInline(BACKEND, q, "s1")).toBe(0);
    expect(countPendingInline(BACKEND, q, null)).toBe(0);
    expect(countPendingInline(BACKEND, q, "s1", false)).toBe(0);
  });

  it("is zero when every ask is parked on other sessions", () => {
    const q = queue([permission("a", "s2"), commandApproval("x", "s3")]);

    expect(countPendingInline(BACKEND, q, "s1")).toBe(0);
  });
});
