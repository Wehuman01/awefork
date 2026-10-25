import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, posix } from "node:path";
import { promisify } from "node:util";
import { isCmdNotFound, missingCliMessage } from "./missing-cli.js";
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

/**
 * Candidate .cjs bundle paths, most common first. Forward separators on
 * purpose: node's fs accepts "/" on every platform, and tests simulate any
 * platform from any host (host `join` would emit "\" on Windows).
 */
function bundleCandidates(
  home: string,
  plat: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): string[] {
  if (plat === "win32") {
    // The install root follows the real environment, not a hardcoded C: —
    // a machine that installs ZCode on another drive never sees C:. The
    // per-machine folder is "ZCode" and the per-user one is "zcode", so
    // each root carries its own folder name.
    const roots: string[] = [];
    for (const programFiles of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
      if (typeof programFiles !== "string" || programFiles === "") continue;
      roots.push(posix.join(programFiles.replaceAll("\\", "/"), "ZCode"));
    }
    for (const localAppData of [
      env.LOCALAPPDATA,
      posix.join(home.replaceAll("\\", "/"), "AppData", "Local"),
    ]) {
      if (typeof localAppData !== "string" || localAppData === "") continue;
      roots.push(posix.join(localAppData.replaceAll("\\", "/"), "Programs", "zcode"));
    }
    // The default C: root stays as a last resort for a machine whose
    // environment does not export ProgramFiles.
    roots.push("C:/Program Files/ZCode");
    const seen = new Set<string>();
    return roots
      .map((root) => posix.join(root, "resources", "glm", "zcode.cjs"))
      .filter((path) => {
        if (seen.has(path)) return false;
        seen.add(path);
        return true;
      });
  }
  if (plat !== "darwin") return [];
  return [
    "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs",
    posix.join(home, "Applications", "ZCode.app", "Contents", "Resources", "glm", "zcode.cjs"),
  ];
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
  if (override && existsSync(override)) return scriptRunner(override, execFn);
  const bundled = bundleCandidates(home, plat, env).find((path) => existsSync(path));
  if (bundled) return scriptRunner(bundled, execFn);
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
 *
 * The CLI also resolves its built-in provider catalog from its own entry
 * script path (dir/provider/, then five levels up to config/provider/).
 * Neither matches this bundle's layout (the catalog sits one level up, in
 * Resources/config/provider/), and once the runtime catalog cache in
 * ~/.zcode expires the CLI needs the file — a miss makes it exit 1 with
 * "cannot locate the CLI ZCode Built-in Provider Config". The CLI accepts the
 * path
 * via ZCODE_BUILTIN_PROVIDER_CONFIG_FILE (what the desktop app passes), so
 * hand it over whenever the file can be located next to the script.
 */
function builtinProviderEnv(scriptPath: string): Record<string, string> {
  // Forward-separator rule as bundleCandidates: node's fs accepts "/" on
  // every platform, and normalizing "\" first lets a Windows-style
  // AWEFORK_ZCODE_CLI override survive posix.dirname.
  const script = scriptPath.replaceAll("\\", "/");
  const dir = posix.dirname(script);
  // posix.join, not posix.resolve: resolve treats a Windows drive path
  // ("C:/Program Files/…") as relative and prefixes the cwd, so the
  // "one level up" candidate never lands on the real Resources/config
  // folder on Windows. join folds ".." without a cwd, and keeps the drive
  // prefix intact.
  const up = (levels: number): string =>
    posix.join(dir, ...Array.from({ length: levels }, () => ".."));
  const candidates = [
    posix.join(dir, "provider", "zcode-builtin.json"),
    posix.join(up(5), "config/provider/zcode-builtin.json"),
    posix.join(up(1), "config/provider/zcode-builtin.json"),
  ];
  const found = candidates.find((path) => existsSync(path));
  return found ? { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: found } : {};
}

