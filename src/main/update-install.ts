import { execFile, spawn } from "node:child_process";
import { type FileHandle, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import { normalizeVersion } from "./update-check.js";

/**
 * "Download the new version and swap it in" lives in the main process: the
 * renderer only supplies a version string, and every download URL is built
 * here from a validated semver — no renderer-controlled URL ever reaches the
 * network or a subprocess.
 *
 * Windows: downloads the NSIS installer and hands off to it — the running
 * process cannot replace its own locked executable, and the installer already
 * knows how to prompt the user to close the app and swap the install. macOS:
 * mounts the DMG, replaces the running .app bundle (backup first, rollback on
 * failure), and relaunches. Files downloaded by the app itself carry no
 * quarantine attribute, so the replacement launches under the same Gatekeeper
 * posture as the copy the user originally installed.
 */

const RELEASES_DOWNLOAD_BASE = "https://github.com/wehuman01/awefork/releases/download";

/**
 * Main registers backend teardown here: the macOS relaunch path exits with
 * app.exit(0), which skips the before-quit event (and thus registry.dispose)
 * — spawned backends would outlive the swapped-out process.
 */
let onUpdaterExit: (() => void) | null = null;
export function setUpdaterExitHook(handler: () => void): void {
  onUpdaterExit = handler;
}

/** Live bytes of an in-flight update download; total is 0 when unknown. */
export interface UpdateDownloadProgress {
  downloaded: number;
  total: number;
}

type InstallResult = { ok: boolean; error?: string };

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

/** .../awefork.app/Contents/MacOS/awefork -> .../awefork.app, or null outside a bundle. */
export function macosAppBundle(exePath: string): string | null {
  let current = exePath;
  for (let depth = 0; depth < 3; depth += 1) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
    if (current.endsWith(".app")) return current;
  }
  return null;
}

/**
 * `codesign -dv` reports the team on stderr as `TeamIdentifier=<id>`.
 * Ad-hoc signatures report `TeamIdentifier=not set` — treated as unsigned.
 */
export function parseTeamId(codesignOutput: string): string | null {
  const line = codesignOutput
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("TeamIdentifier="));
  if (!line) return null;
  const value = line.trim().slice("TeamIdentifier=".length).trim();
  return value && value !== "not set" ? value : null;
}

/**
 * Download and install a release in place. macOS replaces the bundle and
 * relaunches, so the returned promise never settles on success there; Windows
 * resolves once the installer has been launched.
 */
