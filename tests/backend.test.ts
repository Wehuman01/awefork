import { describe, expect, it } from "vitest";
import { backendCapabilities, isBackendId, resolveStorePath } from "../src/shared/backend";

describe("isBackendId", () => {
  it("accepts the two known backends and rejects everything else", () => {
    expect(isBackendId("opencode")).toBe(true);
    expect(isBackendId("codex")).toBe(true);
    expect(isBackendId("claude")).toBe(false);
    expect(isBackendId("")).toBe(false);
    expect(isBackendId(null)).toBe(false);
    expect(isBackendId(42)).toBe(false);
  });
});

describe("backendCapabilities", () => {
  it("gives opencode the full surface", () => {
    expect(backendCapabilities("opencode")).toEqual({
      deleteMessage: true,
      deleteSession: true,
      attachments: true,
      fileChanges: true,
      compress: true,
      exportBranch: true,
    });
  });

  it("gates codex to no message delete and compaction, but allows attachments", () => {
    expect(backendCapabilities("codex")).toEqual({
      deleteMessage: false,
      deleteSession: true,
      attachments: true,
      fileChanges: false,
      compress: true,
      exportBranch: false,
    });
  });

  it("gives pi compaction and no session delete", () => {
    expect(backendCapabilities("pi")).toEqual({
      deleteMessage: false,
      deleteSession: false,
      attachments: true,
      fileChanges: false,
      compress: true,
      exportBranch: false,
    });
  });

  it("gives zcode session delete through the v4 command channel and compaction", () => {
    expect(backendCapabilities("zcode")).toEqual({
      deleteMessage: false,
      deleteSession: true,
      attachments: false,
      fileChanges: false,
      compress: true,
      exportBranch: false,
    });
  });
});

describe("resolveStorePath", () => {
  it("always uses the suffixed path for codex — never the legacy bare file", () => {
    const exists = () => true; // even when the legacy file exists
    expect(resolveStorePath("/data", "lineage", "codex", exists)).toBe("/data/lineage-codex.json");
  });

  it("keeps opencode on the legacy bare file when only that one exists", () => {
    const existing = new Set(["/data/pins.json"]);
    const exists = (path: string) => existing.has(path);
    expect(resolveStorePath("/data", "pins", "opencode", exists)).toBe("/data/pins.json");
  });

  it("prefers the suffixed opencode file once it exists", () => {
    const existing = new Set(["/data/pins.json", "/data/pins-opencode.json"]);
    const exists = (path: string) => existing.has(path);
    expect(resolveStorePath("/data", "pins", "opencode", exists)).toBe("/data/pins-opencode.json");
  });

  it("writes the suffixed path on a fresh install where neither exists", () => {
    expect(resolveStorePath("/data", "trash", "opencode", () => false)).toBe(
      "/data/trash-opencode.json",
    );
  });

  it("joins without doubling the separator when the dir already ends in one", () => {
    expect(resolveStorePath("/data/", "archive", "codex", () => false)).toBe(
      "/data/archive-codex.json",
    );
    expect(resolveStorePath("", "archive", "codex", () => false)).toBe("archive-codex.json");
  });

  it("joins with the directory's own separator, not a hardcoded slash", () => {
    // A Windows userData path spells its separator with "\"; a hardcoded
    // "/" would give the store files a name that differs from what an older
    // awefork wrote, so the legacy-store lookup could miss a file that is
    // really there. The join follows the directory's own style.
    const path = resolveStorePath(
      "C:\\Users\\peng\\AppData\\Roaming\\awefork",
      "pins",
      "codex",
      () => false,
    );
    expect(path).toBe("C:\\Users\\peng\\AppData\\Roaming\\awefork\\pins-codex.json");
    expect(path).not.toContain("/");
  });
});
