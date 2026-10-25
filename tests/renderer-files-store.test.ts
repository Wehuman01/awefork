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
    readFileAsDataUrl: vi.fn(async () => ({
      ok: false as const,
      error: { code: "unsupported" as const },
    })),
    openPath: vi.fn(async () => ({ ok: true as const })),
    searchFiles: vi.fn(async () => ({ ok: true as const, value: [entry("hit.md")] })),
    homePath: vi.fn(async () => "/home/demo"),
    relativeToRoot: vi.fn(async () => ({ ok: true as const, value: "x" })),
  };
  (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
  const mod = await import("../src/renderer/src/files");
  // Every store field now lives on a tab, so the fixture opens one — parked
  // on no directory, exactly like the browser's first paint, so a test's own
  // first browseTo is what fills the history.
  mod.parkFileTab();
  return { mod, files: mod.files, api, tab: () => mod.files.tabs[0] };
}

/** The store's fields now live on tabs; the assertions read the active one. */
function active(mod: { files: { tabs: unknown[]; activeTabId: string | null } }) {
  return mod.files.tabs.find((t) => (t as { id: string }).id === mod.files.activeTabId) as {
    browsing: string | null;
    history: string[];
    forward: string[];
    entries: unknown[];
    error: { code: string } | null;
    capped: boolean;
    selectedPath: string | null;
    filter: string;
    quickQuery: string;
    quickResults: { name: string }[];
    quickLoading: boolean;
    quickError: { code: string } | null;
    reading: boolean;
    previewWidth: number;
    scrollTop: number;
    preview: { path: string; status: string; text?: string; error?: { code: string } } | null;
  };
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
    expect(active(h.mod).browsing).toBe("/a/b/c");

    await h.mod.goBack();
    expect(active(h.mod).browsing).toBe("/a/b");
    await h.mod.goBack();
    expect(active(h.mod).browsing).toBe("/a");
    await h.mod.goForward();
    expect(active(h.mod).browsing).toBe("/a/b");
    // A new navigation clears the forward stack.
    await h.mod.browseTo("/a");
    expect(active(h.mod).forward).toEqual([]);
  });

  it("does not duplicate history when re-entering the same directory", async () => {
    const h = await bootFiles({ listings: { "/a": listing("/a", []) } });
    await h.mod.browseTo("/a");
    await h.mod.browseTo("/a/");
    expect(active(h.mod).history).toEqual([]);
    expect(h.api.listDir).toHaveBeenCalledTimes(2);
  });

  it("goes up until the filesystem root", async () => {
    const h = await bootFiles({ listings: { "/a": listing("/a", []) } });
    await h.mod.browseTo("/a");
    await h.mod.goUp();
    expect(active(h.mod).browsing).toBe("/");
    await h.mod.goUp();
    expect(active(h.mod).browsing).toBe("/");
  });

  it("surfaces a listing failure as a code, not a throw", async () => {
    const h = await bootFiles({
      listings: { "/locked": { ok: false, error: { code: "permission" } } },
    });
    await h.mod.browseTo("/locked");
    expect(active(h.mod).error?.code).toBe("permission");
    expect(active(h.mod).entries).toEqual([]);
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
    expect(active(h.mod).selectedPath).toBe("/root/readme.md");
    await vi.waitFor(() => expect(active(h.mod).preview?.path).toBe("/root/readme.md"));
    // A directory keeps the selection but never fills the preview pane.
    h.mod.selectOrPreviewEntry(entry("b", true));
    expect(active(h.mod).selectedPath).toBe("/root/b");
    expect(active(h.mod).preview?.path).toBe("/root/readme.md");
    settings.files.openOnDouble = "system";
  });

  it("a click only selects when a double-click is configured to open the system app", async () => {
    const h = await bootFiles();
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "system";
    h.mod.selectOrPreviewEntry(entry("a.md"));
    expect(active(h.mod).selectedPath).toBe("/root/a.md");
    expect(active(h.mod).preview).toBeNull();
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
    expect(active(h.mod).selectedPath).toBeNull();
  });
});