export async function downloadAndInstallUpdate(
  version: string,
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<InstallResult> {
  const normalized = normalizeVersion(version);
  if (!normalized) return { ok: false, error: "invalid update version" };
  if (!app.isPackaged) return { ok: false, error: "in-app updates need an installed build" };

  if (process.platform === "darwin") {
    const error = await installMacos(normalized, onProgress);
    return error ? { ok: false, error } : { ok: true };
  }
  if (process.platform === "win32") {
    const error = await installWindows(normalized, onProgress);
    return error ? { ok: false, error } : { ok: true };
  }
  return { ok: false, error: "in-app updates are not supported on this platform" };
}

async function installMacos(
  version: string,
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<string | null> {
  const assetUrl = updateAssetUrl(version);
  if (!assetUrl) return "cannot build the macOS update URL";
  const workDir = join(app.getPath("temp"), "awefork-update");
  const dmgPath = join(workDir, `awefork-${version}-${process.arch}.dmg`);
  const mountPoint = join(workDir, "mount");

  try {
    await mkdir(workDir, { recursive: true });
    await downloadWithProgress(assetUrl, dmgPath, onProgress);

    // A stale mountpoint directory makes hdiutil fail; start clean.
    await rm(mountPoint, { recursive: true, force: true });
    await run(
      "hdiutil",
      ["attach", dmgPath, "-mountpoint", mountPoint, "-nobrowse", "-quiet"],
      120_000,
    );

    try {
      const mountedApp = await findMountedApp(mountPoint);
      await verifyUpdateIdentityMacos(mountedApp);
      await replaceAppBundle(mountedApp);
    } finally {
      await run("hdiutil", ["detach", mountPoint, "-quiet"], 60_000).catch(() => null);
    }
    await rm(workDir, { recursive: true, force: true }).catch(() => null);
  } catch (error) {
    return errorMessage(error);
  }

  // Start the new process before exiting this one, avoiding the race where a
  // plain re-activate just focuses the dying instance instead of launching it.
  // app.exit(0) skips before-quit, so tear the backends down explicitly first.
  onUpdaterExit?.();
  app.relaunch();
  app.exit(0);
  return null;
}

async function installWindows(
  version: string,
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<string | null> {
  const assetUrl = updateAssetUrl(version);
  if (!assetUrl) return "cannot build the Windows update URL";
  const workDir = join(app.getPath("temp"), "awefork-update");
  const installerName = `awefork-${version}-${process.arch}-setup.exe`;
  const installerPath = join(workDir, installerName);

  try {
    await mkdir(workDir, { recursive: true });
    await downloadWithProgress(assetUrl, installerPath, onProgress);

    // Publisher check mirroring macOS: when the running exe is signed, the
    // installer must carry the same signer — a replaced release artifact must
    // not launch through the updater. Unsigned dev builds pass through.
    const currentSigner = await windowsSignerSubject(process.execPath);
    if (currentSigner) {
      const updateSigner = await windowsSignerSubject(installerPath);
      if (updateSigner !== currentSigner) {
        return `update installer is not signed by the publisher of the installed app (${currentSigner} vs ${updateSigner ?? "unsigned"})`;
      }
    }

    // Launch the installer detached so this process keeps running (and showing
    // progress UI) until the installer asks the user to close the app.
    const installer = spawn(installerPath, [], { detached: true, stdio: "ignore" });
    installer.unref();
  } catch (error) {
    return errorMessage(error);
  }
  return null;
}

// ── Update artifact verification ─────────────────────────────────────────────
//
// The download URL is built from a validated semver against a hardcoded
// github.com base, so the remaining risk is a replaced or re-signed release
// artifact (CI compromise, hijacked release). What IS verifiable without
// signing infrastructure is the publisher identity: the update's code
// signature must validate, and when the installed app is signed, the signer
// must be the same. Unsigned (ad-hoc / dev) installs have no identity to pin
// and are allowed through — the check protects real installs from
// cross-identity swaps, not dev machines from themselves.

async function verifyUpdateIdentityMacos(mountedApp: string): Promise<void> {
  try {
    await run("codesign", ["--verify", "--deep", "--strict", mountedApp]);
  } catch (error) {
    throw new Error(`update failed code-signature verification: ${errorMessage(error)}`);
  }
  const currentBundle = macosAppBundle(app.getPath("exe"));
  if (!currentBundle) throw new Error("cannot locate the running app bundle");
  const [currentTeam, updateTeam] = await Promise.all([
    macosCodesignTeamId(currentBundle),
    macosCodesignTeamId(mountedApp),
  ]);
  if (currentTeam && updateTeam !== currentTeam) {
    throw new Error(
      `update is signed by a different team (${updateTeam ?? "unsigned"}) than the installed app (${currentTeam})`,
    );
  }
}

async function macosCodesignTeamId(bundle: string): Promise<string | null> {
  try {
    const { stderr } = await run("codesign", ["-dv", "--verbose=2", bundle]);
    return parseTeamId(stderr);
  } catch {
    return null;
  }
}

/** Authenticode signer subject of a signed file, or null when unsigned. */
async function windowsSignerSubject(path: string): Promise<string | null> {
  const quoted = `'${path.replaceAll("'", "''")}'`;
  const script = `(Get-AuthenticodeSignature -FilePath ${quoted}).SignerCertificate.Subject`;
  try {
    const { stdout } = await run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    const subject = stdout.trim();
    return subject || null;
  } catch {
    return null;
  }
}

/** The DMG holds one .app at its root; anything else is not our layout. */
async function findMountedApp(mountPoint: string): Promise<string> {
  const entries = await readdir(mountPoint);
  const apps = entries.filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) {
    throw new Error(`expected one app in the update DMG, found ${apps.length}`);
  }
  return join(mountPoint, apps[0] as string);
}

/**
 * Replace the installed bundle with the mounted one. The old bundle is moved
 * aside first so a failed copy can be rolled back — the user must never be
 * left without an app. Replaces the CURRENT bundle's path (even a renamed
 * one), so users who renamed the app keep their name.
 */
async function replaceAppBundle(mountedApp: string): Promise<void> {
  const dstApp = macosAppBundle(app.getPath("exe"));
  if (!dstApp) throw new Error("cannot locate the running app bundle");
  const backupApp = `${dstApp}.bak`;
  // Drop a stale backup from an earlier interrupted update first.
  await rm(backupApp, { recursive: true, force: true }).catch(() => null);
  await rename(dstApp, backupApp);
  try {
    await run("cp", ["-R", mountedApp, dstApp], 120_000);
  } catch (error) {
    // Roll back: discard the half-copied bundle, put the old one back.
    await rm(dstApp, { recursive: true, force: true }).catch(() => null);
    await rename(backupApp, dstApp).catch(() => null);
    throw error;
  }
  await rm(backupApp, { recursive: true, force: true }).catch(() => null);
}

/** Stream `url` to `dest`, reporting bytes as chunks land. */
async function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "awefork" },
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw new Error(`download failed: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new Error(`server error: HTTP ${response.status}`);
  if (!response.body) throw new Error("download returned no body");

  const total = Number.parseInt(response.headers.get("content-length") ?? "0", 10) || 0;
  let handle: FileHandle | null = null;
  try {
    handle = await open(dest, "w");
    let downloaded = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk);
      downloaded += chunk.byteLength;
      onProgress({ downloaded, total });
    }
  } finally {
    await handle?.close();
  }
}

/** execFile with args array only — no shell, so no metacharacter parsing. */
function run(
  command: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr).trim() || error.message;
        reject(new Error(`${command} failed: ${detail}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
