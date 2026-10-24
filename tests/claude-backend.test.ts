import { describe, expect, it, vi } from "vitest";
import { BACKEND_LABELS, backendCapabilities, isBackendId } from "../src/shared/backend";

/**
 * The claude backend's switcher + capability surface. The adapter's protocol
 * behaviour lives in claude-adapter.test.ts; this file pins the facts the
 * renderer gates affordances on.
 */
describe("claudecode backend identity", () => {
  it("is a known backend with a label", () => {
    expect(isBackendId("claudecode")).toBe(true);
    expect(BACKEND_LABELS.claudecode).toBe("claude code");
  });

  it("still rejects unknown ids", () => {
    expect(isBackendId("claude")).toBe(false);
    expect(isBackendId("")).toBe(false);
  });
});

describe("claudecode capabilities", () => {
  const caps = backendCapabilities("claudecode");

  it("offers the surfaces the CLI can actually drive", () => {
    expect(caps).toEqual({
      deleteMessage: false,
      deleteSession: false,
      attachments: true,
      fileChanges: false,
      compress: true,
      exportBranch: true,
    });
  });

  it("has no message or session delete, matching the CLI's primitives", () => {
    // The renderer hides both affordances instead of surfacing a click error.
    expect(caps.deleteMessage).toBe(false);
    expect(caps.deleteSession).toBe(false);
  });

  it("offers a detached export because the fork linkage is awefork's", () => {
    // --fork-session copies the whole history and records no parent, so the
    // lineage sidecar owns the branch and can drop it for a plain copy.
    expect(caps.exportBranch).toBe(true);
  });

  it("offers compaction through the /compact slash command", () => {
    expect(caps.compress).toBe(true);
  });

  it("accepts image attachments", () => {
    expect(caps.attachments).toBe(true);
  });
});
