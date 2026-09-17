import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveSpawnEnv } from "./opencode-server.js";
import {
  createZcodeJsonRpc,
  type ZcodeJsonRpc,
  type ZcodeRequestHandler,
} from "./zcode-jsonrpc.js";

const execFileAsync = promisify(execFile);

export interface ZcodeProbe {
  installed: boolean;
  /** Version parsed from the CLI's own version output; null when unparseable. */
  version: string | null;
}

/**
 * How to launch the zcode CLI. ZCode ships as a desktop app whose CLI is a
 * bundled .cjs script (not on PATH), so a plain `spawn("zcode")` is not
 * enough — resolution order: explicit env override, the known app-bundle
 * locations, then a PATH `zcode` (future CLI distribution).
 */
export interface ZcodeCli {
  /** argv leading to `zcode <args...>` — a direct executable or node + script. */
  command: string;
  args: string[];
  /** Extra env needed to run the command (Electron-as-node). */
  env?: Record<string, string>;
}

/** Candidate .cjs bundle paths, most common first. darwin-only for now. */
function bundleCandidates(plat: NodeJS.Platform): string[] {
  if (plat !== "darwin") return [];
  return ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"];
}

/**
 * Resolve how to launch zcode. Pure in the seam arguments so tests can pin
 * each branch; production passes the real homedir/platform/env.
 */