describe("preview", () => {
  it("reads a text preview and keeps the truncation flag", async () => {
    const h = await bootFiles();
    await h.mod.previewEntry(entry("a.md"));
    expect(active(h.mod).preview?.status).toBe("text");
    expect(active(h.mod).preview?.text).toBe("text of /root/a.md");
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
      readFileAsDataUrl: vi.fn(async () => ({ ok: false, error: { code: "unsupported" } })),
      searchFiles: async () => ({ ok: true, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");
    // Land the tab on the files' own directory first: previewEntry on a
    // parked tab browses the parent as a preparation, and that listing
    // would otherwise interleave with the race under test.
    await mod.browseTo("/root");

    // The first read must be in flight before the second starts: a request
    // begun while an earlier one is still pending is the exact race, and
    // starting both in the same tick would let the second retire the first
    // before its read is even issued.
    const first = mod.previewEntry(entry("first.md"));
    let spins = 0;
    while (gates.length < 1 && spins < 500) {
      await Promise.resolve();
      spins += 1;
    }
    expect(gates).toHaveLength(1);
    const second = mod.previewEntry(entry("second.md"));
    spins = 0;
    while (gates.length < 2 && spins < 500) {
      await Promise.resolve();
      spins += 1;
    }
    expect(gates).toHaveLength(2);
    // The second preview answers first; the first one answers late and must
    // not overwrite it.
    gates[1]?.();
    gates[0]?.();
    await Promise.all([first, second]);
    expect(active(mod).preview?.path).toBe("/root/second.md");
    expect(active(mod).preview?.text).toBe("late /root/second.md");
  });

  it("reports a binary file as an error state, not an empty text", async () => {
    const h = await bootFiles();
    h.api.readTextPreview.mockResolvedValueOnce({ ok: false, error: { code: "binary" } });
    await h.mod.previewEntry(entry("blob.bin"));
    expect(active(h.mod).preview?.status).toBe("error");
    expect(active(h.mod).preview?.error?.code).toBe("binary");
  });

  it("creates a tab for a dock click that arrives before the view mounted", async () => {
    vi.resetModules();
    const api = {
      listDir: vi.fn(async (dir: string) => listing(dir, [])),
      statFile: async () => ({ ok: true, value: {} }),
      readTextPreview: async (target: string) => ({
        ok: true as const,
        value: { path: target, text: `text of ${target}`, truncated: false, bytes: 4 },
      }),
      readImagePreview: async () => ({ ok: false as const, error: { code: "unsupported" } }),
      searchFiles: async () => ({ ok: true as const, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true as const, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");
    // No parkFileTab: this is the cold dock click — tabs is still empty and
    // the browser view has not mounted yet.
    expect(mod.files.tabs).toHaveLength(0);

    await mod.previewEntry({ ...entry("readme.md"), path: "/proj/docs/readme.md" });

    // The click was not dropped: a tab exists, parked on the file's parent,
    // with the file selected and previewed.
    expect(mod.files.tabs).toHaveLength(1);
    const tab = mod.files.tabs[0];
    expect(tab.browsing).toBe("/proj/docs");
    expect(tab.selectedPath).toBe("/proj/docs/readme.md");
    expect(tab.preview?.status).toBe("text");
    expect(mod.files.activeTabId).toBe(tab.id);
  });

  it("a reveal in flight keeps its preview on the tab it started in", async () => {
    vi.resetModules();
    const listGates: Array<() => void> = [];
    const api = {
      listDir: vi.fn(
        (dir: string) =>
          new Promise((resolve) => {
            listGates.push(() => resolve(listing(dir, [])));
          }),
      ),
      statFile: async () => ({ ok: true as const, value: {} }),
      readTextPreview: async (target: string) => ({
        ok: true as const,
        value: { path: target, text: `text of ${target}`, truncated: false, bytes: 4 },
      }),
      readImagePreview: async () => ({ ok: false as const, error: { code: "unsupported" } }),
      searchFiles: async () => ({ ok: true as const, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true as const, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");
    // Two tabs, each parked then landed. parkFileTab is synchronous, so the
    // listing gate for each browse is the only thing in flight — no
    // initFiles await to race against the gate bookkeeping.
    const idA = mod.parkFileTab();
    const landingA = mod.browseTo("/a");
    expect(listGates).toHaveLength(1);
    listGates.shift()?.();
    await landingA;
    const idB = mod.parkFileTab();
    const landingB = mod.browseTo("/b");
    expect(listGates).toHaveLength(1);
    listGates.shift()?.();
    await landingB;
    const tabA = mod.files.tabs.find((tab) => tab.id === idA);
    const tabB = mod.files.tabs.find((tab) => tab.id === idB);
    if (!tabA || !tabB) throw new Error("fixture tabs missing");
    expect(mod.files.activeTabId).toBe(tabB.id);

    // A quick-open hit is clicked while /a is active; the listing read for
    // /a/docs is still in flight when the user switches to /b.
    await mod.activateFileTab(tabA.id);
    const reveal = mod.revealEntry({ ...entry("readme.md"), path: "/a/docs/readme.md" });
    let spins = 0;
    while (listGates.length < 1 && spins < 500) {
      await Promise.resolve();
      spins += 1;
    }
    expect(listGates).toHaveLength(1);
    await mod.activateFileTab(tabB.id);
    listGates.shift()?.();
    await reveal;

    // The preview belongs to /a — the tab the click was made in. Switching
    // mid-flight must not push A's file into B's pane.
    expect(tabA.browsing).toBe("/a/docs");
    expect(tabA.selectedPath).toBe("/a/docs/readme.md");
    expect(tabA.preview?.path).toBe("/a/docs/readme.md");
    expect(tabB.preview).toBeNull();
    expect(tabB.selectedPath).toBeNull();
    expect(tabB.browsing).toBe("/b");
  });

  it("surfaces an oversized image as too-large instead of falling through to binary", async () => {
    const h = await bootFiles();
    h.api.readImagePreview.mockResolvedValueOnce({ ok: false, error: { code: "too-large" } });
    await h.mod.previewEntry(entry("huge.png"));
    expect(active(h.mod).preview?.status).toBe("error");
    expect(active(h.mod).preview?.error?.code).toBe("too-large");
    // The misnamed fallback must never even ask for text.
    expect(h.api.readTextPreview).not.toHaveBeenCalled();
  });

  it("asks for a PDF's bytes and falls back to the error pane when unreadable", async () => {
    const h = await bootFiles();
    // The document read fails (over the cap, unreadable); a PDF must not
    // fall through to the text reader, so it lands on the error pane —
    // which offers the system open — with the read's own code.
    await h.mod.previewEntry(entry("doc.pdf"));
    expect(h.api.readFileAsDataUrl).toHaveBeenCalledWith(
      "/root/doc.pdf",
      "application/pdf",
      expect.any(Number),
    );
    expect(h.api.readTextPreview).not.toHaveBeenCalled();
    expect(active(h.mod).preview?.status).toBe("error");
    expect(active(h.mod).preview?.error?.code).toBe("unsupported");
  });

  it("keeps reading mode across file switches and drops it with the preview", async () => {
    const h = await bootFiles();
    // The default double-click hands the file to the OS; reading mode is
    // about the in-app preview, so the setting is switched for this case.
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "preview";
    await h.mod.browseTo("/root");
    // A double-click reads; a later click in the same tab must not unread.
    await h.mod.openEntry(entry("a.md"));
    expect(active(h.mod).reading).toBe(true);
    await h.mod.selectOrPreviewEntry(entry("b.md"));
    expect(active(h.mod).reading).toBe(true);
    // Another tab starts unread.
    await h.mod.openFileTab("/a");
    expect(active(h.mod).reading).toBe(false);
    await h.mod.activateFileTab(h.files.tabs[0].id);
    expect(active(h.mod).reading).toBe(true);
    // Closing the preview ends the reading session.
    h.mod.clearPreview();
    expect(active(h.mod).reading).toBe(false);
    // Entering needs something to read.
    h.mod.enterReading();
    expect(active(h.mod).reading).toBe(false);
    settings.files.openOnDouble = "system";
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
      readFileAsDataUrl: vi.fn(async () => ({ ok: false, error: { code: "unsupported" } })),
      searchFiles: async () => ({ ok: true, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");
    // Land first, so the preview read under test is not preceded by the
    // parked tab's parent-listing navigation.
    await mod.browseTo("/root");

    const first = mod.previewEntry(entry("first.md"));
    // Wait for the read to hang on the gate (see the sibling race test for
    // why this polls instead of counting microtasks).
    let spins = 0;
    while (gates.length < 1 && spins < 500) {
      await Promise.resolve();
      spins += 1;
    }
    expect(gates).toHaveLength(1);
    // Navigating away retires the read; its late answer must not reappear
    // as the preview of a directory that no longer lists the file.
    await mod.browseTo("/somewhere/else");
    gates[0]?.();
    await first;
    expect(active(mod).preview).toBeNull();
  });

  it("closing the preview leaves the selection alone", async () => {
    const h = await bootFiles();
    await h.mod.previewEntry(entry("a.md"));
    expect(active(h.mod).preview).not.toBeNull();
    h.mod.clearPreview();
    expect(active(h.mod).preview).toBeNull();
    expect(active(h.mod).selectedPath).toBe("/root/a.md");
  });

  it("clears the stale selection and preview when a listing fails", async () => {
    const h = await bootFiles({
      listings: { "/a": listing("/a", [entry("gone.md")]) },
    });
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "preview";
    await h.mod.browseTo("/a");
    await h.mod.openEntry(entry("gone.md"));
    expect(active(h.mod).reading).toBe(true);
    h.api.listDir.mockResolvedValueOnce({ ok: false, error: { code: "permission" } });
    await h.mod.refresh();
    expect(active(h.mod).error?.code).toBe("permission");
    expect(active(h.mod).selectedPath).toBeNull();
    expect(active(h.mod).preview).toBeNull();
    // The folded-away listing must come back with the preview it was reading.
    expect(active(h.mod).reading).toBe(false);
    settings.files.openOnDouble = "system";
  });

  it("drops reading mode when a navigation loses the previewed file", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("b", true), entry("readme.md")]),
        "/a/b": listing("/a/b", []),
      },
    });
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "preview";
    await h.mod.browseTo("/a");
    await h.mod.openEntry(entry("readme.md"));
    expect(active(h.mod).reading).toBe(true);
    // The new directory does not list the file, so the preview goes — and
    // the reader with it, or the middle column would hold neither.
    await h.mod.browseTo("/a/b");
    expect(active(h.mod).preview).toBeNull();
    expect(active(h.mod).reading).toBe(false);
    settings.files.openOnDouble = "system";
  });

  it("a dock jump lands the listing on the file's own directory", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", []),
        "/proj/docs": listing("/proj/docs", [
          { ...entry("readme.md"), path: "/proj/docs/readme.md" },
        ]),
      },
    });
    // The tab browses /a; the dock click names a file in /proj/docs.
    await h.mod.browseTo("/a");
    await h.mod.previewEntry({ ...entry("readme.md"), path: "/proj/docs/readme.md" });
    // The listing underneath describes the previewed file, so a refresh
    // cannot drop the preview as a selection the listing never had.
    expect(active(h.mod).browsing).toBe("/proj/docs");
    expect(active(h.mod).selectedPath).toBe("/proj/docs/readme.md");
    await h.mod.refresh();
    expect(active(h.mod).preview?.path).toBe("/proj/docs/readme.md");
  });

  it("steps the reader to the next file and keeps reading", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [entry("one.md"), entry("sub", true), entry("two.md")]),
      },
    });
    const { settings } = await import("../src/renderer/src/settings");
    settings.files.openOnDouble = "preview";
    await h.mod.browseTo("/a");
    await h.mod.openEntry(entry("one.md"));
    expect(active(h.mod).reading).toBe(true);
    // Directories are skipped and the reader keeps reading.
    h.mod.stepReading(1);
    expect(active(h.mod).selectedPath).toBe("/root/two.md");
    expect(active(h.mod).reading).toBe(true);
    await vi.waitFor(() => expect(active(h.mod).preview?.path).toBe("/root/two.md"));
    // The last file stays put, and stepping back returns to the first.
    h.mod.stepReading(1);
    expect(active(h.mod).selectedPath).toBe("/root/two.md");
    h.mod.stepReading(-1);
    expect(active(h.mod).selectedPath).toBe("/root/one.md");
    // A step reads the neighbour even when a plain click would only select.
    settings.files.openOnDouble = "system";
    h.mod.stepReading(1);
    await vi.waitFor(() => expect(active(h.mod).preview?.path).toBe("/root/two.md"));
    // Outside reading mode the keys belong to the listing, not the reader.
    h.mod.exitReading();
    h.mod.stepReading(-1);
    expect(active(h.mod).selectedPath).toBe("/root/two.md");
    settings.files.openOnDouble = "preview";
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

