import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { opencodeDescriptor, parseVersion, versionInRange } from "../shared/agent-descriptor.js";
import {
  BACKEND_LABELS,
  type BackendCapabilities,
  type BackendEventEnvelope,
  type BackendId,
  type BackendInfo,
  backendCapabilities,
  isBackendId,
  resolveStorePath,
} from "../shared/backend.js";
import { createOpencodeAdapter } from "../shared/opencode-adapter.js";
import { createPiAdapter } from "../shared/pi-adapter.js";
import type { AgentAdapter } from "../shared/types.js";
import { createZcodeAdapter } from "../shared/zcode-adapter.js";
import { createCodexMultiHomeAdapter } from "./codex-multihome.js";
import { isCodexInstalled, stopCodexServer } from "./codex-server.js";
import {
  ensureOpencodeServer,
  findListeningLocalPorts,
  resolveSpawnEnv,
  stopManagedServer,
  tryReuseOpencodeServer,
} from "./opencode-server.js";
import { isPiInstalled, piNodeSeams, stopPiChildren } from "./pi-server.js";
import {
  readBackendSelection,
  readOpencodePort,
  writeBackendSelection,
  writeOpencodePort,
} from "./settings-store.js";
import {
  ensureZcodeServer,
  probeZcode,
  readZcodeProviderConfig,
  stopZcodeServer,
} from "./zcode-server.js";

const execFileAsync = promisify(execFile);

/**
 * Historical default first. 4096 is a common local-tool port (another agent
 * UI, Xiaomi MiMo, leftover `opencode serve`) — later entries are spawn
 * fallbacks when the earlier ones are held by a non-opencode process.
 */
const OPENCODE_PORT_CANDIDATES = [4096, 4097, 4098, 14096];
const STORE_BASES = [
  "lineage",
  "pins",
  "marks",
  "tags",
  "trash",
  "archive",
  "composer",
  "dirs",
] as const;
type StoreBase = (typeof STORE_BASES)[number];
type StorePaths = Record<StoreBase, string>;

export interface BackendRegistry {
  /** Resolve (spawning lazily) the adapter for one backend. */
  get(backend: BackendId): Promise<AgentAdapter>;
  /** Switcher data: installed probes + the persisted selection. */
  listBackends(): Promise<{ selected: BackendId; backends: BackendInfo[] }>;
  /** Probe + persist a selection; {ok:false} keeps the current one. */
  select(backend: BackendId): Promise<{ ok: boolean; error?: string }>;
  capabilities(backend: BackendId): BackendCapabilities;
  /** Per-backend overlay-store paths (legacy bare files stay on opencode). */
  storePaths(backend: BackendId): StorePaths;
  /** Root of the per-session file-change sidecar directories. */
  fileChangesDir(backend: BackendId): string;
  /** Forward every spawned backend's events as tagged envelopes, forever. */
  forward(send: (envelope: BackendEventEnvelope) => void): void;
  dispose(): void;
}

/**
 * Build the port search order: explicit env override, last success from
 * settings, then the classic candidates. Duplicates drop out later.
 */
async function preferredOpenCodePorts(settingsPath: string): Promise<number[]> {
  const envRaw = process.env.AWEFORK_OPENCODE_PORT;
  const envPort = envRaw !== undefined && /^\d+$/.test(envRaw) ? Number(envRaw) : Number.NaN;
  const saved = await readOpencodePort(settingsPath);
  const ports = [
    Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : null,
    saved,
    ...OPENCODE_PORT_CANDIDATES,
  ];
  return ports.filter((port): port is number => typeof port === "number");
}

function uniquePorts(ports: number[]): number[] {
  return [...new Set(ports)];
}

/**
 * Locate (reuse first, then spawn) a ready opencode and remember the port.
 *
 * Order:
 *  1. AWEFORK_OPENCODE_PORT, last-good settings port, classic candidates
 *  2. Any other local LISTEN port (finds a manually started `opencode serve`
 *     after a port move), probed concurrently — a silent foreign socket
 *     costs a full probe timeout, and dozens in sequence would stall boot
 *  3. Spawn on the preferred list; a missing CLI aborts before the walk,
 *     which on Windows (shims hide ENOENT) would otherwise burn a spawn per
 *     port and surface an error naming the last port tried
 *
 * On success the winning port is written back to settings so the next boot
 * skips the hunt. Codex has no port (stdio app-server) and never lands here.
 */
