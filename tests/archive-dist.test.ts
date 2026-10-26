import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_KEEP,
  archiveOldBuilds,
  planArchive,
  planPrune,
  pruneOldArchives,
} from "../scripts/archive-dist.mjs";

const DIST_SNAPSHOT = [
  ".icon-ico", // directory in real dist, ignored by name matching
  "awefork-0.1.5-arm64.dmg",
  "awefork-0.1.5-arm64.dmg.blockmap",
  "awefork-0.1.6-arm64.dmg",
  "awefork-0.1.8-arm64.dmg",
  "awefork-0.1.8-arm64.dmg.blockmap",
  "awefork-0.1.8-x64-setup.exe",
  "awefork-0.1.8-x64-setup.exe.blockmap",
  "builder-debug.yml",
  "latest-mac.yml",
  "latest.yml",
];

describe("planArchive", () => {
  it("plans old installers and their blockmaps into versioned archive dirs", () => {
    const moves = planArchive(DIST_SNAPSHOT, "awefork", "0.1.8");

    expect(moves).toEqual([
      { file: "awefork-0.1.5-arm64.dmg", version: "0.1.5" },
      { file: "awefork-0.1.5-arm64.dmg.blockmap", version: "0.1.5" },
      { file: "awefork-0.1.6-arm64.dmg", version: "0.1.6" },
    ]);
  });

  it("keeps the current version and unversioned builder files in dist/", () => {
    const moved = new Set(planArchive(DIST_SNAPSHOT, "awefork", "0.1.8").map((m) => m.file));
    expect(moved.has("awefork-0.1.8-x64-setup.exe")).toBe(false);
    expect(moved.has("awefork-0.1.8-arm64.dmg.blockmap")).toBe(false);
    expect(moved.has("latest-mac.yml")).toBe(false);
    expect(moved.has("builder-debug.yml")).toBe(false);
  });

  it("archives pre-release builds under their core version, but keeps them while current", () => {
    expect(planArchive(["awefork-0.2.0-beta.1-arm64.dmg"], "awefork", "0.1.8")).toEqual([
      { file: "awefork-0.2.0-beta.1-arm64.dmg", version: "0.2.0" },
    ]);
    expect(planArchive(["awefork-0.2.0-beta.1-arm64.dmg"], "awefork", "0.2.0-beta.1")).toEqual([]);
  });

  it("archives the universal build's zip too, but keeps the current one", () => {
    // The universal build emits awefork-<version>-universal-mac.zip (the
    // auto-update payload) beside its dmg; an older one used to sit in dist/
    // forever because only dmg/exe were archived.
    expect(
      planArchive(
        ["awefork-0.1.5-universal-mac.zip", "awefork-0.1.8-universal-mac.zip"],
        "awefork",
        "0.1.8",
      ),
    ).toEqual([{ file: "awefork-0.1.5-universal-mac.zip", version: "0.1.5" }]);
  });
});

describe("planPrune", () => {
  it("deletes the oldest versions beyond the keep count", () => {
    expect(planPrune(["0.5.0", "0.5.1", "0.5.2", "0.5.3"], 3)).toEqual(["0.5.0"]);
    expect(planPrune(["0.5.0", "0.5.1", "0.5.2", "0.5.3"], 1)).toEqual(["0.5.0", "0.5.1", "0.5.2"]);
  });

  it("sorts numerically, not lexically, and keeps unsorted input honest", () => {
    // "0.10.0" sorts after "0.9.0" numerically but before it as text.
    expect(planPrune(["0.10.0", "0.9.0", "0.2.0"], 2)).toEqual(["0.2.0"]);
  });

  it("deletes nothing while the archive is within the keep count", () => {
    expect(planPrune(["0.5.1", "0.5.2"], 3)).toEqual([]);
    expect(planPrune([], 3)).toEqual([]);
  });

  it("never names a non-version entry, whatever sits in the archive", () => {
    expect(planPrune(["0.5.0", "0.5.1", "notes.txt", ".DS_Store", "0.5.2"], 2)).toEqual(["0.5.0"]);
  });
});

