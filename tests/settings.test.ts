import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  migrateLegacy,
  normalizeSettings,
  type Settings,
} from "../src/renderer/src/settings";

/**
 * settings.ts reads localStorage at import time, so each test seeds an
 * in-memory storage and boots a fresh module — the same pattern
 * tests/layout.test.ts uses for the layout singleton.
 */

type SettingsModule = typeof import("../src/renderer/src/settings");

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

async function boot(seed?: Record<string, string>): Promise<SettingsModule> {
  for (const [key, value] of Object.entries(seed ?? {})) storage.setItem(key, value);
  vi.resetModules();
  return await import("../src/renderer/src/settings");
}

describe("normalizeSettings", () => {
  it("returns the defaults for anything that is not a settings object", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and replaces invalid ones field by field", () => {
    const result = normalizeSettings({
      appearance: { theme: "dark", density: "tiny", motion: "yes" },
      language: { locale: "en", timeStyle: "clock" },
    });
    expect(result.appearance.theme).toBe("dark");
    expect(result.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    expect(result.appearance.motion).toBe(DEFAULT_SETTINGS.appearance.motion);
    expect(result.language.locale).toBe("en");
    expect(result.language.timeStyle).toBe(DEFAULT_SETTINGS.language.timeStyle);
  });

  it("clamps numeric caps into the range the call sites accept", () => {
    const result = normalizeSettings({
      canvas: { autoDenySeconds: 9999 },
      files: { previewCapKb: 0, imageCapMb: -4 },
      search: { cap: 99_999 },
    });
    expect(result.canvas.autoDenySeconds).toBe(300);
    expect(result.files.previewCapKb).toBe(1);
    expect(result.files.imageCapMb).toBe(1);
    expect(result.search.cap).toBe(10_000);
  });

  it("rounds fractional numbers instead of keeping them", () => {
    const result = normalizeSettings({ files: { previewCapKb: 256.7 } });
    expect(result.files.previewCapKb).toBe(257);
  });

  it("treats NaN and Infinity as absent", () => {
    const result = normalizeSettings({ canvas: { autoDenySeconds: Number.NaN } });
    expect(result.canvas.autoDenySeconds).toBe(DEFAULT_SETTINGS.canvas.autoDenySeconds);
    const infinite = normalizeSettings({ files: { imageCapMb: Number.POSITIVE_INFINITY } });
    expect(infinite.files.imageCapMb).toBe(DEFAULT_SETTINGS.files.imageCapMb);
  });

  it("drops unknown keys rather than passing them through", () => {
    const result = normalizeSettings({ future: { toggle: true }, appearance: { theme: "dark" } });
    expect(result).not.toHaveProperty("future");
    expect(result.appearance.theme).toBe("dark");
  });

  it("keeps usable parallel defaults and repairs the rest", () => {
    const result = normalizeSettings({
      labs: {
        parallel: {
          targets: [
            { providerId: "zcode", modelId: "glm-5.3", variant: "high" },
            { providerId: "", modelId: "no-provider" },
            { modelId: "no-provider-id" },
            { providerId: "zcode", modelId: "glm-5.3", variant: "" },
            "nonsense",
          ],
          summaryModel: { providerId: "zcode", modelId: "glm-5.3-flash" },
          summaryLength: "none",
        },
      },
    });
    expect(result.labs.parallel.targets).toEqual([
      { providerId: "zcode", modelId: "glm-5.3", variant: "high" },
      { providerId: "zcode", modelId: "glm-5.3" },
    ]);
    expect(result.labs.parallel.summaryModel).toEqual({
      providerId: "zcode",
      modelId: "glm-5.3-flash",
    });
    expect(result.labs.parallel.summaryLength).toBe("none");
  });

  it("falls back to the defaults for a parallel section that is not an object", () => {
    const result = normalizeSettings({ labs: { parallel: "nonsense" } });
    expect(result.labs.parallel).toEqual(DEFAULT_SETTINGS.labs.parallel);
  });

  it("caps the parallel target list at four", () => {
    const targets = [1, 2, 3, 4, 5, 6].map((n) => ({
      providerId: "zcode",
      modelId: `model-${n}`,
    }));
    expect(
      normalizeSettings({ labs: { parallel: { targets } } }).labs.parallel.targets,
    ).toHaveLength(4);
  });

  it("keeps the multi-model auto-open switch and repairs the rest", () => {
    expect(normalizeSettings({}).labs.parallel.autoOpenReading).toBe(false);
    expect(
      normalizeSettings({ labs: { parallel: { autoOpenReading: true } } }).labs.parallel
        .autoOpenReading,
    ).toBe(true);
    expect(
      normalizeSettings({ labs: { parallel: { autoOpenReading: "yes" } } }).labs.parallel
        .autoOpenReading,
    ).toBe(false);
  });

  it("keeps the story-digest switch on by default and honors an explicit off", () => {
    // The digest shipped as part of multi-model summarization, so its
    // switch is the opt-out — the default is on, not the labs usual off.
    expect(normalizeSettings({}).labs.parallel.digest).toBe(true);
    expect(normalizeSettings({ labs: { parallel: { digest: false } } }).labs.parallel.digest).toBe(
      false,
    );
    expect(normalizeSettings({ labs: { parallel: { digest: "off" } } }).labs.parallel.digest).toBe(
      true,
    );
  });

  it("shows every overview trigger stat until one is turned off", () => {
    expect(normalizeSettings({}).labs.overview).toEqual({
      showRunning: true,
      showWaiting: true,
      showUnread: true,
    });
    const result = normalizeSettings({
      labs: { overview: { showRunning: false, showUnread: "no" } },
    });
    expect(result.labs.overview).toEqual({
      showRunning: false,
      showWaiting: true,
      showUnread: true,
    });
  });

  it("trims, de-duplicates and caps the ignore list", () => {
    const result = normalizeSettings({
      files: { ignore: [" node_modules ", "node_modules", "", "dist", 42, "out", "build", "x"] },
    });
    expect(result.files.ignore).toEqual(["node_modules", "dist", "out", "build", "x"]);
    expect(normalizeSettings({ files: { ignore: "nonsense" } }).files.ignore).toEqual(
      DEFAULT_SETTINGS.files.ignore,
    );
  });

  it("drops an ignore pattern that is too long to be one", () => {
    const huge = "a".repeat(129);
    const result = normalizeSettings({
      files: { ignore: ["dist", huge, "out"] },
    });
    expect(result.files.ignore).toEqual(["dist", "out"]);
  });

  it("caps the ignore list at the documented maximum", () => {
    const many = Array.from({ length: 40 }, (_, i) => `dir-${i}`);
    expect(normalizeSettings({ files: { ignore: many } }).files.ignore).toHaveLength(32);
  });

  it("keeps a resident folder path and treats anything else as unset", () => {
    expect(
      normalizeSettings({ files: { residentFolder: "  /work/app  " } }).files.residentFolder,
    ).toBe("/work/app");
    expect(normalizeSettings({ files: { residentFolder: "   " } }).files.residentFolder).toBe("");
    expect(normalizeSettings({ files: { residentFolder: 7 } }).files.residentFolder).toBe("");
    expect(normalizeSettings({}).files.residentFolder).toBe("");
  });

  it("keeps the common-places list, and null as never-seeded", () => {
    expect(normalizeSettings({}).files.places).toBeNull();
    expect(normalizeSettings({ files: { places: null } }).files.places).toBeNull();
    expect(
      normalizeSettings({ files: { places: [" /a ", "/a", "", 7, "/b"] } }).files.places,
    ).toEqual(["/a", "/b"]);
    // A malformed list reads as never-seeded rather than as "all deleted".
    expect(normalizeSettings({ files: { places: "nonsense" } }).files.places).toBeNull();
    expect(normalizeSettings({ files: { places: [] } }).files.places).toEqual([]);
  });

  it("caps the common-places list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `/dir-${i}`);
    expect(normalizeSettings({ files: { places: many } }).files.places).toHaveLength(12);
  });

  it("defaults the middle browser to on", () => {
    expect(normalizeSettings({}).files.middleBrowser).toBe(true);
    expect(normalizeSettings({ files: { middleBrowser: false } }).files.middleBrowser).toBe(false);
    expect(normalizeSettings({ files: { middleBrowser: "no" } }).files.middleBrowser).toBe(true);
  });
});

