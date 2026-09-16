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