describe("ignore list", () => {
  /** Seed the settings blob before the modules under test boot. */
  function seedSettings(files: Record<string, unknown>): void {
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => (key === "awefork:settings" ? JSON.stringify({ files }) : null),
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
  }

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it("hides the default build directories from the browser", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [
          entry("node_modules", true),
          entry("dist", true),
          entry("out", true),
          entry("build", true),
          entry("src", true),
          entry("main.ts"),
        ]),
      },
    });
    await h.mod.browseTo("/a");
    expect(h.mod.visibleEntries().map((e) => e.name)).toEqual(["src", "main.ts"]);
  });

  it("matches the settings' patterns, wildcards included, and keeps everything else", async () => {
    seedSettings({ ignore: ["vendor", "*.log", "Readme.md"] });
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [
          entry("vendor", true),
          entry("app.log"),
          entry("logger.logging"),
          entry("readme.md"),
          entry("node_modules", true),
          entry("main.ts"),
        ]),
      },
    });
    await h.mod.browseTo("/a");
    // The custom list replaces the defaults, so node_modules shows again;
    // names match case-insensitively and "*.log" does not catch ".logging".
    expect(h.mod.visibleEntries().map((e) => e.name)).toEqual([
      "logger.logging",
      "node_modules",
      "main.ts",
    ]);
  });

  it("keeps ignored entries in the raw listing so a settings change reaches loaded trees", async () => {
    const h = await bootFiles({
      listings: { "/a": listing("/a", [entry("node_modules", true), entry("src", true)]) },
    });
    await h.mod.loadTreeChildren("/a");
    expect(h.files.treeChildren["/a"].map((e) => e.name)).toEqual(["node_modules", "src"]);
    expect(h.mod.visibleTreeChildren("/a").map((e) => e.name)).toEqual(["src"]);
  });
});

