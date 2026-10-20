import { describe, expect, it } from "vitest";
import { agentFromHash } from "../src/renderer/src/state";

/**
 * The agent window's `#agent=<id>` marker: it decides which backend a fresh
 * window boots into, and whether the switcher routes picks to windows. Bad
 * markers must read as null — the main window's behavior — never wedge boot.
 */
describe("agentFromHash", () => {
  it("reads the agent a dedicated window was opened for", () => {
    expect(agentFromHash("#agent=codex")).toBe("codex");
    expect(agentFromHash("#agent=opencode")).toBe("opencode");
  });

  it("tolerates a marker packed with other params", () => {
    expect(agentFromHash("#x=1&agent=zcode")).toBe("zcode");
  });

  it("reads null on the main window and on unknown agents", () => {
    expect(agentFromHash("")).toBeNull();
    expect(agentFromHash("#")).toBeNull();
    expect(agentFromHash("#session=abc")).toBeNull();
    expect(agentFromHash("#agent=nope")).toBeNull();
    expect(agentFromHash("#agent=")).toBeNull();
  });
});
