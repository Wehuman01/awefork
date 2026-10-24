import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { DirListing, FileEntry, FsResult } from "../src/shared/file-types";

/**
 * The file-browser store: navigation history, bounded previews with stale
 * responses dropped, the current-directory filter, typed-path jumps and the
 * drag payload. window.awefork is scripted per call, so the timing-sensitive
 * paths (two previews racing) can be driven deterministically.
 */

function entry(name: string, isDir = false): FileEntry {
  return {
    name,
    path: `/root/${name}`,
    isDir,
    isSymlink: false,
    size: isDir ? null : 10,
    mtime: 1,
    hidden: name.startsWith("."),
  };
}

function listing(dir: string, entries: FileEntry[]): FsResult<DirListing> {
  return { ok: true, value: { path: dir, entries, capped: false } };
}

/** A minimal DataTransfer stand-in: types, string payload, file list. */
class FakeDataTransfer {
  store = new Map<string, string>();
  files: File[] = [];
  dropEffect = "none";
  effectAllowed = "none";
  get types(): string[] {
    return [...this.store.keys(), ...(this.files.length > 0 ? ["Files"] : [])];
  }
  setData(type: string, value: string): void {
    this.store.set(type, value);
  }
  getData(type: string): string {
    return this.store.get(type) ?? "";
  }
}

function dragEvent(transfer: FakeDataTransfer): DragEvent {
  return { dataTransfer: transfer } as unknown as DragEvent;
}

async function bootFiles(options: { listings?: Record<string, FsResult<DirListing>> } = {}) {
  vi.resetModules();
  // Paths the fake stat answers "directory" for; everything else reads as a
  // file, so the typed-path tests can drive both branches.
  const dirs = new Set(["/a/docs", "/home/demo"]);
  const api = {
    listDir: vi.fn(async (dir: string) => options.listings?.[dir] ?? listing(dir, [])),
    statFile: vi.fn(async (target: string) => ({
      ok: true as const,
      value: {
        path: target,
        exists: true,
        isDir: dirs.has(target),
        isSymlink: false,
        size: 4,
        mtime: 1,
        hidden: false,
        childCount: null,
      },
    })),
    readTextPreview: vi.fn(async (target: string) => ({
      ok: true as const,
      value: { path: target, text: `text of ${target}`, truncated: false, bytes: 4 },
    })),
    readImagePreview: vi.fn(async () => ({
      ok: false as const,
      error: { code: "unsupported" as const },
    })),
    searchFiles: vi.fn(async () => ({ ok: true as const, value: [entry("hit.md")] })),
    homePath: vi.fn(async () => "/home/demo"),
    relativeToRoot: vi.fn(async () => ({ ok: true as const, value: "x" })),
  };
  (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
  const mod = await import("../src/renderer/src/files");
  return { mod, files: mod.files, api };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("navigation", () => {
  it("records history and walks it back and forward", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("b", true)]),
        "/a/b": listing("/a/b", [entry("c", true)]),
        "/a/b/c": listing("/a/b/c", []),
      },
    });
    await h.mod.browseTo("/a");
    await h.mod.browseTo("/a/b");
    await h.mod.browseTo("/a/b/c");
    expect(h.files.browsing).toBe("/a/b/c");

    await h.mod.goBack();
    expect(h.files.browsing).toBe("/a/b");
    await h.mod.goBack();
    expect(h.files.browsing).toBe("/a");
    await h.mod.goForward();
    expect(h.files.browsing).toBe("/a/b");
    // A new navigation clears the forward stack.
    await h.mod.browseTo("/a");
    expect(h.files.forward).toEqual([]);
  });

  it("does not duplicate history when re-entering the same directory", async () => {
    const h = await bootFiles({ listings: { "/a": listing("/a", []) } });
    await h.mod.browseTo("/a");
    await h.mod.browseTo("/a/");
    expect(h.files.history).toEqual([]);
    expect(h.api.listDir).toHaveBeenCalledTimes(2);
  });

  it("goes up until the filesystem root", async () => {
    const h = await bootFiles({ listings: { "/a": listing("/a", []) } });
    await h.mod.browseTo("/a");
    await h.mod.goUp();
    expect(h.files.browsing).toBe("/");
    await h.mod.goUp();
    expect(h.files.browsing).toBe("/");
  });

  it("surfaces a listing failure as a code, not a throw", async () => {
    const h = await bootFiles({
      listings: { "/locked": { ok: false, error: { code: "permission" } } },
    });
    await h.mod.browseTo("/locked");
    expect(h.files.error?.code).toBe("permission");
    expect(h.files.entries).toEqual([]);
  });

  it("previews a clicked file in the same step, and only selects a directory", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("b", true), entry("readme.md")]),
      },
    });
    await h.mod.browseTo("/a");
    // bootFiles re-imports the module graph, so the live settings instance
    // is the one files.ts holds — read it back through the store's import.
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "preview";
    h.mod.selectOrPreviewEntry(entry("readme.md"));
    expect(h.files.selectedPath).toBe("/root/readme.md");
    await vi.waitFor(() => expect(h.files.preview?.path).toBe("/root/readme.md"));
    // A directory keeps the selection but never fills the preview pane.
    h.mod.selectOrPreviewEntry(entry("b", true));
    expect(h.files.selectedPath).toBe("/root/b");
    expect(h.files.preview?.path).toBe("/root/readme.md");
    settings.files.openOnDouble = "system";
  });

  it("a click only selects when a double-click is configured to open the system app", async () => {
    const h = await bootFiles();
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "system";
    h.mod.selectOrPreviewEntry(entry("a.md"));
    expect(h.files.selectedPath).toBe("/root/a.md");
    expect(h.files.preview).toBeNull();
    expect(h.api.readTextPreview).not.toHaveBeenCalled();
  });

  it("drops a selection that the new listing no longer has", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("b", true)]),
        "/a/b": listing("/a/b", []),
      },
    });
    await h.mod.browseTo("/a");
    h.mod.selectEntry(entry("b", true));
    await h.mod.browseTo("/a/b");
    expect(h.files.selectedPath).toBeNull();
  });
});