export async function resolveZcodeCli(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  plat: NodeJS.Platform = platform(),
  execFn: typeof execFileAsync = execFileAsync,
): Promise<ZcodeCli | null> {
  const override = env.AWEFORK_ZCODE_CLI;
  if (override && existsSync(override)) return nodeCommand(override);
  const bundled = bundleCandidates(plat).find((path) => existsSync(path));
  if (bundled) return nodeCommand(bundled);
  // A PATH install (future CLI distribution): let the loader find it.
  try {
    await execFn("zcode", ["--version"], {
      timeout: 5000,
      env: await resolveSpawnEnv(env, home, undefined, plat),
      ...(plat === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    return { command: "zcode", args: [] };
  } catch {
    return null;
  }
}

/**
 * The app bundle's .cjs has a node shebang but is not guaranteed +x, and a
 * GUI-spawned PATH may lack a plain `node` — so run it with Electron itself
 * in node mode, which always exists and always matches the bundled CLI's
 * runtime.
 */
function nodeCommand(scriptPath: string): ZcodeCli {
  return {
    command: process.execPath,
    args: [scriptPath],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

export async function probeZcode(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  plat: NodeJS.Platform = platform(),
  execFn: typeof execFileAsync = execFileAsync,
): Promise<ZcodeProbe> {
  const cli = await resolveZcodeCli(env, home, plat, execFn);
  if (!cli) return { installed: false, version: null };
  try {
    const { stdout } = await execFn(cli.command, [...cli.args, "--version"], {
      timeout: 5000,
      env: { ...env, ...(await resolveSpawnEnv(env, home, undefined, plat)), ...cli.env },
    });
    return { installed: true, version: parseZcodeVersion(stdout) };
  } catch {
    return { installed: false, version: null };
  }
}

/** First x.y[.z…] triple in the CLI output ("zcode 0.16.5 …"), null when none. */
export function parseZcodeVersion(raw: string): string | null {
  return raw.match(/\d+\.\d+(?:\.\d+)*/)?.[0] ?? null;
}

interface ServerSlot {
  child: ChildProcess;
  client: ZcodeJsonRpc;
  alive: boolean;
}

export interface ZcodeServerHandle {
  /** The live client, re-spawning the child first when it died. */
  client(): Promise<ZcodeJsonRpc>;
  /** Fired with every fresh client after a respawn — handlers re-attach. */
  onClientReplaced(cb: (client: ZcodeJsonRpc) => void): void;
  /** CLI version from the install probe, for the switcher row. */
  readonly version: string | null;
  stop(): void;
}

export interface EnsureZcodeServerOptions {
  cli?: ZcodeCli | null;
  version?: string | null;
  /** Server→client requests the adapter answers (runtime preferences). */
  onRequest?: ZcodeRequestHandler;
}

/** One app-server per awefork process; a crashed child respawns on demand. */
let slot: ServerSlot | null = null;
let handle: ZcodeServerHandle | null = null;
let replacedCallbacks: Array<(client: ZcodeJsonRpc) => void> = [];
/** In-flight respawn so concurrent `client()` calls share a single spawn. */
let respawning: Promise<ServerSlot> | null = null;

/**
 * Spawn `zcode app-server` and drive it over stdio. There is no handshake —
 * the first request simply works (verified live against 0.16.5) — so
 * readiness is "the child did not exit within a short grace window". The
 * desktop app may own sessions in the same sqlite store; the protocol is
 * built for several clients, and browsing never writes.
 */
export async function ensureZcodeServer(
  options: EnsureZcodeServerOptions = {},
  spawnFn: typeof spawn = spawn,
): Promise<ZcodeServerHandle> {
  if (handle) return handle;
  const cli = options.cli ?? (await resolveZcodeCli());
  if (!cli) {
    throw new Error(
      "未找到 zcode CLI。安装 ZCode 桌面端后重试，或用 AWEFORK_ZCODE_CLI 指向 zcode.cjs。",
    );
  }

  const spawnChild = async (): Promise<ServerSlot> => {
    const spawnEnv = await resolveSpawnEnv(process.env, homedir(), undefined, process.platform);
    const child = spawnFn(cli.command, [...cli.args, "app-server"], {
      stdio: ["pipe", "pipe", "ignore"],
      cwd: homedir(),
      env: { ...spawnEnv, ...cli.env },
      // Own process group on POSIX so shutdown kills the whole tree (the
      // ELECTRON_RUN_AS_NODE wrapper spawns no grandchildren today, but the
      // CLI's own tool children may).
      detached: process.platform !== "win32",
      ...(process.platform === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    child.stdin?.on?.("error", () => {});
    const client = createZcodeJsonRpc(child.stdin, child.stdout, {
      onNotification: () => {},
      onDisconnect: () => markDead(slotOf(child)),
      onRequest: options.onRequest,
    });
    const created: ServerSlot = { child, client, alive: true };
    child.on("error", () => markDead(created));
    child.on("exit", () => markDead(created));
    return created;
  };

  const slotOf = (child: ChildProcess): ServerSlot | null => (slot?.child === child ? slot : null);

  const markDead = (dead: ServerSlot | null): void => {
    if (!dead || !dead.alive) return;
    dead.alive = false;
    if (slot === dead) slot = null;
  };

  slot = await spawnChild();
  // A wrong CLI path or a bad flag exits immediately; surface that instead
  // of letting the first request time out against a dead pipe.
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  if (!slot.alive) {
    throw new Error(
      "zcode app-server 启动即退出。请确认 ZCode 桌面端已正确安装（AWEFORK_ZCODE_CLI 可指向 zcode.cjs）。",
    );
  }

  // A fresh handle pairs with a fresh adapter that re-registers on
  // ClientReplaced; registrations from the previous handle belong to adapters
  // this process no longer drives, so start the array clean instead of
  // wiping it in stop() (where a still-live adapter would lose its callback).
  replacedCallbacks = [];
  const currentHandle: ZcodeServerHandle = {
    async client() {
      if (!slot || !slot.alive) {
        if (!respawning) {
          respawning = spawnChild().finally(() => {
            respawning = null;
          });
        }
        const fresh = await respawning;
        if (!slot || !slot.alive) {
          slot = fresh;
          for (const cb of replacedCallbacks) cb(fresh.client);
        }
      }
      return slot.client;
    },
    onClientReplaced(cb) {
      replacedCallbacks.push(cb);
    },
    version: options.version ?? null,
    stop() {
      const current = slot;
      slot = null;
      handle = null;
      if (!current) return;
      current.alive = false;
      killChild(current.child);
    },
  };
  handle = currentHandle;
  return currentHandle;
}

/** Stop the managed zcode child, if any. Safe to call twice. */
export function stopZcodeServer(): void {
  handle?.stop();
}

/**
 * The provider registry the desktop client maintains (`~/.zcode/v2/config.
 * json`). This is the only model catalog zcode exposes outside a running
 * desktop session — the app-server's own catalog fills only when a desktop
 * client connects and pushes it. Missing or corrupt → null; the adapter
 * returns an empty list and every run uses the session's own default model.
 */
export async function readZcodeProviderConfig(
  home: string = homedir(),
  readFileFn: typeof readFile = readFile,
): Promise<string | null> {
  const path = join(home, ".zcode", "v2", "config.json");
  try {
    return await readFileFn(path, "utf8");
  } catch {
    return null;
  }
}

function killChild(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    // Negative pid = the whole process group.
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