describe("sanitizeResidentFolder", () => {
  it("cleans a settings-page write the same way the load path does", async () => {
    const module = await boot();
    expect(module.sanitizeResidentFolder("  /work/app  ")).toBe("/work/app");
    expect(module.sanitizeResidentFolder(" ")).toBe("");
  });
});

describe("residentFolderUnset", () => {
  it("reports unset for a missing, partial or corrupt blob", async () => {
    const module = await boot();
    expect(module.residentFolderUnset()).toBe(true);
    storage.setItem("awefork:settings", JSON.stringify({ files: { showHidden: true } }));
    expect(module.residentFolderUnset()).toBe(true);
    storage.setItem("awefork:settings", "{not json");
    expect(module.residentFolderUnset()).toBe(false);
  });

  it("reports set once the key exists — even as an empty string", async () => {
    const module = await boot();
    storage.setItem("awefork:settings", JSON.stringify({ files: { residentFolder: "/work/app" } }));
    expect(module.residentFolderUnset()).toBe(false);
    // A cleared folder must never be re-adopted from the legacy sidecar.
    storage.setItem("awefork:settings", JSON.stringify({ files: { residentFolder: "" } }));
    expect(module.residentFolderUnset()).toBe(false);
  });
});

describe("sanitizeIgnorePatterns", () => {
  it("cleans a settings-page write the same way the load path does", async () => {
    const module = await boot();
    const cleaned = module.sanitizeIgnorePatterns([" node_modules ", "node_modules", "", "dist"]);
    expect(cleaned).toEqual(["node_modules", "dist"]);
  });

  it("caps an over-long paste on the spot rather than at the next boot", async () => {
    const module = await boot();
    const many = Array.from({ length: 40 }, (_, i) => `dir-${i}`);
    expect(module.sanitizeIgnorePatterns(many)).toHaveLength(32);
    expect(module.sanitizeIgnorePatterns(["a".repeat(500)])).toEqual([]);
  });
});

