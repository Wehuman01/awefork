import { describe, expect, it } from "vitest";
import {
  canonicalDirectories,
  canonicalDirectory,
  canonicalizeArchiveDirectories,
  canonicalizeDirectoryList,
  canonicalizeSessionDirectories,
  type RealpathFn,
} from "../src/shared/canonical-paths";
import type { SessionSummary } from "../src/shared/types";

/**
 * macOS fixture: /var is a symlink the kernel resolves to /private/var, so
 * one project can arrive as both spellings. The injected realpath plays that
 * filesystem; a counter proves the once-per-listing rule.
 */
const resolvingSymlink: RealpathFn = async (path) =>
  path.startsWith("/var/") ? `/private${path}` : path;

function session(id: string, directory: string): SessionSummary {
  return {
    id,
    title: id,
    directory,
    parentSessionId: null,
    origin: "root",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("canonicalDirectories", () => {
  it("maps symlinked spellings onto their real path, once per distinct dir", async () => {
    let calls = 0;
    const resolve: RealpathFn = async (path) => {
      calls += 1;
      return resolvingSymlink(path);
    };
    const map = await canonicalDirectories(
      ["/var/folders/aa/proj", "/var/folders/aa/proj", "/Users/peng/proj"],
      resolve,
    );
    expect(map.get("/var/folders/aa/proj")).toBe("/private/var/folders/aa/proj");
    expect(map.get("/Users/peng/proj")).toBe("/Users/peng/proj");
    expect(calls).toBe(2);
  });

  it("keeps the original string for paths that no longer resolve", async () => {
    const resolve: RealpathFn = async (path) => {
      if (path === "/gone") throw new Error("ENOENT");
      return path;
    };
    expect(await canonicalDirectory("/gone", resolve)).toBe("/gone");
    expect(await canonicalDirectory("/here", resolve)).toBe("/here");
  });
});

describe("canonicalizeSessionDirectories", () => {
  it("merges two spellings of one project onto the canonical one", async () => {
    const sessions = [
      session("s1", "/var/folders/aa/proj"),
      session("s2", "/private/var/folders/aa/proj"),
      session("s3", "/Users/peng/other"),
    ];
    const canonical = await canonicalizeSessionDirectories(sessions, resolvingSymlink);

    expect(canonical.map((s) => s.directory)).toEqual([
      "/private/var/folders/aa/proj",
      "/private/var/folders/aa/proj",
      "/Users/peng/other",
    ]);
    // The source rows are untouched — rewriting copies.
    expect(sessions[0]?.directory).toBe("/var/folders/aa/proj");
  });
});

describe("canonicalizeArchiveDirectories", () => {
  it("rewrites a pre-upgrade symlinked key so restore matches exactly", async () => {
    const archive = {
      sessions: [],
      directories: [{ path: "/var/folders/aa/proj", archivedAt: 10 }],
    };
    const { archive: next, changed } = await canonicalizeArchiveDirectories(
      archive,
      resolvingSymlink,
    );
    expect(changed).toBe(true);
    expect(next.directories).toEqual([{ path: "/private/var/folders/aa/proj", archivedAt: 10 }]);
  });

  it("collapses twin spellings into one entry, keeping the earliest timestamp", async () => {
    const archive = {
      sessions: [],
      directories: [
        { path: "/private/var/folders/aa/proj", archivedAt: 20 },
        { path: "/var/folders/aa/proj", archivedAt: 5 },
      ],
    };
    const { archive: next, changed } = await canonicalizeArchiveDirectories(
      archive,
      resolvingSymlink,
    );
    expect(changed).toBe(true);
    expect(next.directories).toEqual([{ path: "/private/var/folders/aa/proj", archivedAt: 5 }]);
  });

  it("is a no-op when every key is already canonical", async () => {
    const archive = {
      sessions: [],
      directories: [{ path: "/Users/peng/proj", archivedAt: 1 }],
    };
    const { archive: next, changed } = await canonicalizeArchiveDirectories(
      archive,
      resolvingSymlink,
    );
    expect(changed).toBe(false);
    expect(next).toBe(archive);
  });
});

describe("canonicalizeDirectoryList", () => {
  it("rewrites and dedupes hand-added directory spellings", async () => {
    const { dirs, changed } = await canonicalizeDirectoryList(
      ["/var/folders/aa/proj", "/private/var/folders/aa/proj", "/Users/peng/other"],
      resolvingSymlink,
    );
    expect(changed).toBe(true);
    expect(dirs).toEqual(["/private/var/folders/aa/proj", "/Users/peng/other"]);
  });

  it("is a no-op on an already-canonical list", async () => {
    const input = ["/Users/peng/proj"];
    const { dirs, changed } = await canonicalizeDirectoryList(input, resolvingSymlink);
    expect(changed).toBe(false);
    expect(dirs).toEqual(input);
  });
});
