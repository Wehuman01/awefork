import { describe, expect, it } from "vitest";
import {
  CMD_NOT_FOUND_EXIT_CODE,
  isCmdNotFound,
  missingCliMessage,
} from "../src/main/missing-cli.js";

describe("missing-cli", () => {
  it("recognizes cmd.exe's command-not-found exit code", () => {
    expect(CMD_NOT_FOUND_EXIT_CODE).toBe(9009);
    expect(isCmdNotFound(9009)).toBe(true);
  });

  it("does not mistake other exit codes for a missing CLI", () => {
    expect(isCmdNotFound(0)).toBe(false);
    expect(isCmdNotFound(1)).toBe(false);
    expect(isCmdNotFound(null)).toBe(false);
    expect(isCmdNotFound(undefined)).toBe(false);
  });

  it("words the message with an ENOENT token so the registry's early abort fires", () => {
    const message = missingCliMessage(
      "codex app-server",
      "Install it with: npm i -g @openai/codex",
    );
    expect(message).toContain("ENOENT");
    expect(message).toContain("codex app-server");
    expect(message).toContain("9009");
    expect(message).toContain("npm i -g @openai/codex");
  });
});