describe("archiveOldBuilds", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function makeDist(files: string[]): Promise<string> {
    const distDir = await mkdtemp(path.join(tmpdir(), "awefork-dist-"));
    tempDirs.push(distDir);
    await Promise.all(files.map((file) => writeFile(path.join(distDir, file), "placeholder")));
    return distDir;
  }

  it("moves old installers on disk and leaves everything else untouched", async () => {
    const distDir = await makeDist(DIST_SNAPSHOT);

    const moves = await archiveOldBuilds(distDir, DIST_SNAPSHOT, "awefork", "0.1.8");

    expect(moves).toHaveLength(3);
    await expect(readdir(path.join(distDir, "archive", "0.1.5"))).resolves.toEqual([
      "awefork-0.1.5-arm64.dmg",
      "awefork-0.1.5-arm64.dmg.blockmap",
    ]);
    await expect(readdir(path.join(distDir, "archive", "0.1.6"))).resolves.toEqual([
      "awefork-0.1.6-arm64.dmg",
    ]);
    const remaining = (await readdir(distDir)).filter((name) => name !== "archive");
    expect(remaining).toEqual([
      ".icon-ico",
      "awefork-0.1.8-arm64.dmg",
      "awefork-0.1.8-arm64.dmg.blockmap",
      "awefork-0.1.8-x64-setup.exe",
      "awefork-0.1.8-x64-setup.exe.blockmap",
      "builder-debug.yml",
      "latest-mac.yml",
      "latest.yml",
    ]);
  });

  it("replaces an already-archived file when the same old version is rebuilt", async () => {
    const distDir = await makeDist(["awefork-0.1.5-arm64.dmg"]);
    await mkdir(path.join(distDir, "archive", "0.1.5"), { recursive: true });
    await writeFile(path.join(distDir, "archive", "0.1.5", "awefork-0.1.5-arm64.dmg"), "stale");

    await archiveOldBuilds(distDir, ["awefork-0.1.5-arm64.dmg"], "awefork", "0.1.8");

    await expect(readdir(path.join(distDir, "archive", "0.1.5"))).resolves.toEqual([
      "awefork-0.1.5-arm64.dmg",
    ]);
    await expect(readdir(distDir)).resolves.toEqual(["archive"]);
  });
});

describe("pruneOldArchives", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function makeArchive(versions: string[]): Promise<string> {
    const distDir = await mkdtemp(path.join(tmpdir(), "awefork-dist-"));
    tempDirs.push(distDir);
    await Promise.all(
      versions.map(async (version) => {
        const dir = path.join(distDir, "archive", version);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "awefork-arm64.dmg"), "placeholder");
      }),
    );
    return distDir;
  }

  it("deletes the oldest archive folders beyond the keep count", async () => {
    const distDir = await makeArchive(["0.5.0", "0.5.1", "0.5.2", "0.5.3"]);

    const stale = await pruneOldArchives(distDir, 3);

    expect(stale).toEqual(["0.5.0"]);
    await expect(readdir(path.join(distDir, "archive"))).resolves.toEqual([
      "0.5.1",
      "0.5.2",
      "0.5.3",
    ]);
  });

  it("keeps every version while the archive is within the keep count", async () => {
    const distDir = await makeArchive(["0.5.1", "0.5.2"]);

    expect(await pruneOldArchives(distDir, ARCHIVE_KEEP)).toEqual([]);
    await expect(readdir(path.join(distDir, "archive"))).resolves.toEqual(["0.5.1", "0.5.2"]);
  });

  it("leaves entries that are not version folders alone", async () => {
    const distDir = await makeArchive(["0.5.0", "0.5.1"]);
    await writeFile(path.join(distDir, "archive", "notes.txt"), "keep me");

    expect(await pruneOldArchives(distDir, 1)).toEqual(["0.5.0"]);
    await expect(readdir(path.join(distDir, "archive"))).resolves.toEqual(["0.5.1", "notes.txt"]);
  });

  it("treats a missing archive directory as nothing to do", async () => {
    const distDir = await mkdtemp(path.join(tmpdir(), "awefork-dist-"));
    tempDirs.push(distDir);

    expect(await pruneOldArchives(distDir)).toEqual([]);
  });
});