/**
 * How to run a .cjs CLI script. A plain `node` is preferred: on macOS the
 * dev app's process.execPath is the Electron binary, and even with
 * ELECTRON_RUN_AS_NODE=1 a child of Electron.app registers with
 * LaunchServices as a second Electron application — a second Dock icon
 * bouncing beside awefork's own. A real node never touches AppKit.
 * GUI-launched PATHs may lack node, so Electron-as-node stays the fallback.
 */
async function scriptRunner(scriptPath: string, execFn: typeof execFileAsync): Promise<ZcodeCli> {
  const providerEnv = builtinProviderEnv(scriptPath);
  try {
    await execFn("node", ["--version"], { timeout: 5000 });
    return { command: "node", args: [scriptPath], env: providerEnv };
  } catch {
    return {
      command: process.execPath,
      args: [scriptPath],
      env: { ELECTRON_RUN_AS_NODE: "1", ...providerEnv },
    };
  }
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

/** Grace window a freshly spawned child gets before it is trusted. */
const SPAWN_GRACE_MS = 300;

/** A slot nobody owns anymore must not keep a live child. */
function discardSlot(dead: ServerSlot): void {
  dead.alive = false;
  if (dead.child.exitCode === null) killChild(dead.child);
}

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
      "zcode CLI not found. Install the ZCode desktop app and retry, or point AWEFORK_ZCODE_CLI at zcode.cjs.",
    );
  }

  const spawnChild = async (): Promise<ServerSlot> => {
    const spawnEnv = await resolveSpawnEnv(process.env, homedir(), undefined, process.platform);
    const child = spawnFn(cli.command, [...cli.args, "app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: homedir(),
      env: { ...spawnEnv, ...cli.env },
      // Own process group on POSIX so shutdown kills the whole tree (the
      // ELECTRON_RUN_AS_NODE wrapper spawns no grandchildren today, but the
      // CLI's own tool children may).
      detached: process.platform !== "win32",
      ...(process.platform === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    child.stdin?.on?.("error", () => {});
    // The child's own diagnostics are the only clue when it dies mid-request
    // (a crashed app-server otherwise surfaces as a bare "connection lost"),
    // so keep a tail of stderr and log it with the exit code on every exit.
    let stderrTail = "";
    child.stderr?.on?.("data", (chunk: Buffer | string) => {
      stderrTail = (
        stderrTail + (typeof chunk === "string" ? chunk : chunk.toString("utf8"))
      ).slice(-2048);
    });
    child.stderr?.on?.("error", () => {});
    const client = createZcodeJsonRpc(child.stdin, child.stdout, {
      onNotification: () => {},
      onDisconnect: () => markDead(slotOf(child)),
      onRequest: options.onRequest,
    });
    const created: ServerSlot = { child, client, alive: true };
    child.on("error", (error) => {
      console.error(`zcode app-server spawn error: ${error.message}`);
      markDead(created);
    });
    child.on("exit", (code, signal) => {
      const detail = stderrTail.trim();
      lastExitDetail = detail
        ? ` (${detail})`
        : ` (code=${code} signal=${signal}, no stderr output)`;
      // cmd.exe reports a missing command as exit code 9009 and never
      // surfaces the child's own ENOENT (the shim runs under shell:true).
      lastExitCode = code;
      console.error(
        `zcode app-server exited (code=${code} signal=${signal})${detail ? `: ${detail}` : ""}`,
      );
      markDead(created);
    });
    return created;
  };

  /** stderr tail from the most recent child exit, for the throw sites below. */
  let lastExitDetail = "";
  /** Exit code of the most recent child exit, for the 9009 diagnosis. */
  let lastExitCode: number | null = null;

  const slotOf = (child: ChildProcess): ServerSlot | null => (slot?.child === child ? slot : null);

  const markDead = (dead: ServerSlot | null): void => {
    if (!dead?.alive) return;
    dead.alive = false;
    if (slot === dead) slot = null;
  };

  slot = await spawnChild();
  // A wrong CLI path or a bad flag exits immediately; surface that instead
  // of letting the first request time out against a dead pipe.
  await new Promise<void>((resolve) => setTimeout(resolve, SPAWN_GRACE_MS));
  if (!slot.alive) {
    // A missing CLI on Windows exits 9009 under cmd.exe; name that instead
    // of the generic "exited right after launch", which reads like a broken
    // install rather than an absent command.
    if (isCmdNotFound(lastExitCode)) {
      throw new Error(
        missingCliMessage(
          "zcode",
          "Install the ZCode desktop app and retry, or point AWEFORK_ZCODE_CLI at zcode.cjs.",
        ),
      );
    }
    throw new Error(
      `zcode app-server exited right after launch${lastExitDetail}. Make sure the ZCode desktop app is installed correctly (AWEFORK_ZCODE_CLI can point at zcode.cjs).`,
    );
  }

  // A fresh handle pairs with a fresh adapter that re-registers on
  // ClientReplaced; registrations from the previous handle belong to adapters
  // this process no longer drives, so start the array clean instead of
  // wiping it in stop() (where a still-live adapter would lose its callback).
  replacedCallbacks = [];
  let stopped = false;
  // Per-handle in-flight respawn so concurrent client() calls share one
  // spawn without ever adopting another handle's child.
  let respawning: Promise<ServerSlot> | null = null;
  const currentHandle: ZcodeServerHandle = {
    async client() {
      if (stopped) throw new Error("zcode app-server has been stopped");
      if (!slot?.alive) {
        if (!respawning) {
          respawning = spawnChild().finally(() => {
            respawning = null;
          });
        }
        const fresh = await respawning;
        // stop() during the spawn must not install (and leak) the new child.
        if (stopped) {
          discardSlot(fresh);
          throw new Error("zcode app-server has been stopped");
        }
        // Another caller installed a live slot while this spawn ran; drop ours.
        if (slot?.alive) {
          discardSlot(fresh);
          return slot.client;
        }
        // Same grace as the initial spawn: a crash-looping CLI surfaces as
        // an error here, not as a dead client handed to the next request.
        await new Promise<void>((resolve) => setTimeout(resolve, SPAWN_GRACE_MS));
        if (stopped) {
          discardSlot(fresh);
          throw new Error("zcode app-server has been stopped");
        }
        if (!fresh.alive) {
          throw new Error(
            `zcode app-server exited right after restart${lastExitDetail}; make sure the ZCode desktop app is installed correctly (AWEFORK_ZCODE_CLI can point at zcode.cjs).`,
          );
        }
        if (slot?.alive) {
          discardSlot(fresh);
          return slot.client;
        }
        slot = fresh;
        for (const cb of replacedCallbacks) cb(fresh.client);
      }
      return slot.client;
    },
    onClientReplaced(cb) {
      replacedCallbacks.push(cb);
    },
    version: options.version ?? null,
    stop() {
      stopped = true;
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
 * The provider registry the app-server itself builds its model catalog from:
 * `~/.zcode/v2/provider_config.json`, the unified rules file. Missing or
 * corrupt → null; the adapter then returns an empty list and every run uses
 * the session's own default model.
 *
 * The legacy v2 `config.json` is read only when the registry file is absent —
 * an install old enough to predate the unification. On current builds the
 * app-server ignores it (verified live on 0.17.0: session/setModel rejects
 * every provider that exists only there with "Provider Registry 中不存在
 * Model"), so serving it as a peer source would list models the server
 * refuses to select.
 */
export async function readZcodeProviderConfig(
  home: string = homedir(),
  readFileFn: typeof readFile = readFile,
): Promise<string | null> {
  const registryPath = join(home, ".zcode", "v2", "provider_config.json");
  if (existsSync(registryPath)) {
    try {
      return await readFileFn(registryPath, "utf8");
    } catch {
      return null;
    }
  }
  const legacyPath = join(home, ".zcode", "v2", "config.json");
  try {
    return await readFileFn(legacyPath, "utf8");
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
