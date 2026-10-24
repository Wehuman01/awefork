import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename } from "node:path";
import { promisify } from "node:util";
import { agentPackage, type BackendId } from "../shared/backend.js";
import { resolveSpawnEnv } from "./opencode-server.js";

const execFileAsync = promisify(execFile);

/**
 * One-click agent installs. npm is the one channel every supported CLI ships
 * to on all three platforms, and its global bin dir is already on the probe
 * PATH (resolveSpawnEnv unions the npm prefix in), so a `--version` probe
 * fired right after the install resolves without a restart. zcode is not on
 * npm — it rides along with the ZCode desktop app, so it stays a hint.
 */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

export interface InstallResult {
  ok: boolean;
  error?: string;
}

export async function installBackend(
  backend: BackendId,
  execFn: typeof execFileAsync = execFileAsync,
  platform: NodeJS.Platform = process.platform,
): Promise<InstallResult> {
  const agent = agentPackage(backend);
  if (agent === null) {
    return {
      ok: false,
      error: `no one-click install for ${backend} — install the ZCode desktop app, or point AWEFORK_ZCODE_CLI at zcode.cjs`,
    };
  }
  const env = await resolveSpawnEnv(process.env, homedir(), undefined, platform);
  const options = {
    timeout: INSTALL_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    env,
    // Windows npm is a .cmd shim; it only resolves under a shell — same
    // repair the CLI probes apply, or win32 would report "not installable".
    ...(platform === "win32" ? { shell: true, windowsHide: true } : {}),
  };
  const npm = (args: string[]): Promise<unknown> => execFn("npm", args, options);

  // A scope move (pi) leaves the old global package owning the CLI's bin
  // symlink, and npm will not hand it to the new package on its own.
  // Best effort: an uninstall that fails must not block the install.
  if (agent.legacyPkg !== undefined) {
    await npm(["uninstall", "-g", agent.legacyPkg]).catch(() => null);
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await npm(["install", "-g", `${agent.pkg}@latest`]);
      return { ok: true };
    } catch (error) {
      // npm swaps a global package by renaming the old dir to a backup path
      // derived from its own location (`.pkg-<sha1>`, arborist's retirePath).
      // An install cut short — the 5-minute timeout above, a killed app —
      // leaves that dir behind, and every later attempt then dies ENOTEMPTY
      // renaming onto the same deterministic name: the swap can never
      // finish again. The leftover is npm's own trash by construction, so
      // clear it and retry once before believing the failure.
      const retired = parseRetiredDir(error, agent.pkg);
      if (attempt === 0 && retired !== null && (await removeDir(retired))) {
        continue;
      }
      return { ok: false, error: describeInstallFailure(agent.pkg, error) };
    }
  }
}

/** Whether a one-click install exists for the backend (drives UI affordances). */
export function backendInstallable(backend: BackendId): boolean {
  return agentPackage(backend) !== null;
}

/**
 * The retired-dir path out of an npm ENOTEMPTY failure, when it matches
 * arborist's retire pattern for exactly this package: a sibling named
 * `.${pkg base}-<8 alnum>` (a sha1 of the package path). Anything else
 * returns null, so the caller can only ever delete a directory npm itself
 * created for this very swap.
 */
export function parseRetiredDir(error: unknown, pkg: string): string | null {
  const text = error instanceof Error ? error.message : String(error);
  if (!text.includes("ENOTEMPTY")) return null;
  const base = basename(pkg);
  const pattern = new RegExp(`^\\.${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[a-zA-Z0-9]{8}$`);
  for (const line of text.split("\n")) {
    const hit = line.match(/^\s*npm error dest\s+(.+?)\s*$/);
    if (hit?.[1] === undefined) continue;
    const dir = hit[1];
    if (!dir.includes("/") && !dir.includes("\\")) continue;
    if (pattern.test(basename(dir.replace(/\\/g, "/")))) return dir;
  }
  return null;
}

async function removeDir(dir: string): Promise<boolean> {
  try {
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * npm's failure text with the one action that fixes it in front. The raw
 * npm output stays attached — it names versions, paths and log files the
 * hint cannot anticipate.
 */
export function describeInstallFailure(pkg: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const retired = parseRetiredDir(error, pkg);
  if (retired !== null) {
    return `npm install -g ${pkg} failed: ${retired} is left over from an interrupted install and blocks the swap. Remove it (rm -rf "${retired}") and retry. npm said: ${detail}`;
  }
  if (/EACCES|EPERM/.test(detail)) {
    return `npm install -g ${pkg} failed: no write access to npm's global directory. Retry with permission to write it, or point npm's prefix at a user-writable dir. npm said: ${detail}`;
  }
  if (/spawn npm ENOENT/.test(detail)) {
    return `npm install -g ${pkg} failed: npm was not found on PATH. Install Node.js first, then retry. npm said: ${detail}`;
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|EPROTO|ECONNREFUSED/.test(detail)) {
    return `npm install -g ${pkg} failed: the npm registry is unreachable. Check the network (proxy?) and retry. npm said: ${detail}`;
  }
  return `npm install -g ${pkg} failed: ${detail}`;
}
