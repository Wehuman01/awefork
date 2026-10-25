import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type OpenCodeDescriptor,
  opencodeVersionWarning,
  parseVersion,
  piVersionWarning,
  selectOpencodeDescriptor,
} from "../shared/agent-descriptor.js";
import {
  agentInstallHint,
  BACKEND_LABELS,
  type BackendCapabilities,
  type BackendEventEnvelope,
  type BackendId,
  type BackendInfo,
  backendCapabilities,
  isBackendId,
  resolveStorePath,
} from "../shared/backend.js";
import { createClaudeAdapter } from "../shared/claude-adapter.js";
import { createOpencodeAdapter } from "../shared/opencode-adapter.js";
import { createPiAdapter } from "../shared/pi-adapter.js";
import type { AgentAdapter } from "../shared/types.js";
import { createZcodeAdapter } from "../shared/zcode-adapter.js";
import { claudeNodeSeams, probeClaude } from "./claude-server.js";
import { createCodexMultiHomeAdapter } from "./codex-multihome.js";
import { isCodexInstalled, stopCodexServer } from "./codex-server.js";
import {
  ensureOpencodeServer,
  findListeningLocalPorts,
  readRegisteredOpencodeService,
  resolveSpawnEnv,
  stopManagedServer,
  tryReuseOpencodeServer,
} from "./opencode-server.js";
import { piNodeSeams, probePi, stopPiChildren } from "./pi-server.js";
import {
  readBackendSelection,
  readOpencodePort,
  readQuitKeepAlive,
  writeBackendSelection,
  writeOpencodePort,
  writeQuitKeepAlive,
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
  /** Feature surface for one backend; opencode's depends on the probed CLI version. */
  capabilities(backend: BackendId): Promise<BackendCapabilities>;
  /**
   * Drop the cached opencode probe so the next listBackends sees an install
   * (or removal) that landed while the app was running.
   */
  reprobe(): void;
  /** Per-backend overlay-store paths (legacy bare files stay on opencode). */
  storePaths(backend: BackendId): StorePaths;
  /** Root of the per-session file-change sidecar directories. */
  fileChangesDir(backend: BackendId): string;
  /** Forward every spawned backend's events as tagged envelopes, forever. */
  forward(send: (envelope: BackendEventEnvelope) => void): void;
  /**
   * Sessions with a run in flight right now, tagged by backend — what the
   * quit confirmation asks about. A session counts from its first
   * message.started until its session.idle (or a session-scoped error).
   */
  runningSessions(): Array<{ backend: BackendId; sessionId: string }>;
  /** The persisted quitKeepAlive setting, cached for the sync quit path. */
  quitKeepAlive(): boolean;
  /** Cache and persist the setting; takes effect on the next quit. */
  setQuitKeepAlive(value: boolean): void;
  /**
   * Drop every adapter and stream. With keepAlive (or the persisted setting)
   * the spawned servers are left running so their in-flight turns finish.
   */
  dispose(options?: { keepAlive?: boolean }): void;
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

/** The port a baseUrl names, or null when it is not a loopback http URL. */
function portOf(baseUrl: string): number | null {
  const match = baseUrl.match(/:(\d+)\s*\/?$/);
  const port = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/** What the opencode backend needs to drive one server: where it is and how. */
interface OpenCodeServer {
  baseUrl: string;
  descriptor: OpenCodeDescriptor;
  /** v2's server password; absent on v1, which authenticates nothing. */
  password?: string;
}

/**
 * v2's server cannot be adopted by port scan: every route requires the
 * per-start password, and a foreign `opencode serve` never tells anyone what
 * it picked. The one adoptable v2 server is the CLI's background service,
 * which registers its url + password where the TUI itself looks. Anything
 * else gets awefork's own spawn, with a password this app chose.
 */
async function resolveV2Server(
  settingsPath: string,
  descriptor: OpenCodeDescriptor,
): Promise<OpenCodeServer> {
  const registered = await readRegisteredOpencodeService();
  const registeredPort = registered ? portOf(registered.baseUrl) : null;
  if (registered && registeredPort !== null) {
    const reused = await tryReuseOpencodeServer(registeredPort, {
      descriptor,
      password: registered.password,
    });
    if (reused) {
      return { baseUrl: reused.baseUrl, descriptor, password: registered.password };
    }
  }
  const preferred = uniquePorts(await preferredOpenCodePorts(settingsPath));
  const password = randomBytes(32).toString("base64url");
  let lastError: unknown = null;
  for (const port of preferred) {
    try {
      const spawned = await ensureOpencodeServer(port, undefined, { descriptor, password });
      await writeOpencodePort(settingsPath, port);
      return { baseUrl: spawned.baseUrl, descriptor, password };
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
 *
 * Which wire protocol to speak comes from the probed CLI version: v2 servers
 * authenticate and live under `/api`, so they resolve through the service
 * registration (or a fresh spawn) instead of the port walk.
 */
async function resolveOpenCodeServer(
  settingsPath: string,
  probe: () => Promise<OpencodeProbe>,
): Promise<OpenCodeServer> {
  const version = (await probe()).version;
  const descriptor = selectOpencodeDescriptor(version);
  if (descriptor.protocol === "v2") {
    return resolveV2Server(settingsPath, descriptor);
  }
  const preferred = uniquePorts(await preferredOpenCodePorts(settingsPath));
  for (const port of preferred) {
    const reused = await tryReuseOpencodeServer(port, { descriptor });
    if (reused) {
      await writeOpencodePort(settingsPath, port);
      return { baseUrl: reused.baseUrl, descriptor };
    }
  }

  // Nothing preferred is alive — hunt a manually started `opencode serve` on
  // any other LISTEN port. Reuse only; never spawn into an occupied socket.
  const alreadyProbed = new Set(preferred);
  const discovered = uniquePorts(await findListeningLocalPorts())
    .filter((port) => !alreadyProbed.has(port))
    .sort((a, b) => a - b);
  const hits = await Promise.all(
    discovered.map(async (port) => ({
      port,
      reused: await tryReuseOpencodeServer(port, { descriptor }),
    })),
  );
  // First hit in scan order, not first to settle — the pick between two live
  // instances stays deterministic across boots.
  const winner = hits.find((hit) => hit.reused !== null);
  if (winner?.reused) {
    await writeOpencodePort(settingsPath, winner.port);
    return { baseUrl: winner.reused.baseUrl, descriptor };
  }

  if (!(await probe()).installed) {
    throw new Error(
      "opencode CLI not found on PATH. Install it and retry, or run opencode serve manually.",
    );
  }
  let lastError: unknown = null;
  for (const port of preferred) {
    try {
      const spawned = await ensureOpencodeServer(port, undefined, { descriptor });
      await writeOpencodePort(settingsPath, port);
      return { baseUrl: spawned.baseUrl, descriptor };
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
  /** `backend:sessionId` of runs in flight; see runningSessions below. */
  const running = new Map<string, { backend: BackendId; sessionId: string }>();
  /** One id shared by every renderer for each run currently observed by main. */
  const runIds = new Map<string, string>();
  /**
   * The persisted quitKeepAlive setting, read once at startup so the sync
   * before-quit path never awaits a file; setQuitKeepAlive keeps it current.
   * An explicit set wins over the startup read even if the read is still in
   * flight — its resolution must not clobber the newer value.
   */
  let quitKeepAliveCached = false;
  let quitKeepAliveSet = false;
  void readQuitKeepAlive(settingsPath).then((value) => {
    if (!quitKeepAliveSet) quitKeepAliveCached = value;
  });
  /**
   * Event ids stay unique across app launches for durable event-based
   * observations. Run ids below are assigned once in main and shared with
   * every renderer, including windows that join during a run.
   */
  const eventPrefix = `e${randomBytes(6).toString("hex")}-`;
  let eventSequence = 0;
  /**
   * `opencode --version` decides which protocol awefork speaks, so it gates
   * the switcher warning, the capabilities and the adapter itself. One probe
   * per app session: the CLI does not change under a running app, and every
   * listBackends call would otherwise re-spawn it.
   */
  let opencodeProbe: Promise<OpencodeProbe> | null = null;
  const probeOpencodeCached = (): Promise<OpencodeProbe> => {
    opencodeProbe ??= probeOpencode();
    return opencodeProbe;
  };
  /**
   * Replace the cached probe with a fresh one. An explicit select() is the
   * moment the CLI may have changed under the running app (an install that
   * landed since boot), and the cached "not installed" would refuse a backend
   * that now works. probeOpencode never rejects, so the cache cannot poison.
   */
  const reprobeOpencode = (): Promise<OpencodeProbe> => {
    opencodeProbe = probeOpencode();
    return opencodeProbe;
  };

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
        const key = "sessionId" in event ? `${backend}:${event.sessionId}` : null;
        const eventId = `${eventPrefix}${++eventSequence}`;
        let runId = key ? runIds.get(key) : undefined;
        if (event.type === "message.started" && key) {
          running.set(key, { backend, sessionId: event.sessionId });
          runId = eventId;
          runIds.set(key, runId);
        } else if (event.type === "message.delta" && key && !runId) {
          // An app/window can join after the start frame. The first delta is
          // shared by all current renderers, so it becomes their run identity.
          runId = eventId;
          runIds.set(key, runId);
        } else if (event.type === "session.idle" && key) {
          running.delete(key);
        } else if (event.type === "server.error" && "sessionId" in event && event.sessionId) {
          // A failed prompt settles that session's run just like idle would.
          running.delete(`${backend}:${event.sessionId}`);
        }
        forwardEvent?.({ backend, event, eventId, ...(runId ? { runId } : {}) });
        if ((event.type === "session.idle" || event.type === "server.error") && key) {
          runIds.delete(key);
        }
      })
      .then((unsubscribe) => {
        unsubscribers.push(unsubscribe);
      })
      .catch((error: unknown) => {
        // A backend whose event stream cannot start still serves requests;
        // its runs just won't stream until the adapter is recreated.
        console.warn(`subscribing to ${backend} events failed: ${String(error)}`);
      });
  };

  const ensureBackend = (backend: BackendId): Promise<AgentAdapter> => {
    const existing = adapters.get(backend);
    if (existing) return existing;
    const promise =
      backend === "opencode"
        ? resolveOpenCodeServer(settingsPath, probeOpencodeCached).then(
            ({ baseUrl, descriptor, password }) => {
              const adapter = createOpencodeAdapter({
                baseUrl,
                lineagePath: storePaths("opencode").lineage,
                fileChangesDir: fileChangesRoot("opencode"),
                descriptor,
                password,
              });
              subscribeAdapter("opencode", adapter);
              return adapter;
            },
          )
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
            : // claude: streaming children are spawned lazily per session;
              // browsing reads the transcript store directly.
              backend === "claudecode"
              ? Promise.resolve().then(async () => {
                  const adapter = createClaudeAdapter({
                    lineagePath: storePaths("claudecode").lineage,
                    ...(await claudeNodeSeams()),
                  });
                  subscribeAdapter("claudecode", adapter);
                  return adapter;
                })
              : // pi: browsing reads the session files directly; RPC children
                // live only while a run is in flight plus a short idle window.
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
      const [selected, opencode, codexInstalled, pi, zcode, claude] = await Promise.all([
        readBackendSelection(settingsPath),
        probeOpencodeCached(),
        isCodexInstalled(),
        probePi(),
        probeZcode(),
        probeClaude(),
      ]);
      return {
        selected,
        backends: [
          {
            id: "opencode",
            label: BACKEND_LABELS.opencode,
            installed: opencode.installed,
            version: opencode.version,
            versionWarning: opencodeVersionWarning(opencode.version),
          },
          {
            id: "codex",
            label: BACKEND_LABELS.codex,
            installed: codexInstalled,
            version: null,
            versionWarning: null,
          },
          {
            id: "claudecode",
            label: BACKEND_LABELS.claudecode,
            installed: claude.installed,
            version: claude.version,
            versionWarning: null,
          },
          {
            id: "pi",
            label: BACKEND_LABELS.pi,
            installed: pi.installed,
            version: pi.version,
            versionWarning: piVersionWarning(pi.version),
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
        return { ok: false, error: `unknown backend: ${String(backend)}` };
      }
      const installed =
        backend === "codex"
          ? await isCodexInstalled()
          : backend === "zcode"
            ? (await probeZcode()).installed
            : backend === "claudecode"
              ? (await probeClaude()).installed
              : backend === "pi"
                ? (await probePi()).installed
                : (await reprobeOpencode()).installed;
      if (!installed) {
        // zcode ships with its desktop app, so its hint is bespoke; opencode
        // can also be run by hand as a server; every other CLI quotes the
        // shared package table.
        const install = agentInstallHint(backend) ?? "Install it and retry.";
        const manualServe =
          backend === "opencode" ? " You can also run `opencode serve` manually and retry." : "";
        const hint =
          backend === "zcode"
            ? "zcode CLI not found. Install the ZCode desktop app and retry, or point AWEFORK_ZCODE_CLI at zcode.cjs."
            : `${BACKEND_LABELS[backend]} CLI not found on PATH. ${install}${manualServe}`;
        return { ok: false, error: hint };
      }
      await writeBackendSelection(settingsPath, backend);
      return { ok: true };
    },

    // opencode's flags live in the descriptor the probed version selects —
    // v2 dropped single-message delete, so the renderer must not offer it.
    async capabilities(backend) {
      if (backend !== "opencode") return backendCapabilities(backend);
      const version = (await probeOpencodeCached()).version;
      return backendCapabilities(backend, version);
    },

    storePaths,

    reprobe: () => {
      opencodeProbe = null;
    },

    forward(send) {
      forwardEvent = send;
    },

    runningSessions: () => [...running.values()],

    quitKeepAlive: () => quitKeepAliveCached,

    setQuitKeepAlive(value) {
      quitKeepAliveSet = true;
      quitKeepAliveCached = value;
      void writeQuitKeepAlive(settingsPath, value).catch(() => {
        // A failed settings write only loses the preference across restarts;
        // the cached flag still governs this quit.
      });
    },

    dispose(options) {
      const keepAlive = options?.keepAlive ?? quitKeepAliveCached;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {
          // A dead backend's stream may already be gone.
        }
      }
      for (const promise of adapters.values()) {
        void promise.then((adapter) => adapter.dispose({ keepAlive })).catch(() => {});
      }
      adapters.clear();
      if (keepAlive) return;
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
