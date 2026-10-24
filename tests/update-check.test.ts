import { describe, expect, it } from "vitest";
import {
  hasPlatformInstaller,
  isNewerVersion,
  normalizeVersion,
  updateAssetFilename,
  updateAssetUrl,
} from "../src/main/update-check";

describe("normalizeVersion", () => {
  it("keeps a plain x.y.z version", () => {
    expect(normalizeVersion("0.1.7")).toBe("0.1.7");
    expect(normalizeVersion("1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("10.20.300")).toBe("10.20.300");
  });

  it("strips a leading v from tags", () => {
    expect(normalizeVersion("v0.1.7")).toBe("0.1.7");
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
  });

  it("rejects malformed versions", () => {
    expect(normalizeVersion("0.1")).toBeNull();
    expect(normalizeVersion("0.1.6.1")).toBeNull();
    expect(normalizeVersion("0.1.7-beta")).toBeNull();
    expect(normalizeVersion("abc")).toBeNull();
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("v")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion(undefined)).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("is true when the candidate advances the major version", () => {
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("is true when the candidate advances the minor version", () => {
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
  });

  it("is true when the candidate advances the patch version", () => {
    expect(isNewerVersion("0.1.8", "0.1.7")).toBe(true);
  });

  it("is false when candidate equals current", () => {
    expect(isNewerVersion("0.1.7", "0.1.7")).toBe(false);
  });

  it("is false when candidate is older than current", () => {
    expect(isNewerVersion("0.1.6", "0.1.7")).toBe(false);
  });

  it("tolerates the v prefix on either side", () => {
    expect(isNewerVersion("v0.1.8", "0.1.7")).toBe(true);
    expect(isNewerVersion("0.1.8", "v0.1.7")).toBe(true);
    expect(isNewerVersion("v0.1.7", "v0.1.8")).toBe(false);
  });

  it("returns false when either side is malformed", () => {
    expect(isNewerVersion("0.1", "0.1.7")).toBe(false);
    expect(isNewerVersion("0.1.6.1", "0.1.7")).toBe(false);
    expect(isNewerVersion("0.1.7-beta", "0.1.7")).toBe(false);
    expect(isNewerVersion("abc", "0.1.7")).toBe(false);
    expect(isNewerVersion("", "0.1.7")).toBe(false);
    expect(isNewerVersion("0.1.8", "0.1")).toBe(false);
    expect(isNewerVersion("0.1.8", "0.1.6.1")).toBe(false);
    expect(isNewerVersion("0.1.8", "0.1.7-beta")).toBe(false);
  });

  it("returns false when either side is null", () => {
    expect(isNewerVersion(null as unknown as string, "0.1.7")).toBe(false);
    expect(isNewerVersion("0.1.8", null as unknown as string)).toBe(false);
  });
});

describe("updateAssetFilename", () => {
  it("builds the macOS DMG name from version and arch", () => {
    expect(updateAssetFilename("0.2.8", "darwin", "arm64")).toBe("awefork-0.2.8-arm64.dmg");
    expect(updateAssetFilename("v0.2.8", "darwin", "arm64")).toBe("awefork-0.2.8-arm64.dmg");
  });

  it("builds the Windows NSIS name from version and arch", () => {
    expect(updateAssetFilename("0.2.8", "win32", "x64")).toBe("awefork-0.2.8-x64-setup.exe");
  });

  it("returns null for unsupported platforms and malformed versions", () => {
    expect(updateAssetFilename("0.2.8", "linux", "x64")).toBeNull();
    expect(updateAssetFilename("0.2", "darwin", "arm64")).toBeNull();
    expect(updateAssetFilename("0.2.8.1", "darwin", "arm64")).toBeNull();
    expect(updateAssetFilename("", "win32", "x64")).toBeNull();
  });
});

describe("updateAssetUrl", () => {
  it("is built from a validated semver only", () => {
    expect(updateAssetUrl("0.2.8", "darwin", "arm64")).toBe(
      "https://github.com/wehuman01/awefork/releases/download/v0.2.8/awefork-0.2.8-arm64.dmg",
    );
    expect(updateAssetUrl("v0.2.8", "win32", "x64")).toBe(
      "https://github.com/wehuman01/awefork/releases/download/v0.2.8/awefork-0.2.8-x64-setup.exe",
    );
  });

  it("rejects path traversal and shell metacharacters in the version", () => {
    // The version must be strict semver, so traversal and injection payloads
    // can never reach the URL.
    expect(updateAssetUrl("../../evil", "darwin", "arm64")).toBeNull();
    expect(updateAssetUrl("0.2.8 & rm -rf", "darwin", "arm64")).toBeNull();
    expect(updateAssetUrl("0.8", "win32", "x64")).toBeNull();
  });
});

describe("hasPlatformInstaller", () => {
  const macAssets = [
    "awefork-0.3.6-arm64.dmg",
    "awefork-0.3.6-x64-setup.exe",
    "awefork-0.3.6-arm64.dmg.blockmap",
  ];

  it("is true when the release ships this platform's installer", () => {
    expect(hasPlatformInstaller("0.3.6", macAssets, "darwin", "arm64")).toBe(true);
    expect(hasPlatformInstaller("0.3.6", macAssets, "win32", "x64")).toBe(true);
  });

  it("is false for a notes-only release with no installers attached", () => {
    // v0.3.7 was tagged and published without building installers — prompting
    // about it would offer an update the app cannot download.
    expect(hasPlatformInstaller("0.3.7", [], "darwin", "arm64")).toBe(false);
    expect(hasPlatformInstaller("0.3.7", [], "win32", "x64")).toBe(false);
  });

  it("is false when only the other platform's installer is attached", () => {
    const macOnly = ["awefork-0.3.6-arm64.dmg"];
    expect(hasPlatformInstaller("0.3.6", macOnly, "darwin", "arm64")).toBe(true);
    expect(hasPlatformInstaller("0.3.6", macOnly, "win32", "x64")).toBe(false);
  });

  it("ignores blockmap sidecars as installers", () => {
    expect(
      hasPlatformInstaller("0.3.6", ["awefork-0.3.6-arm64.dmg.blockmap"], "darwin", "arm64"),
    ).toBe(false);
  });

  it("is false on platforms the app never builds for", () => {
    expect(hasPlatformInstaller("0.3.6", macAssets, "linux", "x64")).toBe(false);
  });

  it("is false for a malformed version", () => {
    expect(hasPlatformInstaller("0.3", macAssets, "darwin", "arm64")).toBe(false);
  });
});