describe("migrateLegacy", () => {
  it("folds the old one-key preferences into the new shape", () => {
    storage.setItem("awefork:theme", "dark");
    storage.setItem("awefork:locale", "en");
    storage.setItem("awefork:multiWindow", "1");
    expect(migrateLegacy(storage as unknown as Storage)).toEqual({
      appearance: { theme: "dark" },
      language: { locale: "en" },
      canvas: { multiWindow: true },
    });
  });

  it("ignores unrecognised legacy values and still clears the keys", () => {
    storage.setItem("awefork:theme", "purple");
    storage.setItem("awefork:locale", "fr");
    const patch = migrateLegacy(storage as unknown as Storage);
    expect(patch).toEqual({});
    expect(storage.getItem("awefork:theme")).toBeNull();
    expect(storage.getItem("awefork:locale")).toBeNull();
  });
});

describe("boot", () => {
  it("uses the defaults on a clean storage", async () => {
    const module = await boot();
    expect(module.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("applies legacy values when no settings blob exists yet", async () => {
    const module = await boot({ "awefork:theme": "dark", "awefork:locale": "en" });
    expect(module.settings.appearance.theme).toBe("dark");
    expect(module.settings.language.locale).toBe("en");
    // The legacy keys are consumed, not left to be re-applied next boot.
    expect(storage.getItem("awefork:theme")).toBeNull();
  });

  it("writes the migrated values to disk so the next boot keeps them", async () => {
    // The old keys are gone after migration; without an immediate write the
    // second boot would read an empty blob and fall back to defaults.
    await boot({ "awefork:theme": "dark", "awefork:locale": "en" });
    const stored = JSON.parse(storage.getItem("awefork:settings") ?? "null") as Settings | null;
    expect(stored?.appearance.theme).toBe("dark");
    expect(stored?.language.locale).toBe("en");

    const second = await boot();
    expect(second.settings.appearance.theme).toBe("dark");
    expect(second.settings.language.locale).toBe("en");
  });

  it("does not write a blob when there was nothing to migrate", async () => {
    await boot();
    expect(storage.getItem("awefork:settings")).toBeNull();
  });

  it("lets an existing blob win over stale legacy keys", async () => {
    const module = await boot({
      "awefork:settings": JSON.stringify({ appearance: { theme: "light" } }),
      "awefork:theme": "dark",
    });
    expect(module.settings.appearance.theme).toBe("light");
  });

  it("falls back to defaults when the blob is corrupt", async () => {
    const module = await boot({ "awefork:settings": "{not json" });
    expect(module.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("persists a change through the deep watcher", async () => {
    const module = await boot();
    module.settings.appearance.density = "compact";
    await Promise.resolve();
    const stored = JSON.parse(storage.getItem("awefork:settings") ?? "{}") as Settings;
    expect(stored.appearance.density).toBe("compact");
  });
});

describe("reset", () => {
  it("resets one section without touching the others", async () => {
    const module = await boot();
    module.settings.appearance.density = "compact";
    module.settings.files.showHidden = true;
    module.resetSection("appearance");
    // The reset writes through the same reactive object the page renders, so
    // the untouched section must still hold its changed value.
    expect(module.settings.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    expect(module.settings.files.showHidden).toBe(true);
  });

  it("resets every section at once", async () => {
    const module = await boot();
    module.settings.canvas.minimap = false;
    module.settings.search.cap = 100;
    module.resetAllSettings();
    expect(module.settings.canvas.minimap).toBe(DEFAULT_SETTINGS.canvas.minimap);
    expect(module.settings.search.cap).toBe(DEFAULT_SETTINGS.search.cap);
  });
});
