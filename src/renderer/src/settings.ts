/**
 * Persisted renderer preferences: one JSON blob under `awefork:settings`,
 * replacing the handful of one-key-per-preference entries the app grew
 * (theme, locale, layout, multi-window). Everything here survives restarts
 * and is visible to every window at its own boot.
 *
 * Why one blob instead of a key per preference: the settings page renders
 * the whole surface at once, and a single document means one read at boot,
 * one write per change, and a shape that a future "export settings" can
 * hand out verbatim. Unknown keys survive a round trip, so an older build
 * opening a newer file never drops what it does not understand.
 *
 * Two deliberate boundaries:
 *   - Per-backend state (tags, pins, favorites, the open project) is NOT
 *     here — it lives in main-process sidecars routed by backend.
 *   - Machine facts (app version, installed CLIs) are NOT here either; they
 *     are probed, not chosen.
 *
 * Reads are total: a corrupt or missing file falls back to defaults and
 * never blocks boot.
 */
import { reactive, watch } from "vue";
import type { ModelChoice, ParallelSummaryLength } from "../../shared/types";

const STORAGE_KEY = "awefork:settings";

/** Theme preference; "system" follows the OS appearance. */
export type ThemePreference = "light" | "dark" | "system";

/** Row density for the session lists and settings rows. */
export type Density = "comfortable" | "compact";

/** What the middle column opens on. */
export type DefaultView = "canvas" | "files";

/** Relative ("5 min ago") vs absolute ("14:32") timestamps. */
export type TimeStyle = "relative" | "absolute";

/** Where a double-clicked file goes. */
export type FileOpenTarget = "system" | "preview";

export interface Settings {
  appearance: {
    theme: ThemePreference;
    density: Density;
    /** Transitions on cards, popovers and the canvas. */
    motion: boolean;
    /** The dotted backdrop behind the branch canvas. */
    dotGrid: boolean;
  };
  language: {
    locale: "zh" | "en";
    timeStyle: TimeStyle;
  };
  backend: {
    /**
     * Only consulted by the settings page's copy ("a switch confirms
     * first"); the actual selection lives in main's settings.json so a
     * switch survives even if the renderer never writes this file.
     */
    warnRange: boolean;
  };
  canvas: {
    /** Picking a backend opens its own window instead of switching in place. */
    multiWindow: boolean;
    /** Middle column on boot and for new story tabs. */
    defaultView: DefaultView;
    /** Fit the branch tree into view when a session or tab opens. */
    autoFit: boolean;
    minimap: boolean;
    /** Auto-deny a pending decision after this many seconds; 0 = never. */
    autoDenySeconds: number;
    /** Ask before deleting a turn (session deletes ride the undo toast). */
    confirmDelete: boolean;
    /**
     * Sessions open in a fresh tab — created ones and ones picked from the
     * lists — instead of replacing the active tab's story.
     */
    sessionsInNewTab: boolean;
  };
  files: {
    showHidden: boolean;
    view: "list" | "grid";
    /** Text preview cap in KB; main clamps to its own ceiling. */
    previewCapKb: number;
    /** Image preview cap in MB; main clamps to its own ceiling. */
    imageCapMb: number;
    /**
     * Names hidden in the browser and the sidebar tree. Plain names match
     * exactly; `*` is the only wildcard ("*.log", "build-*").
     */
    ignore: string[];
    /** Double-click opens the system app or the in-app preview. */
    openOnDouble: FileOpenTarget;
  };
  search: {
    scopes: { title: boolean; tag: boolean; body: boolean };
    /** Result cap; 0 = unlimited. */
    cap: number;
  };
  updates: {
    checkOnLaunch: boolean;
  };
  /**
   * Experiments: features that work but may still change shape or be pulled
   * back. Defaults are off; a feature graduates by moving its rows into the
   * regular sections and deleting the switch here.
   */
  labs: {
    /** The file browsing system: middle-column browser, sidebar tree, dock jumps. */
    fileBrowser: boolean;
    /** Multi-model parallel prompts: fork per model, read side by side, summarize. */
    parallelModels: boolean;
    /**
     * Defaults for multi-model prompts. Targets are pre-selected when the
     * mode opens; a pick the current catalog no longer lists is skipped
     * rather than sent. Summary "none" leaves the round unsummarized.
     */
    parallel: {
      targets: ModelChoice[];
      summaryModel: ModelChoice | null;
      summaryLength: ParallelSummaryLength;
    };
  };
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: "system", density: "comfortable", motion: true, dotGrid: true },
  language: { locale: "zh", timeStyle: "relative" },
  backend: { warnRange: true },
  canvas: {
    multiWindow: true,
    defaultView: "canvas",
    autoFit: true,
    minimap: true,
    autoDenySeconds: 30,
    confirmDelete: true,
    sessionsInNewTab: true,
  },
  files: {
    showHidden: false,
    view: "list",
    previewCapKb: 512,
    imageCapMb: 8,
    ignore: ["node_modules", "dist", "out", "build"],
    // A double-click stays inside the app: the in-app preview. The system
    // app is one right-click away (and the setting still switches it back).
    openOnDouble: "preview",
  },
  search: { scopes: { title: true, tag: true, body: false }, cap: 1000 },
  updates: { checkOnLaunch: true },
  labs: {
    fileBrowser: false,
    parallelModels: false,
    parallel: { targets: [], summaryModel: null, summaryLength: "brief" },
  },
};