describe("typed paths", () => {
  it("opens a directory", async () => {
    const h = await bootFiles({ listings: { "/a/docs": listing("/a/docs", []) } });
    await h.mod.goToPath("/a/docs");
    expect(active(h.mod).browsing).toBe("/a/docs");
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
    expect(active(h.mod).browsing).toBe("/a/docs");
    expect(active(h.mod).preview?.path).toBe("/a/docs/readme.md");
    expect(active(h.mod).history).toEqual(["/a"]);
  });

  it("expands ~ against the home directory", async () => {
    const h = await bootFiles({ listings: { "/home/demo": listing("/home/demo", []) } });
    await h.mod.initFiles();
    await h.mod.goToPath("~");
    expect(active(h.mod).browsing).toBe("/home/demo");
  });

  it("refuses a relative path instead of rooting it at /", async () => {
    const h = await bootFiles();
    await h.mod.goToPath("docs");
    expect(active(h.mod).browsing).toBeNull();
    expect(h.files.notice).not.toBeNull();
    expect(h.api.listDir).not.toHaveBeenCalled();
  });

  it("refuses a relative path without opening a tab for it", async () => {
    const h = await bootFiles();
    // No tab at all: the path box is reachable before the first landing, and
    // a rejected jump must not leave a blank tab behind.
    h.files.tabs.length = 0;
    h.files.activeTabId = null;
    await h.mod.goToPath("docs");
    expect(h.files.tabs).toHaveLength(0);
    expect(h.files.notice).not.toBeNull();
  });
});

