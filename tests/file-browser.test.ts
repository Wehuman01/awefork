import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listDirectory,
  MAX_PREVIEW_BYTES,
  readImagePreview,
  readTextPreview,
  relativeToRoot,
  searchFiles,
  statPath,
} from "../src/main/file-browser";

/**
 * The main-process file surface, exercised against a real temporary tree:
 * listings, metadata, bounded previews, project-relative paths and the
 * quick search. Everything here is read-only — the tree is created once and
 * removed at the end.
 */
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "awefork-file-browser-"));
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "docs", "deep"));
  mkdirSync(path.join(root, ".hidden"));
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "leftpad"));
  writeFileSync(path.join(root, "README.md"), "# 标题\n\n正文内容\n");
  writeFileSync(path.join(root, "docs", "a.md"), "docs a\n");
  writeFileSync(path.join(root, "docs", "deep", "b.ts"), "export const b = 1;\n");
  writeFileSync(path.join(root, "docs", "中文 名字.txt"), "中文内容\n");
  writeFileSync(path.join(root, ".hidden", "secret.txt"), "hidden\n");
  writeFileSync(path.join(root, "node_modules", "leftpad", "index.js"), "module.exports = 1;\n");
  // A 1×1 transparent PNG.
  writeFileSync(
    path.join(root, "dot.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  writeFileSync(path.join(root, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
  symlinkSync(path.join(root, "docs", "a.md"), path.join(root, "link-to-a.md"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function entriesOf(dir: string): Promise<string[]> {
  const result = await listDirectory(dir);
  if (!result.ok) throw new Error(`listDirectory failed: ${result.error.code}`);
  return result.value.entries.map((e) => e.name);
}

describe("listDirectory", () => {
  it("lists directories first, then files, case-insensitively", async () => {
    // The listing carries everything, hidden included — the renderer does
    // the hiding, so toggling it never re-reads the directory.
    const names = await entriesOf(root);
    expect(names).toEqual([
      ".hidden",
      "docs",
      "node_modules",
      "blob.bin",
      "dot.png",
      "link-to-a.md",
      "README.md",
    ]);
  });

  it("reports each entry's own metadata without following symlinks", async () => {
    const result = await listDirectory(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const link = result.value.entries.find((e) => e.name === "link-to-a.md");
    expect(link?.isSymlink).toBe(true);
    expect(link?.isDir).toBe(false);
    const readme = result.value.entries.find((e) => e.name === "README.md");
    expect(readme?.isDir).toBe(false);
    expect(readme?.size).toBeGreaterThan(0);
    expect(readme?.mtime).toBeGreaterThan(0);
    const docs = result.value.entries.find((e) => e.name === "docs");
    // A directory's size stays null — never computed recursively.
    expect(docs?.isDir).toBe(true);
    expect(docs?.size).toBeNull();
  });

  it("marks dot-prefixed entries hidden", async () => {
    const result = await listDirectory(root);
    if (!result.ok) throw new Error("unreachable");
    const hiddenDir = result.value.entries.find((e) => e.name === ".hidden");
    expect(hiddenDir?.hidden).toBe(true);
    expect(result.value.entries.find((e) => e.name === "node_modules")?.hidden).toBe(false);
    const inside = await listDirectory(path.join(root, ".hidden"));
    if (!inside.ok) throw new Error("unreachable");
    // The flag describes the entry itself, not its parent: a normal file
    // inside a hidden directory is not hidden.
    expect(inside.value.entries.map((e) => e.name)).toEqual(["secret.txt"]);
    expect(inside.value.entries[0]?.hidden).toBe(false);
  });

  it("answers not-found for a vanished path and not-a-directory for a file", async () => {
    const gone = await listDirectory(path.join(root, "nope"));
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe("not-found");
    const file = await listDirectory(path.join(root, "README.md"));
    expect(file.ok).toBe(false);
    if (!file.ok) expect(file.error.code).toBe("not-a-directory");
  });

  it("refuses relative and empty paths", async () => {
    for (const bad of ["", "relative/path", "~/x"]) {
      const result = await listDirectory(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("keeps names with spaces and CJK intact", async () => {
    // Latin names sort before CJK ones under the locale collation.
    expect(await entriesOf(path.join(root, "docs"))).toEqual(["deep", "a.md", "中文 名字.txt"]);
  });
});

describe("statPath", () => {
  it("describes a directory with its direct child count only", async () => {
    const result = await statPath(path.join(root, "docs"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exists).toBe(true);
    expect(result.value.isDir).toBe(true);
    expect(result.value.childCount).toBe(3);
    expect(result.value.size).toBeNull();
  });

  it("reports a deleted file as a state, not an error", async () => {
    const result = await statPath(path.join(root, "ghost.md"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exists).toBe(false);
  });
});

describe("readTextPreview", () => {
  it("reads a text file whole", async () => {
    const result = await readTextPreview(path.join(root, "docs", "a.md"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe("docs a\n");
    expect(result.value.truncated).toBe(false);
    expect(result.value.bytes).toBe(7);
  });

  it("decodes CJK content", async () => {
    const result = await readTextPreview(path.join(root, "docs", "中文 名字.txt"));
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.text).toBe("中文内容\n");
  });

  it("truncates at the cap and says so, with the full size beside it", async () => {
    writeFileSync(path.join(root, "big.txt"), "x".repeat(4096));
    const result = await readTextPreview(path.join(root, "big.txt"), 1024);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.truncated).toBe(true);
    expect(result.value.text.length).toBe(1024);
    expect(result.value.bytes).toBe(4096);
  });

  it("refuses a directory and a binary file", async () => {
    const dir = await readTextPreview(path.join(root, "docs"));
    expect(dir.ok).toBe(false);
    if (!dir.ok) expect(dir.error.code).toBe("not-a-directory");
    const bin = await readTextPreview(path.join(root, "blob.bin"));
    expect(bin.ok).toBe(false);
    if (!bin.ok) expect(bin.error.code).toBe("binary");
  });

  it("treats maxBytes as a ceiling: a smaller cap is honored, a larger one is not", async () => {
    writeFileSync(path.join(root, "huge.txt"), "y".repeat(MAX_PREVIEW_BYTES + 2048));
    const small = await readTextPreview(path.join(root, "huge.txt"), 10);
    if (!small.ok) throw new Error("unreachable");
    expect(small.value.text.length).toBe(10);
    expect(small.value.truncated).toBe(true);
    const tooBig = await readTextPreview(path.join(root, "huge.txt"), 10 * MAX_PREVIEW_BYTES);
    if (!tooBig.ok) throw new Error("unreachable");
    expect(tooBig.value.text.length).toBe(MAX_PREVIEW_BYTES);
    expect(tooBig.value.truncated).toBe(true);
  });
});

describe("readImagePreview", () => {
  it("returns a data URL for a known image type", async () => {
    const result = await readImagePreview(path.join(root, "dot.png"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(result.value.bytes).toBeGreaterThan(0);
  });

  it("refuses a non-image and a directory", async () => {
    const text = await readImagePreview(path.join(root, "docs", "a.md"));
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error.code).toBe("unsupported");
    const dir = await readImagePreview(path.join(root, "docs"));
    expect(dir.ok).toBe(false);
  });
});

describe("relativeToRoot", () => {
  it("gives the project-relative path inside the root", async () => {
    const result = await relativeToRoot(root, path.join(root, "docs", "a.md"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(path.join("docs", "a.md"));
  });

  it("answers . for the root itself", async () => {
    const result = await relativeToRoot(root, root);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe(".");
  });

  it("climbs out with .. for a sibling of the root", async () => {
    const outside = path.join(path.dirname(root), "shared", "note.md");
    const result = await relativeToRoot(root, outside);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe(path.join("..", "shared", "note.md"));
  });

  it("never mistakes a shared prefix for containment", async () => {
    // The awefork-old trap: startsWith would call this a child.
    const result = await relativeToRoot(`${root}-old`, path.join(`${root}-old`, "x.md"));
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBe("x.md");
    const sibling = await relativeToRoot(root, path.join(`${root}-old`, "x.md"));
    if (!sibling.ok) throw new Error("unreachable");
    expect(sibling.value?.startsWith("..")).toBe(true);
  });

  it("rejects relative inputs", async () => {
    const result = await relativeToRoot("root", "target");
    expect(result.ok).toBe(false);
  });
});

describe("searchFiles", () => {
  it("finds files by name and by path below the root", async () => {
    const byName = await searchFiles(root, "b.ts");
    if (!byName.ok) throw new Error("unreachable");
    expect(byName.value.map((e) => e.name)).toContain("b.ts");
    const byPath = await searchFiles(root, "deep");
    if (!byPath.ok) throw new Error("unreachable");
    expect(byPath.value.map((e) => e.path)).toContain(path.join(root, "docs", "deep", "b.ts"));
  });

  it("skips build output and VCS metadata", async () => {
    const result = await searchFiles(root, "leftpad");
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual([]);
  });

  it("hides dot-prefixed entries unless asked", async () => {
    const withoutHidden = await searchFiles(root, "secret");
    if (!withoutHidden.ok) throw new Error("unreachable");
    expect(withoutHidden.value).toEqual([]);
    const withHidden = await searchFiles(root, "secret", { includeHidden: true });
    if (!withHidden.ok) throw new Error("unreachable");
    expect(withHidden.value.map((e) => e.name)).toEqual(["secret.txt"]);
  });

  it("answers nothing for an empty query and respects the limit", async () => {
    const empty = await searchFiles(root, "   ");
    if (!empty.ok) throw new Error("unreachable");
    expect(empty.value).toEqual([]);
    const capped = await searchFiles(root, "e", { limit: 2 });
    if (!capped.ok) throw new Error("unreachable");
    expect(capped.value.length).toBeLessThanOrEqual(2);
  });

  it("lists a matching directory as a jump target", async () => {
    const result = await searchFiles(root, "deep");
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.some((e) => e.isDir && e.name === "deep")).toBe(true);
  });
});