/** Most models one multi-model round may address. */
export const MAX_PARALLEL_TARGETS = 4;
/** Longest ignore list. */
const MAX_IGNORE_PATTERNS = 32;
/** Longest single pattern: a paste longer than this is an accident, and a
 *  giant pattern compiles into a giant regex. */
const MAX_IGNORE_PATTERN_CHARS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Ignore patterns, cleaned the one way both entry points need: trimmed,
 * de-duplicated, length-capped and count-capped; a malformed list falls
 * back wholesale.
 */
function pickIgnorePatterns(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name === "" || name.length > MAX_IGNORE_PATTERN_CHARS || seen.has(name)) continue;
    seen.add(name);
    list.push(name);
    if (list.length >= MAX_IGNORE_PATTERNS) break;
  }
  return list;
}

/**
 * The settings page edits the live reactive object instead of going through
 * normalizeSettings, so its writes run through the same rules here — an
 * over-long paste is capped on the spot rather than silently trimmed on the
 * next boot.
 */
export function sanitizeIgnorePatterns(value: readonly string[]): string[] {
  return pickIgnorePatterns(value, DEFAULT_SETTINGS.files.ignore);
}

/** A stored model pick, or null when the entry is unusable. */
function pickModelChoice(value: unknown): ModelChoice | null {
  if (!isRecord(value)) return null;
  const providerId = typeof value.providerId === "string" ? value.providerId.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (providerId === "" || modelId === "") return null;
  const variant = typeof value.variant === "string" ? value.variant.trim() : "";
  return variant === "" ? { providerId, modelId } : { providerId, modelId, variant };
}

/**
 * Coerce a parsed blob into a total Settings. Every field is validated on
 * its own, so one corrupt key costs only that key — the rest of the file
 * still applies.
 */
export function normalizeSettings(raw: unknown): Settings {
  const root = isRecord(raw) ? raw : {};
  const appearance = isRecord(root.appearance) ? root.appearance : {};
  const language = isRecord(root.language) ? root.language : {};
  const backend = isRecord(root.backend) ? root.backend : {};
  const canvas = isRecord(root.canvas) ? root.canvas : {};
  const files = isRecord(root.files) ? root.files : {};
  const search = isRecord(root.search) ? root.search : {};
  const scopes = isRecord(search.scopes) ? search.scopes : {};
  const updates = isRecord(root.updates) ? root.updates : {};
  const labs = isRecord(root.labs) ? root.labs : {};
  const parallel = isRecord(labs.parallel) ? labs.parallel : {};
  const d = DEFAULT_SETTINGS;
  return {
    appearance: {
      theme: pickEnum(appearance.theme, ["light", "dark", "system"] as const, d.appearance.theme),
      density: pickEnum(
        appearance.density,
        ["comfortable", "compact"] as const,
        d.appearance.density,
      ),
      motion: pickBool(appearance.motion, d.appearance.motion),
      dotGrid: pickBool(appearance.dotGrid, d.appearance.dotGrid),
    },
    language: {
      locale: pickEnum(language.locale, ["zh", "en"] as const, d.language.locale),
      timeStyle: pickEnum(
        language.timeStyle,
        ["relative", "absolute"] as const,
        d.language.timeStyle,
      ),
    },
    backend: { warnRange: pickBool(backend.warnRange, d.backend.warnRange) },
    canvas: {
      multiWindow: pickBool(canvas.multiWindow, d.canvas.multiWindow),
      defaultView: pickEnum(canvas.defaultView, ["canvas", "files"] as const, d.canvas.defaultView),
      autoFit: pickBool(canvas.autoFit, d.canvas.autoFit),
      minimap: pickBool(canvas.minimap, d.canvas.minimap),
      autoDenySeconds: pickNumber(canvas.autoDenySeconds, d.canvas.autoDenySeconds, 0, 300),
      confirmDelete: pickBool(canvas.confirmDelete, d.canvas.confirmDelete),
      // The new key wins; the pre-rename `newSessionInTab` keeps an upgrade
      // from re-enabling the tab behavior for users who had turned it off.
      sessionsInNewTab: pickBool(
        canvas.sessionsInNewTab,
        pickBool(canvas.newSessionInTab, d.canvas.sessionsInNewTab),
      ),
    },
    files: {
      showHidden: pickBool(files.showHidden, d.files.showHidden),
      view: pickEnum(files.view, ["list", "grid"] as const, d.files.view),
      previewCapKb: pickNumber(files.previewCapKb, d.files.previewCapKb, 1, 512),
      imageCapMb: pickNumber(files.imageCapMb, d.files.imageCapMb, 1, 8),
      ignore: pickIgnorePatterns(files.ignore, d.files.ignore),
      openOnDouble: pickEnum(
        files.openOnDouble,
        ["system", "preview"] as const,
        d.files.openOnDouble,
      ),
    },
    search: {
      scopes: {
        title: pickBool(scopes.title, d.search.scopes.title),
        tag: pickBool(scopes.tag, d.search.scopes.tag),
        body: pickBool(scopes.body, d.search.scopes.body),
      },
      cap: pickNumber(search.cap, d.search.cap, 0, 10_000),
    },
    updates: { checkOnLaunch: pickBool(updates.checkOnLaunch, d.updates.checkOnLaunch) },
    labs: {
      fileBrowser: pickBool(labs.fileBrowser, d.labs.fileBrowser),
      parallelModels: pickBool(labs.parallelModels, d.labs.parallelModels),
      parallel: {
        targets: Array.isArray(parallel.targets)
          ? parallel.targets
              .map(pickModelChoice)
              .filter((choice): choice is ModelChoice => choice !== null)
              .slice(0, MAX_PARALLEL_TARGETS)
          : [],
        summaryModel: parallel.summaryModel != null ? pickModelChoice(parallel.summaryModel) : null,
        summaryLength: pickEnum(
          parallel.summaryLength,
          ["brief", "standard", "none"] as const,
          d.labs.parallel.summaryLength,
        ),
      },
    },
  };
}