describe("quick search", () => {
  it("passes the project root and the hidden toggle through", async () => {
    const h = await bootFiles();
    await h.mod.quickSearch("/project", "readme");
    expect(h.api.searchFiles).toHaveBeenCalledWith("/project", "readme", {
      includeHidden: false,
    });
    expect(active(h.mod).quickResults.map((e) => e.name)).toEqual(["hit.md"]);
  });

  it("clears results for an empty query without calling the backend", async () => {
    const h = await bootFiles();
    await h.mod.quickSearch("/project", "   ");
    expect(h.api.searchFiles).not.toHaveBeenCalled();
    expect(active(h.mod).quickResults).toEqual([]);
  });

  it("reports a failed search as a code", async () => {
    const h = await bootFiles();
    h.api.searchFiles.mockResolvedValueOnce({ ok: false, error: { code: "permission" } });
    await h.mod.quickSearch("/project", "x");
    expect(active(h.mod).quickError?.code).toBe("permission");
  });

  it("keeps ignored names out of the results", async () => {
    const h = await bootFiles();
    // The listing and the tree hide these; the quick box sits in the same
    // panel, so an ignored hit would open into a preview with no visible row.
    h.api.searchFiles.mockResolvedValueOnce({
      ok: true,
      value: [entry("keep.md"), entry("node_modules"), entry("dist", true)],
    });
    await h.mod.quickSearch("/project", "k");
    expect(active(h.mod).quickResults.map((e) => e.name)).toEqual(["keep.md"]);
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

describe("first landing", () => {
  /**
   * A jump-in from the canvas (tree click, "open in new tab", dock click)
   * switches the middle view and claims a tab in the same gesture. The view
   * switch schedules ensureBrowsing as a watcher job, so the two interleave
   * on the microtask queue exactly as they do in the app: the jump runs its
   * synchronous part first, the watcher's landing resolves after it.
   */
  function coldBrowser(h: Awaited<ReturnType<typeof bootFiles>>) {
    h.files.tabs.length = 0;
    h.files.activeTabId = null;
    return (root: string) => Promise.resolve().then(() => h.mod.ensureBrowsing(root));
  }

  it("a view switch never hijacks the tab an open-in-new-tab just claimed", async () => {
    const h = await bootFiles({
      listings: {
        "/proj": listing("/proj", [entry("docs", true)]),
        "/proj/docs": listing("/proj/docs", []),
      },
    });
    const firstLanding = coldBrowser(h)("/proj");
    const opening = h.mod.openFileTabFor("/proj/docs");
    await Promise.all([firstLanding, opening]);

    // The landing stepped aside: one tab, on the folder that was asked for.
    // Without the guard it browses the project root instead — its listing is
    // the newer one, so the folder's own answer is retired as stale.
    expect(h.files.tabs).toHaveLength(1);
    expect(active(h.mod).browsing).toBe("/proj/docs");
  });

  it("a dock jump keeps the listing its preview needs", async () => {
    const h = await bootFiles({
      listings: {
        "/proj": listing("/proj", []),
        "/proj/docs": listing("/proj/docs", [
          { ...entry("readme.md"), path: "/proj/docs/readme.md" },
        ]),
      },
    });
    const firstLanding = coldBrowser(h)("/proj");
    const jump = h.mod.previewEntry({ ...entry("readme.md"), path: "/proj/docs/readme.md" });
    await Promise.all([firstLanding, jump]);

    // The listing under the preview describes the previewed file's own
    // directory; landing on the project root would drop the selection the
    // jump just made and take the preview with it.
    expect(active(h.mod).browsing).toBe("/proj/docs");
    expect(active(h.mod).preview?.path).toBe("/proj/docs/readme.md");
  });

  it("lands a tab nobody claimed on the project root, once", async () => {
    const h = await bootFiles({ listings: { "/proj": listing("/proj", []) } });
    const firstLanding = coldBrowser(h)("/proj");
    await firstLanding;
    expect(active(h.mod).browsing).toBe("/proj");
    expect(h.api.listDir).toHaveBeenCalledTimes(1);
  });
});

describe("nested listing rows", () => {
  /** Entries whose paths really sit under `dir` (the entry() helper roots at /root). */
  function under(dir: string, entries: FileEntry[]): FileEntry[] {
    return entries.map((e) => ({ ...e, path: `${dir}/${e.name}` }));
  }

  it("unfolds an expanded folder's children under it, recursively", async () => {
    const h = await bootFiles({
      listings: {
        "/proj": listing("/proj", under("/proj", [entry("docs", true), entry("README.md")])),
        "/proj/docs": listing(
          "/proj/docs",
          under("/proj/docs", [entry("deep", true), entry("a.md")]),
        ),
        "/proj/docs/deep": listing("/proj/docs/deep", under("/proj/docs/deep", [entry("b.ts")])),
      },
    });
    await h.mod.browseTo("/proj");
    await h.mod.loadTreeChildren("/proj/docs");
    await h.mod.loadTreeChildren("/proj/docs/deep");

    // Folded: the listed directory's own entries only.
    expect(h.mod.nestedListingRows(h.mod.visibleEntries()).map((r) => r.entry.name)).toEqual([
      "docs",
      "README.md",
    ]);

    await h.mod.toggleTreeNode("/proj/docs");
    expect(h.mod.nestedListingRows(h.mod.visibleEntries())).toMatchObject([
      { entry: { name: "docs" }, depth: 0, expanded: true },
      { entry: { name: "deep" }, depth: 1, expanded: false },
      { entry: { name: "a.md" }, depth: 1 },
      { entry: { name: "README.md" }, depth: 0 },
    ]);

    // A folder opened inside an opened folder nests one level deeper.
    await h.mod.toggleTreeNode("/proj/docs/deep");
    expect(
      h.mod.nestedListingRows(h.mod.visibleEntries()).map((r) => [r.entry.name, r.depth]),
    ).toEqual([
      ["docs", 0],
      ["deep", 1],
      ["b.ts", 2],
      ["a.md", 1],
      ["README.md", 0],
    ]);
  });

  it("carries a folder's read failure on its row instead of unfolding into silence", async () => {
    const h = await bootFiles({
      listings: {
        "/proj": listing("/proj", under("/proj", [entry("locked", true)])),
        "/proj/locked": { ok: false, error: { code: "permission" } },
      },
    });
    await h.mod.browseTo("/proj");
    await h.mod.toggleTreeNode("/proj/locked");
    const rows = h.mod.nestedListingRows(h.mod.visibleEntries());
    expect(rows).toMatchObject([{ entry: { name: "locked" }, expanded: true }]);
    expect(rows[0]?.error).toEqual({ code: "permission" });
  });

  it("keeps the name filter on the listed directory, not on what unfolds", async () => {
    const h = await bootFiles({
      listings: {
        "/proj": listing("/proj", under("/proj", [entry("docs", true), entry("README.md")])),
        "/proj/docs": listing("/proj/docs", under("/proj/docs", [entry("a.md"), entry("b.md")])),
      },
    });
    await h.mod.browseTo("/proj");
    await h.mod.toggleTreeNode("/proj/docs");
    h.mod.setFilter("docs");
    // "docs" survives the filter (it matches); its children arrive unfiltered
    // — the box scopes to the directory being looked at, not to the subtree.
    expect(h.mod.nestedListingRows(h.mod.visibleEntries()).map((r) => r.entry.name)).toEqual([
      "docs",
      "a.md",
      "b.md",
    ]);
  });
});

describe("tabs", () => {
  it("keeps each tab's position, selection and preview apart", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", [{ ...entry("readme.md"), path: "/a/readme.md" }]),
        "/b": listing("/b", [{ ...entry("other.md"), path: "/b/other.md" }]),
      },
    });
    await h.mod.browseTo("/a");
    await h.mod.previewEntry({ ...entry("readme.md"), path: "/a/readme.md" });

    await h.mod.openFileTab("/b");
    // The new tab starts empty: no inherited selection or preview.
    expect(active(h.mod).selectedPath).toBeNull();
    expect(active(h.mod).preview).toBeNull();
    await h.mod.previewEntry({ ...entry("other.md"), path: "/b/other.md" });
    expect(active(h.mod).preview?.path).toBe("/b/other.md");

    // Switching back restores the first tab exactly as it was left.
    await h.mod.activateFileTab(h.files.tabs[0].id);
    expect(active(h.mod).browsing).toBe("/a");
    expect(active(h.mod).selectedPath).toBe("/a/readme.md");
    expect(active(h.mod).preview?.path).toBe("/a/readme.md");
    expect(active(h.mod).preview?.text).toBe("text of /a/readme.md");
  });

  it("walks each tab's own back and forward stacks", async () => {
    const h = await bootFiles({
      listings: {
        "/a": listing("/a", []),
        "/a/b": listing("/a/b", []),
        "/c": listing("/c", []),
      },
    });
    await h.mod.browseTo("/a");
    await h.mod.browseTo("/a/b");
    await h.mod.openFileTab("/c");
    await h.mod.browseTo("/a");

    // Tab two has its own stack; going back lands on /c, not on tab one's /a/b.
    await h.mod.goBack();
    expect(active(h.mod).browsing).toBe("/c");
    // Tab one's stack is untouched.
    await h.mod.activateFileTab(h.files.tabs[0].id);
    await h.mod.goBack();
    expect(active(h.mod).browsing).toBe("/a");
    expect(active(h.mod).forward).toEqual(["/a/b"]);
  });

  it("dedupes a directory onto its existing tab", async () => {
    const h = await bootFiles({
      listings: { "/a": listing("/a", []), "/b": listing("/b", []) },
    });
    await h.mod.browseTo("/a");
    await h.mod.openFileTab("/b");
    await h.mod.openFileTabFor("/a");
    expect(h.files.tabs).toHaveLength(2);
    expect(active(h.mod).browsing).toBe("/a");
  });

  it("closing the active tab activates its neighbour", async () => {
    const h = await bootFiles({
      listings: { "/a": listing("/a", []), "/b": listing("/b", []) },
    });
    await h.mod.browseTo("/a");
    await h.mod.openFileTab("/b");
    const first = h.files.tabs[0].id;
    await h.mod.closeFileTab(first);
    expect(h.files.tabs).toHaveLength(1);
    expect(active(h.mod).browsing).toBe("/b");
  });

  it("closing the last tab leaves a parked one rather than an empty view", async () => {
    const h = await bootFiles({ listings: { "/a": listing("/a", []) } });
    await h.mod.browseTo("/a");
    const only = h.files.tabs[0].id;
    await h.mod.closeFileTab(only);
    expect(h.files.tabs).toHaveLength(1);
    expect(active(h.mod).browsing).not.toBe("/a");
  });

  it("retires a closing tab's in-flight preview", async () => {
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
      readFileAsDataUrl: vi.fn(async () => ({ ok: false, error: { code: "unsupported" } })),
      searchFiles: async () => ({ ok: true, value: [] }),
      homePath: async () => "/home/demo",
      relativeToRoot: async () => ({ ok: true, value: "x" }),
    };
    (globalThis as unknown as { window: { awefork: unknown } }).window = { awefork: api };
    const mod = await import("../src/renderer/src/files");
    // Land first, so the read under test is not preceded by the parked tab's
    // parent-listing navigation.
    await mod.browseTo("/root");

    const first = mod.previewEntry(entry("first.md"));
    // Wait for the read to hang on the gate (see the sibling race test).
    let spins = 0;
    while (gates.length < 1 && spins < 500) {
      await Promise.resolve();
      spins += 1;
    }
    expect(gates).toHaveLength(1);
    await mod.closeFileTab(mod.files.tabs[0].id);
    gates[0]?.();
    await first;
    // The tab is gone, so nothing can show the late answer.
    expect(mod.files.tabs).toHaveLength(1);
    expect(active(mod).preview).toBeNull();
  });

  it("labels a tab by its directory name, disambiguating a clash", async () => {
    const h = await bootFiles({
      listings: { "/one/src": listing("/one/src", []), "/two/src": listing("/two/src", []) },
    });
    await h.mod.browseTo("/one/src");
    await h.mod.openFileTab("/two/src");
    const labels = h.files.tabs.map((entry) => h.mod.fileTabLabel(entry));
    expect(labels).toEqual(["one/src", "two/src"]);
  });

  it("clamps the split width so the listing keeps a floor", async () => {
    const h = await bootFiles();
    await h.mod.browseTo("/a");
    // A 660px body: the hard 640 cap would leave the listing 14px wide, so
    // the available space wins and the floor is honoured.
    h.mod.setPreviewWidth(640, 660);
    expect(active(h.mod).previewWidth).toBe(660 - 240);
    // A wide body still caps at 640.
    h.mod.setPreviewWidth(900, 1400);
    expect(active(h.mod).previewWidth).toBe(640);
    // The floor holds at the bottom too.
    h.mod.setPreviewWidth(10, 1400);
    expect(active(h.mod).previewWidth).toBe(220);
  });

  it("keeps the listing scroll per tab", async () => {
    const h = await bootFiles();
    await h.mod.browseTo("/a");
    h.mod.setListingScroll(1234);
    expect(active(h.mod).scrollTop).toBe(1234);
    await h.mod.openFileTab("/b");
    // The new tab starts unscrolled; A's offset is untouched.
    expect(active(h.mod).scrollTop).toBe(0);
    expect(h.files.tabs[0].scrollTop).toBe(1234);
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