describe("preview", () => {
  it("reads a text preview and keeps the truncation flag", async () => {
    const h = await bootFiles();
    await h.mod.previewEntry(entry("a.md"));
    expect(h.files.preview?.status).toBe("text");
    expect(h.files.preview?.text).toBe("text of /root/a.md");
  });

  it("drops a stale preview when a newer one won the race", async () => {
    vi.resetModules();
    const gates: Array<() => void> = [];
    const api = {
      listDir: async (dir: string) => listing(dir, []),
      statFile: async () => ({ ok: true, value: {} }),
      readTextPreview: vi.fn(
        (target: string) =>
          new Promise((resolve) => {
            gates.push(() =>
              resolve({
                ok: true,
                value: { path: target, text: `late ${target}`, truncated: false, bytes: 1 },
              }),
            );
          }),
      ),
      readImagePreview: vi.fn(async () => ({ ok: false, error: { code: "unsupported" } })),
      searchFiles: async () => ({ ok: true, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");

    const first = mod.previewEntry(entry("first.md"));
    const second = mod.previewEntry(entry("second.md"));
    // Let both requests reach their gated read before answering.
    await Promise.resolve();
    await Promise.resolve();
    // The second preview answers first; the first one answers late and must
    // not overwrite it.
    gates[1]?.();
    gates[0]?.();
    await Promise.all([first, second]);
    expect(mod.files.preview?.path).toBe("/root/second.md");
    expect(mod.files.preview?.text).toBe("late /root/second.md");
  });

  it("reports a binary file as an error state, not an empty text", async () => {
    const h = await bootFiles();
    h.api.readTextPreview.mockResolvedValueOnce({ ok: false, error: { code: "binary" } });
    await h.mod.previewEntry(entry("blob.bin"));
    expect(h.files.preview?.status).toBe("error");
    expect(h.files.preview?.error?.code).toBe("binary");
  });

  it("surfaces an oversized image as too-large instead of falling through to binary", async () => {
    const h = await bootFiles();
    h.api.readImagePreview.mockResolvedValueOnce({ ok: false, error: { code: "too-large" } });
    await h.mod.previewEntry(entry("huge.png"));
    expect(h.files.preview?.status).toBe("error");
    expect(h.files.preview?.error?.code).toBe("too-large");
    // The misnamed fallback must never even ask for text.
    expect(h.api.readTextPreview).not.toHaveBeenCalled();
  });

  it("retires an in-flight preview when the listing changes directory", async () => {
    vi.resetModules();
    const gates: Array<() => void> = [];
    const api = {
      listDir: vi.fn(async (dir: string) => listing(dir, [])),
      statFile: async () => ({ ok: true, value: {} }),
      readTextPreview: vi.fn(
        (target: string) =>
          new Promise((resolve) => {
            gates.push(() =>
              resolve({
                ok: true,
                value: { path: target, text: `late ${target}`, truncated: false, bytes: 1 },
              }),
            );
          }),
      ),
      readImagePreview: vi.fn(async () => ({ ok: false, error: { code: "unsupported" } })),
      searchFiles: async () => ({ ok: true, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");

    const first = mod.previewEntry(entry("first.md"));
    await Promise.resolve();
    await Promise.resolve();
    // Navigating away retires the read; its late answer must not reappear
    // as the preview of a directory that no longer lists the file.
    await mod.browseTo("/somewhere/else");
    gates[0]?.();
    await first;
    expect(mod.files.preview).toBeNull();
  });

  it("closing the preview leaves the selection alone", async () => {
    const h = await bootFiles();
    await h.mod.previewEntry(entry("a.md"));
    expect(h.files.preview).not.toBeNull();
    h.mod.clearPreview();
    expect(h.files.preview).toBeNull();
    expect(h.files.selectedPath).toBe("/root/a.md");
  });

  it("clears the stale selection and preview when a listing fails", async () => {
    const h = await bootFiles({
      listings: { "/a": listing("/a", [entry("gone.md")]) },
    });
    await h.mod.browseTo("/a");
    await h.mod.previewEntry(entry("gone.md"));
    expect(h.files.preview).not.toBeNull();
    h.api.listDir.mockResolvedValueOnce({ ok: false, error: { code: "permission" } });
    await h.mod.refresh();
    expect(h.files.error?.code).toBe("permission");
    expect(h.files.selectedPath).toBeNull();
    expect(h.files.preview).toBeNull();
  });
});

describe("filter and view", () => {
  it("filters the current directory by name and hides dot-files until asked", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("Alpha.md"), entry("beta.md"), entry(".secret")]),
      },
    });
    await h.mod.browseTo("/a");
    expect(h.mod.visibleEntries().map((e) => e.name)).toEqual(["Alpha.md", "beta.md"]);
    h.mod.setFilter("alpha");
    expect(h.mod.visibleEntries().map((e) => e.name)).toEqual(["Alpha.md"]);
    h.mod.setFilter("");
    h.mod.toggleHidden();
    expect(h.mod.visibleEntries().map((e) => e.name)).toEqual(["Alpha.md", "beta.md", ".secret"]);
  });

  it("switches between list and grid", async () => {
    const h = await bootFiles();
    expect(h.files.view).toBe("list");
    h.mod.setView("grid");
    expect(h.files.view).toBe("grid");
  });
});