async function resolveOpenCodeServer(settingsPath: string): Promise<{ baseUrl: string }> {
  const preferred = uniquePorts(await preferredOpenCodePorts(settingsPath));
  for (const port of preferred) {
    const reused = await tryReuseOpencodeServer(port);
    if (reused) {
      await writeOpencodePort(settingsPath, port);
      return reused;
    }
  }

  // Nothing preferred is alive — hunt a manually started `opencode serve` on
  // any other LISTEN port. Reuse only; never spawn into an occupied socket.
  const alreadyProbed = new Set(preferred);
  const discovered = uniquePorts(await findListeningLocalPorts())
    .filter((port) => !alreadyProbed.has(port))
    .sort((a, b) => a - b);
  const hits = await Promise.all(
    discovered.map(async (port) => ({ port, reused: await tryReuseOpencodeServer(port) })),
  );
  // First hit in scan order, not first to settle — the pick between two live
  // instances stays deterministic across boots.
  const winner = hits.find((hit) => hit.reused !== null);
  if (winner?.reused) {
    await writeOpencodePort(settingsPath, winner.port);
    return winner.reused;
  }

  if (!(await probeOpencode()).installed) {
    throw new Error("未在 PATH 上找到 opencode CLI。安装后重试，或手动运行 opencode serve。");
  }
  let lastError: unknown = null;
  for (const port of preferred) {
    try {
      const spawned = await ensureOpencodeServer(port);
      await writeOpencodePort(settingsPath, port);
      return spawned;
    } catch (error) {
      lastError = error;
      // Missing CLI fails the same on every port — no point walking further.
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "opencode server did not start"));
}

/**
 * Routes IPC calls to a backend's adapter and keeps one adapter per backend
 * alive for the app's lifetime. Spawning is lazy — launch only materializes
 * the persisted selection — and events from every spawned backend stream out
 * together, so runs in flight keep streaming while the user views the other
 * backend. A crashed codex child is re-spawned on the next call for it, and
 * the renderer hears `server.reconnected` once the new handshake succeeds.
 */