/**
 * The keys the app wrote before this module existed. Read once at boot and
 * folded into the blob so an upgrade keeps the user's theme, language and
 * layout; the legacy keys are then removed. Kept as a function (not a
 * top-level read) so tests can boot the module against a seeded storage.
 */
export function migrateLegacy(storage: Storage): Partial<Settings> {
  const patch: {
    appearance?: Partial<Settings["appearance"]>;
    language?: Partial<Settings["language"]>;
    canvas?: Partial<Settings["canvas"]>;
  } = {};
  const theme = storage.getItem("awefork:theme");
  if (theme === "dark" || theme === "light") patch.appearance = { theme };
  const locale = storage.getItem("awefork:locale");
  if (locale === "zh" || locale === "en") patch.language = { locale };
  const multiWindow = storage.getItem("awefork:multiWindow");
  if (multiWindow === "0" || multiWindow === "1")
    patch.canvas = { multiWindow: multiWindow === "1" };
  for (const key of ["awefork:theme", "awefork:locale", "awefork:multiWindow"]) {
    storage.removeItem(key);
  }
  return patch as Partial<Settings>;
}

function readSettings(storage: Storage | undefined): { value: Settings; migrated: boolean } {
  if (!storage) return { value: structuredClone(DEFAULT_SETTINGS), migrated: false };
  let parsed: unknown = null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const legacy = migrateLegacy(storage);
  const merged = normalizeSettings(parsed);
  // Legacy values only fill fields the new file has never set — an existing
  // blob is authoritative, so a stale old key can't override a newer choice.
  if (parsed === null && Object.keys(legacy).length > 0) {
    return { value: normalizeSettings({ ...merged, ...legacy }), migrated: true };
  }
  return { value: merged, migrated: false };
}

function storageOrUndefined(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

const initial = readSettings(storageOrUndefined());

/** The live settings object every surface reads. Mutate it in place. */
export const settings = reactive<Settings>(initial.value);

/**
 * Write the whole blob whenever anything changes. Watching deeply (rather
 * than writing at each call site) means a new preference needs no plumbing:
 * set the field and persistence follows.
 */
if (typeof localStorage !== "undefined") {
  // A migration that folded old keys in must land on disk immediately, before
  // the next boot — otherwise the legacy keys are already gone and a reload
  // would silently fall back to defaults.
  if (initial.migrated) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Quota or a locked profile: the in-memory value still applies.
    }
  }
  watch(
    settings,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Quota or a locked profile: preferences stay in memory for this
        // session rather than throwing at a random call site.
      }
    },
    { deep: true },
  );
}

/** Replace one section wholesale (the settings page's "reset section"). */
export function resetSection<K extends keyof Settings>(section: K): void {
  (settings as Settings)[section] = structuredClone(DEFAULT_SETTINGS[section]);
}

/** Restore every preference; per-backend sidecars are untouched. */
export function resetAllSettings(): void {
  Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
}
