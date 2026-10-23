import { describe, expect, it } from "vitest";
import { macosAppBundle, parseTeamId } from "../src/main/update-install";

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
