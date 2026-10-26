import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../shared/atomic-write.js";
import { type BackendId, isBackendId } from "../shared/backend.js";
import { enqueueWrite } from "../shared/write-queue.js";

/**
 * Persisted app settings (userData/settings.json). Shape stays open so future
 * keys have a home. Corrupt or missing files read as defaults — settings must
 * never block boot.
 */

interface Settings {
  /** Agent backend the app boots into; default "opencode". */
  backend?: unknown;
  /** Last port an opencode serve answered on; next boot reuses it first. */
  opencodePort?: unknown;
}

async function readSettings(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or corrupt — start over.
  }
  return {};
}

/**
 * Serialized per file: writeOpencodePort (end of a long opencode resolve) and
 * writeBackendSelection (user switching backends) can otherwise interleave
 * their RMWs and drop one of the two keys.
 */
async function patchSettings(
  filePath: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return enqueueWrite(filePath, async () => {
    await fs.mkdir(dirname(filePath), { recursive: true });
    // Read-modify-write keeps unknown future keys intact.
    const settings = { ...(await readSettings(filePath)), ...patch };
    await writeFileAtomic(filePath, `${JSON.stringify(settings, null, 2)}\n`);
    return settings;
  });
}

function asPort(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536
    ? value
    : null;
}

export async function readBackendSelection(filePath: string): Promise<BackendId> {
  const backend = (await readSettings(filePath)).backend;
  return isBackendId(backend) ? backend : "opencode";
}

export async function writeBackendSelection(filePath: string, backend: BackendId): Promise<void> {
  await patchSettings(filePath, { backend });
}

/** Last-known-good opencode port; null when never recorded or corrupt. */
export async function readOpencodePort(filePath: string): Promise<number | null> {
  return asPort((await readSettings(filePath)).opencodePort);
}

/** Record the port an opencode server was last seen on, for the next boot. */
export async function writeOpencodePort(filePath: string, port: number): Promise<void> {
  const safe = asPort(port);
  if (safe === null) return;
  await patchSettings(filePath, { opencodePort: safe });
}

/**
 * "Quit keeps backends alive": when true, quitting awefork leaves the spawned
 * app-servers running so their in-flight turns finish (results land in each
 * backend's own session files). Default false — quitting kills the children.
 */
export async function readQuitKeepAlive(filePath: string): Promise<boolean> {
  return (await readSettings(filePath)).quitKeepAlive === true;
}

export async function writeQuitKeepAlive(filePath: string, value: boolean): Promise<void> {
  await patchSettings(filePath, { quitKeepAlive: value });
}

/**
 * Whether the first-run agent-install guide already ran (shown or skipped).
 * Once true the welcome dialog never comes back — the settings page's
 * per-agent install button covers later installs.
 */
export async function readOnboardingDone(filePath: string): Promise<boolean> {
  return (await readSettings(filePath)).onboardingDone === true;
}

export async function writeOnboardingDone(filePath: string): Promise<void> {
  await patchSettings(filePath, { onboardingDone: true });
}

/**
 * The last window placement, so a restart reopens where the user left it
 * instead of snapping back to the default 1280×840 centered box. Kept per
 * window kind ("main" or an agent id): the agent window is a different
 * workspace and should not inherit the main window's size.
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

function asBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = raw.x;
  const y = raw.y;
  const width = raw.width;
  const height = raw.height;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    width < 400 ||
    height < 300
  ) {
    return null;
  }
  return { x, y, width, height, maximized: raw.maximized === true };
}

/** The saved placement for one window kind ("main" / an agent id), if any. */
export async function readWindowBounds(
  filePath: string,
  kind: string,
): Promise<WindowBounds | null> {
  const all = (await readSettings(filePath)).windowBounds;
  if (!all || typeof all !== "object") return null;
  return asBounds((all as Record<string, unknown>)[kind]);
}

/**
 * Remember one window kind's placement. A maximized window saves the restored
 * (pre-maximize) bounds so un-maximizing after a restart still has a sane
 * size, and the flag tells the next launch to maximize again.
 */
export async function writeWindowBounds(
  filePath: string,
  kind: string,
  bounds: WindowBounds,
): Promise<void> {
  const existing = (await readSettings(filePath)).windowBounds;
  const all =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  await patchSettings(filePath, { windowBounds: { ...all, [kind]: bounds } });
}
