import { describe, expect, it } from "vitest";
import {
  displayName,
  isWindowsPath,
  joinSegments,
  parentOf,
  pathSegments,
  samePath,
} from "../src/shared/file-paths";

/**
 * The renderer-side path helpers: breadcrumb segments, parent walking and
 * the "same directory" test. The platform-exact math (relative paths) lives
 * in the main process and is covered by file-browser.test.ts.
 */
describe("pathSegments", () => {
  it("splits a POSIX path with the root as its own crumb", () => {
    expect(pathSegments("/a/b/c")).toEqual(["/", "a", "b", "c"]);
    expect(pathSegments("/a")).toEqual(["/", "a"]);
    expect(pathSegments("/")).toEqual(["/"]);
  });

  it("splits a Windows path with the drive letter as its own crumb", () => {
    expect(pathSegments("C:\\a\\b")).toEqual(["C:", "a", "b"]);
    expect(pathSegments("C:\\")).toEqual(["C:"]);
    // Forward slashes split too, so a pasted "C:/a/b" still breadcrumbs.
    expect(pathSegments("C:/a/b")).toEqual(["C:", "a", "b"]);
  });

  it("treats a UNC share as the root crumb, not two levels", () => {
    expect(pathSegments("\\\\server\\share\\a\\b")).toEqual(["\\\\server\\share", "a", "b"]);
    expect(pathSegments("\\\\server\\share")).toEqual(["\\\\server\\share"]);
  });
});

describe("joinSegments", () => {
  it("rebuilds what pathSegments split, on either platform", () => {
    // A bare drive root round-trips as "C:" — the same directory, written
    // without its trailing separator.
    for (const path of ["/a/b/c", "/a", "/", "C:\\a\\b", "\\\\server\\share\\a"]) {
      expect(joinSegments(pathSegments(path))).toBe(path);
    }
    expect(joinSegments(pathSegments("C:\\"))).toBe("C:");
    // A mixed-separator Windows path normalizes to the platform's own.
    expect(joinSegments(pathSegments("C:/a/b"))).toBe("C:\\a\\b");
  });

  it("rebuilds a prefix for breadcrumb clicks", () => {
    const segments = pathSegments("/project/awefork/docs");
    expect(joinSegments(segments.slice(0, 2))).toBe("/project");
    expect(joinSegments(segments.slice(0, 3))).toBe("/project/awefork");
    expect(joinSegments(segments.slice(0, 1))).toBe("/");
  });

  it("returns empty for no segments", () => {
    expect(joinSegments([])).toBe("");
  });
});

describe("parentOf", () => {
  it("walks up until a filesystem root, then stops", () => {
    expect(parentOf("/a/b/c")).toBe("/a/b");
    expect(parentOf("/a")).toBe("/");
    expect(parentOf("/")).toBeNull();
    expect(parentOf("C:\\a\\b")).toBe("C:\\a");
    expect(parentOf("C:\\")).toBeNull();
    expect(parentOf("\\\\server\\share\\a")).toBe("\\\\server\\share");
  });
});

describe("displayName", () => {
  it("names the last segment, or the root marker", () => {
    expect(displayName("/a/b/file.md")).toBe("file.md");
    expect(displayName("/")).toBe("/");
    expect(displayName("C:\\")).toBe("C:");
    expect(displayName("\\\\server\\share")).toBe("\\\\server\\share");
  });
});

describe("samePath", () => {
  it("tolerates a trailing separator", () => {
    expect(samePath("/a/b", "/a/b/")).toBe(true);
  });

  it("ignores drive-letter case on Windows paths only", () => {
    expect(samePath("C:\\Repo", "c:\\repo")).toBe(true);
    expect(samePath("/Repo", "/repo")).toBe(false);
  });

  it("distinguishes different directories", () => {
    expect(samePath("/a/b", "/a/c")).toBe(false);
    // The awefork-old trap: a shared prefix is not the same directory.
    expect(samePath("/project/awefork", "/project/awefork-old")).toBe(false);
  });
});

describe("isWindowsPath", () => {
  it("recognizes drive prefixes with either separator", () => {
    expect(isWindowsPath("C:\\a")).toBe(true);
    expect(isWindowsPath("d:/a")).toBe(true);
    expect(isWindowsPath("/a")).toBe(false);
    expect(isWindowsPath("\\\\server\\share")).toBe(false);
  });
});