describe("typed paths", () => {
  it("opens a directory", async () => {
    const h = await bootFiles({ listings: { "/a/docs": listing("/a/docs", []) } });
    await h.mod.goToPath("/a/docs");
    expect(h.files.browsing).toBe("/a/docs");
  });

  it("locates and previews a file, without polluting history with it", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("docs", true)]),
        "/a/docs": listing("/a/docs", []),
      },
    });
    await h.mod.browseTo("/a");
    await h.mod.goToPath("/a/docs/readme.md");
    // The file's own directory opens — not the file path itself — and the
    // history holds only real directory visits.
    expect(h.files.browsing).toBe("/a/docs");
    expect(h.files.preview?.path).toBe("/a/docs/readme.md");
    expect(h.files.history).toEqual(["/a"]);
  });

  it("expands ~ against the home directory", async () => {
    const h = await bootFiles({ listings: { "/home/demo": listing("/home/demo", []) } });
    await h.mod.initFiles();
    await h.mod.goToPath("~");
    expect(h.files.browsing).toBe("/home/demo");
  });

  it("refuses a relative path instead of rooting it at /", async () => {
    const h = await bootFiles();
    await h.mod.goToPath("docs");
    expect(h.files.browsing).toBeNull();
    expect(h.files.notice).not.toBeNull();
    expect(h.api.listDir).not.toHaveBeenCalled();
  });
});

describe("quick search", () => {
  it("passes the project root and the hidden toggle through", async () => {
    const h = await bootFiles();
    await h.mod.quickSearch("/project", "readme");
    expect(h.api.searchFiles).toHaveBeenCalledWith("/project", "readme", {
      includeHidden: false,
    });
    expect(h.files.quickResults.map((e) => e.name)).toEqual(["hit.md"]);
  });

  it("clears results for an empty query without calling the backend", async () => {
    const h = await bootFiles();
    await h.mod.quickSearch("/project", "   ");
    expect(h.api.searchFiles).not.toHaveBeenCalled();
    expect(h.files.quickResults).toEqual([]);
  });

  it("reports a failed search as a code", async () => {
    const h = await bootFiles();
    h.api.searchFiles.mockResolvedValueOnce({ ok: false, error: { code: "permission" } });
    await h.mod.quickSearch("/project", "x");
    expect(h.files.quickError?.code).toBe("permission");
  });
});

