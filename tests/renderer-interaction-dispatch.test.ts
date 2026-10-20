import { describe, expect, it } from "vitest";
import {
  countPendingInline,
  pickInlineInteraction,
  pickModalInteraction,
} from "../src/renderer/src/interaction-dispatch";
import type { BackendId } from "../src/shared/backend";
import type { AgentFormField, AgentInteractionRequest } from "../src/shared/types";

/**
 * The dispatch split decides where a queued interaction renders: opencode
 * permission asks for the session on screen go inline at the tail of that
 * session's message flow, everything else keeps the modal. These are the
 * invariants the two components rely on — one request, exactly one surface.
 * Pure helpers, so no store or component mounting is needed.
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
  it("picks the first opencode ask for the selected session", () => {
    const q = queue([permission("a", "s2"), permission("b", "s1"), permission("c", "s1")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("b");
  });

  it("ignores codex approvals and asks for other sessions", () => {
    const q = queue([commandApproval("x", "s1"), permission("b", "s2")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
  });

  it("never picks an ask whose sessionId is null (nothing to attach it to)", () => {
    const q = queue([permission("a", null)]);

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickModalInteraction(BACKEND, q, "s1")?.requestId).toBe("a");
  });

  it("never matches an empty-string sessionId against a real selection", () => {
    const q = queue([permission("a", "")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickInlineInteraction(BACKEND, q, "")).toBeNull();
    expect(pickModalInteraction(BACKEND, q, "s1")?.requestId).toBe("a");
  });

  it("returns null when no session is selected", () => {
    const q = queue([permission("a", "s1")]);

    expect(pickInlineInteraction(BACKEND, q, null)).toBeNull();
    expect(pickModalInteraction(BACKEND, q, null)?.requestId).toBe("a");
  });

  it("ignores requests parked on another backend", () => {
    const q: Queue = { codex: [], opencode: [permission("a", "s1")] };

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickInlineInteraction("opencode", q, "s1")?.requestId).toBe("a");
  });

  it("returns null for a backend with no queue at all", () => {
    expect(pickInlineInteraction("opencode", {}, "s1")).toBeNull();
    expect(pickModalInteraction("opencode", {}, "s1")).toBeNull();
  });
});

describe("interaction dispatch — modal fallback", () => {
  it("shows the queue head when the first ask does not belong inline", () => {
    const q = queue([commandApproval("x", "s1"), permission("a", "s1")]);

    expect(pickModalInteraction(BACKEND, q, "s1")?.requestId).toBe("x");
  });

  it("skips inline asks and shows the first non-inline one behind them", () => {
    const q = queue([permission("a", "s1"), permission("b", "s1"), commandApproval("x", "s1")]);

    expect(pickModalInteraction(BACKEND, q, "s1")?.requestId).toBe("x");
  });

  it("parks an opencode ask for another session on neither surface", () => {
    const q = queue([permission("a", "s2")]);

    // The ask waits for its own session's pane; it must not hijack the modal
    // while another session is on screen.
    expect(pickModalInteraction(BACKEND, q, "s1")).toBeNull();
    // With the pane off screen nothing can render inline, so the modal takes it.
    expect(pickModalInteraction(BACKEND, q, "s1", false)?.requestId).toBe("a");
  });

  it("yields nothing to the modal when every ask is inline for the selection", () => {
    const q = queue([permission("a", "s1"), permission("b", "s1")]);

    expect(pickModalInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("a");
  });
});

describe("interaction dispatch — one request, exactly one surface", () => {
  // Every combination the two components can meet: selection, host
  // visibility, mixed kinds and null sessionIds.
  const selections: Array<string | null> = [null, "s1", "s2", ""];
  const hostVisible: boolean[] = [true, false];

  function assertPartitioned(q: Queue, selectedId: string | null, visible: boolean): void {
    const inline = pickInlineInteraction(BACKEND, q, selectedId, visible);
    const modal = pickModalInteraction(BACKEND, q, selectedId, visible);

    // Never both surfaces at once.
    if (inline && modal) expect(inline.requestId).not.toBe(modal.requestId);
    // The inline pick only ever names an ask that truly belongs inline.
    if (inline) {
      expect(visible).toBe(true);
      expect(["opencode-permission", "opencode-form"]).toContain(inline.kind);
      expect(inline.sessionId).toBe(selectedId);
    }
    // Nothing vanishes: the head of the queue is always reachable — on one
    // surface, or parked on another session's pane (renders when selected).
    const head = q.codex?.[0];
    if (!head) return;
    const headInline = inline?.requestId === head.requestId;
    const headModal = modal?.requestId === head.requestId;
    const headParked =
      visible &&
      ["opencode-permission", "opencode-form"].includes(head.kind) &&
      Boolean(head.sessionId) &&
      head.sessionId !== "global" &&
      head.sessionId !== selectedId;
    expect(headInline || headModal || headParked).toBe(true);
  }

  const samples: Queue[] = [
    queue([]),
    queue([permission("a", "s1")]),
    queue([commandApproval("x", "s1")]),
    queue([permission("a", "s1"), commandApproval("x", "s1")]),
    queue([commandApproval("x", "s1"), permission("a", "s1")]),
    queue([permission("a", null), permission("b", "s1")]),
    queue([permission("a", ""), commandApproval("x", "s2")]),
    queue([permission("a", "s2"), permission("b", "s1"), commandApproval("x", "s1")]),
  ];

  for (const selectedId of selections) {
    for (const visible of hostVisible) {
      for (const q of samples) {
        it(`partitions queue for selectedId=${JSON.stringify(selectedId)} hostVisible=${visible} depth=${q.codex?.length ?? 0}`, () => {
          assertPartitioned(q, selectedId, visible);
        });
      }
    }
  }

  it("hands the modal an inline ask when the pane cannot render it", () => {
    const q = queue([permission("a", "s1")]);

    // Pane on screen: the card owns it, the modal stays clear.
    expect(pickInlineInteraction(BACKEND, q, "s1", true)?.requestId).toBe("a");
    expect(pickModalInteraction(BACKEND, q, "s1", true)).toBeNull();

    // Pane off screen (compare mode, no visible session): the ask must not
    // vanish — the modal takes it over.
    expect(pickInlineInteraction(BACKEND, q, "s1", false)).toBeNull();
    expect(pickModalInteraction(BACKEND, q, "s1", false)?.requestId).toBe("a");
  });
});

describe("interaction dispatch — inline queue depth", () => {
  it("counts only further opencode asks for the same session", () => {
    const q = queue([
      permission("a", "s1"),
      commandApproval("x", "s1"),
      permission("b", "s1"),
      permission("c", "s2"),
    ]);

    // One shown + one behind = 1; the codex ask and the other session's ask
    // are not inline waiters.
    expect(countPendingInline(BACKEND, q, "s1")).toBe(1);
    expect(countPendingInline(BACKEND, q, "s2")).toBe(0);
  });

  it("is zero for a single ask, no selection, and a hidden host", () => {
    const q = queue([permission("a", "s1")]);

    expect(countPendingInline(BACKEND, q, "s1")).toBe(0);
    expect(countPendingInline(BACKEND, q, null)).toBe(0);
    expect(countPendingInline(BACKEND, q, "s1", false)).toBe(0);
  });

  it("is zero when nothing in the queue is an inline ask", () => {
    const q = queue([commandApproval("x", "s1"), permission("a", null)]);

    expect(countPendingInline(BACKEND, q, "s1")).toBe(0);
  });
});

describe("interaction dispatch — forms render inline in the context pane", () => {
  it("hoists a form for the selected session inline, not the modal", () => {
    const q = queue([form("f1", "s1")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")?.requestId).toBe("f1");
    expect(pickModalInteraction(BACKEND, q, "s1")).toBeNull();
  });

  it("parks a form for another session instead of showing it in the modal", () => {
    const q = queue([form("f1", "s2")]);

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickModalInteraction(BACKEND, q, "s1")).toBeNull();
  });

  it("keeps a global-session form in the modal (MCP elicitation's hack session)", () => {
    // `sessionID: "global"` is opencode's placeholder for a form with no real
    // session; it must never match a selection that happens to be "global".
    const q = queue([form("f1", "global")]);

    expect(pickInlineInteraction(BACKEND, q, "global")).toBeNull();
    expect(pickModalInteraction(BACKEND, q, "global")?.requestId).toBe("f1");
  });

  it("keeps a null-session form in the modal", () => {
    const q = queue([form("f1", null)]);

    expect(pickInlineInteraction(BACKEND, q, "s1")).toBeNull();
    expect(pickModalInteraction(BACKEND, q, "s1")?.requestId).toBe("f1");
  });

  it("counts a same-session form toward the inline queue depth", () => {
    const q = queue([permission("a", "s1"), form("f1", "s1"), permission("b", "s1")]);

    // Every inline-kind ask for the session queues behind the one on screen.
    expect(countPendingInline(BACKEND, q, "s1")).toBe(2);
  });
});
