import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeDirectoryList } from "../src/shared/canonical-paths";
import { canonicalizeStoredDirs, readDirs, writeDirs } from "../src/shared/dirs-store";

async function tempDirsPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "awefork-dirs-")), "dirs.json");
}

/**
 * The store is legacy: the resident folder replaced hand-added directories,
 * so nothing registers one anymore. What remains is the read the upgrade
 * adoption depends on, plus the spelling migration that keeps a pre-upgrade
 * symlinked path matching the session rows' canonical directories.
 */
describe("dirs store (legacy read)", () => {
  it("returns empty list when file does not exist", async () => {
    expect(await readDirs(await tempDirsPath())).toEqual([]);
  });

  it("treats corrupted files as empty", async () => {
    const path = await tempDirsPath();
    await writeFile(path, "not json at all", "utf8");
    expect(await readDirs(path)).toEqual([]);
  });

  it("drops non-string entries while reading", async () => {
    const path = await tempDirsPath();
    await writeFile(path, JSON.stringify(["/a", 3, null, ""]), "utf8");
    expect(await readDirs(path)).toEqual(["/a"]);
  });

  it("the spelling migration rewrites a symlinked path in place", async () => {
    const path = await tempDirsPath();
    await writeDirs(path, ["/legacy/x", "/legacy/y"]);
    await canonicalizeStoredDirs(path, (dirs) =>
      canonicalizeDirectoryList(dirs, async (dir) => dir.replace("/legacy/", "/real/")),
    );
    expect(await readDirs(path)).toEqual(["/real/x", "/real/y"]);
  });
});

describe("cleanup", () => {
  it("removes temp dirs", async () => {
    const path = await tempDirsPath();
    await writeDirs(path, ["/x"]);
    await rm(join(path, ".."), { recursive: true, force: true });
    expect(await readDirs(path)).toEqual([]);
  });
});