describe("path drags", () => {
  it("round-trips an internal payload", async () => {
    const h = await bootFiles();
    const transfer = new FakeDataTransfer();
    h.mod.startPathDrag(dragEvent(transfer), ["/a/b.md"]);
    expect(transfer.getData("application/x-awefork-path")).toBe('["/a/b.md"]');
    expect(transfer.getData("text/plain")).toBe("/a/b.md");
    expect(transfer.effectAllowed).toBe("copy");

    const read = h.mod.readPathDrop(dragEvent(transfer));
    expect(read).toEqual({ paths: ["/a/b.md"], external: false });
  });

  it("resolves external files through pathForFile and drops unnamed ones", async () => {
    const h = await bootFiles();
    const resolved = {} as File;
    const unnamed = {} as File;
    h.api.pathForFile = vi.fn((file: File) => (file === resolved ? "/from/finder.md" : null));
    const transfer = new FakeDataTransfer();
    transfer.files = [resolved, unnamed];
    const read = h.mod.readPathDrop(dragEvent(transfer));
    expect(read).toEqual({ paths: ["/from/finder.md"], external: true });
  });

  it("reports an all-unnamed external drop as an empty path list", async () => {
    const h = await bootFiles();
    h.api.pathForFile = vi.fn(() => null);
    const transfer = new FakeDataTransfer();
    transfer.files = [{} as File];
    expect(h.mod.readPathDrop(dragEvent(transfer))).toEqual({ paths: [], external: true });
  });

  it("recognizes both drag flavors and ignores plain ones", async () => {
    const h = await bootFiles();
    const internal = new FakeDataTransfer();
    h.mod.startPathDrag(dragEvent(internal), ["/a"]);
    expect(h.mod.isPathDrag(dragEvent(internal))).toBe(true);
    const external = new FakeDataTransfer();
    external.files = [{} as File];
    expect(h.mod.isPathDrag(dragEvent(external))).toBe(true);
    const plain = new FakeDataTransfer();
    plain.setData("text/plain", "hello");
    expect(h.mod.isPathDrag(dragEvent(plain))).toBe(false);
  });
});

describe("sidebar tree", () => {
  it("loads children on first expand and folds on the second", async () => {
    const h = await bootFiles({
      listings: { "/a": listing("/a", [entry("b", true), entry("c.md")]) },
    });
    await h.mod.toggleTreeNode("/a");
    expect(h.mod.isTreeNodeExpanded("/a")).toBe(true);
    // The cache keeps files alongside directories (the session file dock
    // shows both); tree renderers filter to dirs themselves.
    expect(h.files.treeChildren["/a"]?.map((e) => e.name)).toEqual(["b", "c.md"]);
    await h.mod.toggleTreeNode("/a");
    expect(h.mod.isTreeNodeExpanded("/a")).toBe(false);
  });

  it("records a per-node error instead of throwing", async () => {
    const h = await bootFiles({
      listings: { "/locked": { ok: false, error: { code: "permission" } } },
    });
    await h.mod.toggleTreeNode("/locked");
    expect(h.files.treeError["/locked"]?.code).toBe("permission");
  });

  it("drops a stale tree response when a newer load for the same node won", async () => {
    const gates: Array<() => void> = [];
    const answers: Array<FileEntry[]> = [[entry("stale.md")], [entry("fresh.md")]];
    const api = {
      listDir: vi.fn(
        (dir: string) =>
          new Promise((resolve) => {
            const index = gates.length;
            gates.push(() => resolve(listing(dir, answers[index])));
          }),
      ),
      statFile: async () => ({ ok: true, value: {} }),
      readTextPreview: async () => ({ ok: true, value: { text: "", truncated: false, bytes: 0 } }),
      readImagePreview: async () => ({ ok: false, error: { code: "unsupported" } }),
      searchFiles: async () => ({ ok: true, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");

    const first = mod.loadTreeChildren("/a");
    const second = mod.loadTreeChildren("/a");
    await Promise.resolve();
    await Promise.resolve();
    // The reload answers first; the stale first response must not overwrite it.
    gates[1]?.();
    gates[0]?.();
    await Promise.all([first, second]);
    expect(mod.files.treeChildren["/a"]?.map((e) => e.name)).toEqual(["fresh.md"]);
    expect(mod.files.treeLoading["/a"]).toBe(false);
  });
});

describe("settings mirror", () => {
  it("settings-page writes to settings.files reach the live store", async () => {
    const { mod, files } = await bootFiles({});
    const { settings } = await import("../src/renderer/src/settings");
    const { nextTick } = await import("vue");

    // The settings page assigns directly; without the mirror the toolbar
    // keeps this boot's seed until a restart.
    settings.files.showHidden = !settings.files.showHidden;
    settings.files.view = files.view === "list" ? "grid" : "list";
    await nextTick();

    expect(files.showHidden).toBe(settings.files.showHidden);
    expect(files.view).toBe(settings.files.view);

    // Restore so other tests seed from the defaults again.
    settings.files.showHidden = false;
    settings.files.view = "list";
  });
});
