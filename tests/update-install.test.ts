import { describe, expect, it } from "vitest";
import {
  macosAppBundle,
  parseTeamId,
  updateAssetFilename,
  updateAssetUrl,
} from "../src/main/update-install";

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

describe("macosAppBundle", () => {
  it("walks up from the executable to the .app bundle", () => {
    expect(macosAppBundle("/Applications/awefork.app/Contents/MacOS/awefork")).toBe(
      "/Applications/awefork.app",
    );
    expect(macosAppBundle("/Users/ana/Applications/Renamed.app/Contents/MacOS/awefork")).toBe(
      "/Users/ana/Applications/Renamed.app",
    );
  });

  it("returns null outside a bundle (dev runs)", () => {
    expect(macosAppBundle("/projects/awefork/out/main/index.js")).toBeNull();
    expect(macosAppBundle("/a/b/c/d/e/f")).toBeNull();
  });
});

describe("parseTeamId", () => {
  it("reads the team from codesign -dv output", () => {
    const output =
      "Executable=awefork\nIdentifier=com.wehuman01.awefork\nTeamIdentifier=ABC123DEF4\n";
    expect(parseTeamId(output)).toBe("ABC123DEF4");
  });

  it("treats ad-hoc and missing teams as unsigned", () => {
    expect(parseTeamId("TeamIdentifier=not set\n")).toBeNull();
    expect(parseTeamId("TeamIdentifier=\n")).toBeNull();
    expect(parseTeamId("no team line here\n")).toBeNull();
  });
});