export function createBackendRegistry(userDataDir: string): BackendRegistry {
  const settingsPath = join(userDataDir, "settings.json");
  const caches = new Map<BackendId, StorePaths>();
  const adapters = new Map<BackendId, Promise<AgentAdapter>>();
  const unsubscribers: Array<() => void> = [];
  let forwardEvent: ((envelope: BackendEventEnvelope) => void) | null = null;

  const storePaths = (backend: BackendId): StorePaths => {
    const cached = caches.get(backend);
    if (cached) return cached;
    const paths = Object.fromEntries(
      STORE_BASES.map((base) => [
        base,
        resolveStorePath(userDataDir, base, backend, (path) => existsSync(path)),
      ]),
    ) as StorePaths;
    caches.set(backend, paths);
    return paths;
  };

  const fileChangesRoot = (backend: BackendId): string =>
    join(userDataDir, "file-changes", backend);

  const subscribeAdapter = (backend: BackendId, adapter: AgentAdapter): void => {
    void adapter
      .subscribe((event) => {
        forwardEvent?.({ backend, event });
      })
      .then((unsubscribe) => {
        unsubscribers.push(unsubscribe);
      });
  };

  const ensureBackend = (backend: BackendId): Promise<AgentAdapter> => {
    const existing = adapters.get(backend);
    if (existing) return existing;
    const promise =
      backend === "opencode"
        ? resolveOpenCodeServer(settingsPath).then(({ baseUrl }) => {
            const adapter = createOpencodeAdapter({
              baseUrl,
              lineagePath: storePaths("opencode").lineage,
              fileChangesDir: fileChangesRoot("opencode"),
            });
            subscribeAdapter("opencode", adapter);
            return adapter;
          })
        : // The codex facade manages one app-server per home (default +
          // aweswitch accounts) internally, including crash re-spawns.
          backend === "codex"
          ? Promise.resolve().then(() => {
              const adapter = createCodexMultiHomeAdapter({
                lineagePath: storePaths("codex").lineage,
              });
              subscribeAdapter("codex", adapter);
              return adapter;
            })
          : // One zcode app-server child; a crashed child respawns inside
            // the handle and the adapter re-attaches its handlers.
            backend === "zcode"
            ? Promise.resolve().then(async () => {
                const probe = await probeZcode();
                const server = await ensureZcodeServer({ version: probe.version });
                const adapter = createZcodeAdapter({
                  client: server.client,
                  onClientReplaced: server.onClientReplaced,
                  lineagePath: storePaths("zcode").lineage,
                  readProviderConfig: () => readZcodeProviderConfig(),
                  homeDirectory: homedir(),
                });
                subscribeAdapter("zcode", adapter);
                return adapter;
              })
            : // pi: browsing reads the session files directly; RPC children
              // spawn only while a run is in flight.
              Promise.resolve().then(async () => {
                const adapter = createPiAdapter({
                  lineagePath: storePaths("pi").lineage,
                  ...(await piNodeSeams()),
                });
                subscribeAdapter("pi", adapter);
                return adapter;
              });
    // A failed spawn must not be cached as the permanent truth; drop it so
    // the next call retries (matches the lazy re-spawn contract).
    promise.catch(() => adapters.delete(backend));
    adapters.set(backend, promise);
    return promise;
  };

  return {
    get: ensureBackend,

    fileChangesDir: fileChangesRoot,

    async listBackends() {
      const [selected, opencode, codexInstalled, pi, zcode] = await Promise.all([
        readBackendSelection(settingsPath),
        probeOpencode(),
        isCodexInstalled(),
        isPiInstalled(),
        probeZcode(),
      ]);
      return {
        selected,
        backends: [
          {
            id: "opencode",
            label: BACKEND_LABELS.opencode,
            installed: opencode.installed,
            version: opencode.version,
            versionWarning: versionWarning(opencode),
          },
          {
            id: "codex",
            label: BACKEND_LABELS.codex,
            installed: codexInstalled,
            version: null,
            versionWarning: null,
          },
          {
            id: "pi",
            label: BACKEND_LABELS.pi,
            installed: pi,
            version: null,
            versionWarning: null,
          },
          {
            id: "zcode",
            label: BACKEND_LABELS.zcode,
            installed: zcode.installed,
            version: zcode.version,
            versionWarning: null,
          },
        ],
      };
    },

    async select(backend) {
      if (!isBackendId(backend)) {
        return { ok: false, error: `未知后端：${String(backend)}` };
      }
      const installed =
        backend === "codex"
          ? await isCodexInstalled()
          : backend === "zcode"
            ? (await probeZcode()).installed
            : backend === "pi"
              ? await isPiInstalled()
              : (await probeOpencode()).installed;
      if (!installed) {
        const hint =
          backend === "codex"
            ? "未在 PATH 上找到 codex CLI。安装：npm install -g @openai/codex"
            : backend === "zcode"
              ? "未找到 zcode CLI。安装 ZCode 桌面端后重试，或用 AWEFORK_ZCODE_CLI 指向 zcode.cjs。"
              : backend === "pi"
                ? "未在 PATH 上找到 pi CLI。安装：npm install -g @mariozechner/pi-coding-agent"
                : "未在 PATH 上找到 opencode CLI。安装后重试，或手动运行 opencode serve。";
        return { ok: false, error: hint };
      }
      await writeBackendSelection(settingsPath, backend);
      return { ok: true };
    },

    capabilities: backendCapabilities,

    storePaths,

    forward(send) {
      forwardEvent = send;
    },

    dispose() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {
          // A dead backend's stream may already be gone.
        }
      }
      for (const promise of adapters.values()) {
        void promise.then((adapter) => adapter.dispose()).catch(() => {});
      }
      adapters.clear();
      stopManagedServer();
      stopCodexServer();
      stopZcodeServer();
      stopPiChildren();
    },
  };
}

interface OpencodeProbe {
  installed: boolean;
  version: string | null;
}

/**
 * `opencode --version` probe for the switcher. Same two platform repairs the
 * serve spawn relies on: a GUI-launched app gets a minimal PATH that misses
 * homebrew/npm-style installs (resolveSpawnEnv), and Windows npm installs are
 * .cmd shims that only run under cmd.exe (shell). Both probes and both spawns
 * must stay in lockstep, or the switcher refuses a backend that would work.
 */
export async function probeOpencode(
  execFn: typeof execFileAsync = execFileAsync,
  platform: NodeJS.Platform = process.platform,
): Promise<OpencodeProbe> {
  try {
    const { stdout } = await execFn("opencode", ["--version"], {
      timeout: 5000,
      env: await resolveSpawnEnv(process.env, homedir(), undefined, platform),
      ...(platform === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    return { installed: true, version: parseVersion(stdout) };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * The README's old failure mode was silent degradation: an opencode whose
 * event shapes drifted away made runs hang forever with nothing saying why.
 * A version outside the descriptor's tested range now carries an explicit
 * warning instead — visible, but not a block (it may well still work).
 */
function versionWarning(probe: OpencodeProbe): string | null {
  if (!probe.installed || probe.version === null) return null;
  const { compat } = opencodeDescriptor();
  if (versionInRange(probe.version, compat)) return null;
  return `opencode ${probe.version} 不在 awefork 已测试的版本区间（≥${compat.min}，<${compat.max}）；若运行不结束或回复为空，请切换到已测试版本`;
}
