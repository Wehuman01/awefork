import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeDirectoryList } from "../src/shared/canonical-paths";
import {
  addDir,
  canonicalizeStoredDirs,
  readDirs,
  removeDir,
  writeDirs,
} from "../src/shared/dirs-store";

async function tempDirsPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "awefork-dirs-")), "dirs.json");
}

describe("dirs store", () => {
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

  it("addDir registers then dedupes a directory", async () => {
    const path = await tempDirsPath();
    await expect(addDir(path, "/proj/one")).resolves.toEqual(["/proj/one"]);
    await expect(addDir(path, "/proj/two")).resolves.toEqual(["/proj/one", "/proj/two"]);
    await expect(addDir(path, "/proj/one")).resolves.toEqual(["/proj/one", "/proj/two"]);
    expect(await readDirs(path)).toEqual(["/proj/one", "/proj/two"]);
  });

  it("removeDir drops only the given directory", async () => {
    const path = await tempDirsPath();
    await writeDirs(path, ["/proj/one", "/proj/two"]);
    await expect(removeDir(path, "/proj/one")).resolves.toEqual(["/proj/two"]);
    expect(await readDirs(path)).toEqual(["/proj/two"]);
  });

  it("serializes concurrent adds so neither registration is lost", async () => {
    const path = await tempDirsPath();
    // Fired without awaiting in between — without serialization both reads
    // see the empty file and the second write drops the first directory.
    await Promise.all([addDir(path, "/proj/one"), addDir(path, "/proj/two")]);
    expect(await readDirs(path)).toEqual(["/proj/one", "/proj/two"]);
  });

  it("queues the spelling migration with directory writes so neither is lost", async () => {
    const path = await tempDirsPath();
    await writeDirs(path, ["/legacy/x"]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The migration parks mid-task; addDir must wait behind it. Read outside
    // the queue, the migration's whole-list write would land after addDir's
    // and silently drop the registration.
    const migration = canonicalizeStoredDirs(path, (dirs) =>
      canonicalizeDirectoryList(dirs, async () => "/real/x"),
    );
    const added = addDir(path, "/added");
    release();
    await Promise.all([migration, added]);
    expect(await readDirs(path)).toEqual(["/real/x", "/added"]);
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
