import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, shell } from "electron";
import { writeFileAtomic } from "../shared/atomic-write.js";
import type { CheckUpdatesResult } from "../shared/awefork-api.js";

/**
 * "Check for a newer release" lives in the main process: the renderer never
 * sees the GitHub API nor builds release URLs itself. Every entry point here
 * fails soft — a network hiccup or a corrupt sidecar surfaces as "no update",
 * never as a thrown IPC rejection.
 */

export const RELEASES_API_URL = "https://api.github.com/repos/wehuman01/awefork/releases/latest";
const RELEASES_DOWNLOAD_BASE = "https://github.com/wehuman01/awefork/releases/download";

/** skips: `v0.1.7` -> `0.1.7`; anything shorter, longer or non-numeric -> null. */
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function normalizeVersion(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const match = VERSION_PATTERN.exec(raw);
  if (!match) return null;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return `${major}.${minor}.${patch}`;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const normalizedCandidate = normalizeVersion(candidate);
  const normalizedCurrent = normalizeVersion(current);
  if (!normalizedCandidate || !normalizedCurrent) return false;
  const parts = (version: string): [number, number, number] => {
    const [major, minor, patch] = version.split(".") as [string, string, string];
    return [Number(major), Number(minor), Number(patch)];
  };
  const [candidateMajor, candidateMinor, candidatePatch] = parts(normalizedCandidate);
  const [currentMajor, currentMinor, currentPatch] = parts(normalizedCurrent);
  return (
    candidateMajor > currentMajor ||
    (candidateMajor === currentMajor &&
      (candidateMinor > currentMinor ||
        (candidateMinor === currentMinor && candidatePatch > currentPatch)))
  );
}

/** Filename of the release artifact for a platform, or null when unsupported. */
export function updateAssetFilename(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  if (platform === "darwin") return `awefork-${normalized}-${arch}.dmg`;
  if (platform === "win32") return `awefork-${normalized}-${arch}-setup.exe`;
  return null;
}

/** Download URL of a platform artifact, built only from a validated semver. */
export function updateAssetUrl(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const normalized = normalizeVersion(version);
  const filename = updateAssetFilename(version, platform, arch);
  if (!normalized || !filename) return null;
  return `${RELEASES_DOWNLOAD_BASE}/v${normalized}/${filename}`;
}

/**
 * Best-effort latest-release fetch; every failure path returns null. The
 * response carries the release's asset list so the caller can tell a notes-only
 * release (no installers attached) from one the user can actually install.
 */
export async function fetchLatestRelease(): Promise<{
  version: string;
  assetNames: string[];
} | null> {
  let response: Response;
  try {
    response = await fetch(RELEASES_API_URL, {
      headers: { "User-Agent": "awefork" },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const release = (await response.json()) as {
      tag_name?: unknown;
      assets?: unknown;
    };
    if (typeof release.tag_name !== "string") return null;
    const version = normalizeVersion(release.tag_name);
    if (!version) return null;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const assetNames = assets
      .map((asset) =>
        asset && typeof asset === "object" ? (asset as { name?: unknown }).name : null,
      )
      .filter((name): name is string => typeof name === "string");
    return { version, assetNames };
  } catch {
    return null;
  }
}

/**
 * True when the release ships an installer this platform's build can use. A
 * notes-only release (a tag pushed without building) has no dmg/exe asset, so
 * prompting about it would offer an update the app cannot install — the user
 * would follow the banner into a download 404.
 */
export function hasPlatformInstaller(
  version: string,
  assetNames: string[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  const filename = updateAssetFilename(version, platform, arch);
  if (!filename) return false;
  return assetNames.includes(filename);
}

/**
 * Sidecar storing the version the user chose to stop being nagged about.
 * `app.getPath` is called lazily inside the function — the module stays
 * importable (and testable) outside a running Electron app.
 */
const UPDATE_FILE_NAME = "update.json";

function updateFilePath(): string {
  return join(app.getPath("userData"), UPDATE_FILE_NAME);
}

export async function readSkippedVersion(filePath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = (parsed as { skippedVersion?: unknown }).skippedVersion;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function writeSkippedVersion(filePath: string, version: string | null): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify({ skippedVersion: version }, null, 2)}\n`);
}

export async function checkForUpdates(respectSkip: boolean): Promise<CheckUpdatesResult> {
  try {
    const currentVersion = app.getVersion();
    const release = await fetchLatestRelease();
    const skippedVersion = await readSkippedVersion(updateFilePath());
    const updateAvailable =
      release !== null &&
      isNewerVersion(release.version, currentVersion) &&
      hasPlatformInstaller(release.version, release.assetNames) &&
      (!respectSkip || release.version !== skippedVersion);
    return { currentVersion, latest: release?.version ?? null, updateAvailable };
  } catch {
    return { currentVersion: app.getVersion(), latest: null, updateAvailable: false };
  }
}

export async function skipUpdate(version: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeVersion(version);
  if (!normalized) return { ok: false, error: "invalid version" };
  try {
    await writeSkippedVersion(updateFilePath(), normalized);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Only ever opens a release page URL built here — never a renderer-supplied URL. */
export async function openRelease(version: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeVersion(version);
  if (!normalized) return { ok: false, error: "invalid version" };
  try {
    await shell.openExternal(`https://github.com/wehuman01/awefork/releases/tag/v${normalized}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
