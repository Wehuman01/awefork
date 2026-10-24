import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { BackendId } from "../shared/backend.js";
import { resolveSpawnEnv } from "./opencode-server.js";

const execFileAsync = promisify(execFile);

/**
 * One-click agent installs. npm is the one channel every supported CLI ships
 * to on all three platforms, and its global bin dir is already on the probe
 * PATH (resolveSpawnEnv unions the npm prefix in), so a `--version` probe
 * fired right after the install resolves without a restart. zcode is not on
 * npm — it rides along with the ZCode desktop app, so it stays a hint.
 */
const NPM_PACKAGES: Partial<Record<BackendId, string>> = {
  opencode: "opencode-ai",
  codex: "@openai/codex",
  pi: "@mariozechner/pi-coding-agent",
  claudecode: "@anthropic-ai/claude-code",
};

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
  const pkg = NPM_PACKAGES[backend];
  if (!pkg) {
    return {
      ok: false,
      error: `no one-click install for ${backend} — install the ZCode desktop app, or point AWEFORK_ZCODE_CLI at zcode.cjs`,
    };
  }
  try {
    await execFn("npm", ["install", "-g", `${pkg}@latest`], {
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: await resolveSpawnEnv(process.env, homedir(), undefined, platform),
      // Windows npm is a .cmd shim; it only resolves under a shell — same
      // repair the CLI probes apply, or win32 would report "not installable".
      ...(platform === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `npm install -g ${pkg} failed: ${detail}` };
  }
}

/** Whether a one-click install exists for the backend (drives UI affordances). */
export function backendInstallable(backend: BackendId): boolean {
  return backend in NPM_PACKAGES;
}
