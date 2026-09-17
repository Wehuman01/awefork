import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  PI_SDK_IMPORT,
  PI_SPAWN_DEFAULT_CWD,
  type PiAdapterNodeSeams,
  type PiRpcProcess,
} from "../shared/pi-adapter.js";
import { resolveSpawnEnv } from "./opencode-server.js";

const execFileAsync = promisify(execFile);

/**
 * Real process wiring for the pi adapter (main scope only). Everything an
 * adapter needs that reaches a real process — walking the session store,
 * driving `pi --mode rpc` children, and running the one-shot SDK scripts for
 * fork/rename/create — is implemented here and handed to the adapter as the
 * seam set, so shared/ stays pure and unit-testable.
 */

/**
 * Probe whether `pi` is on PATH without starting anything — the backend
 * switcher calls this for every candidate on boot and on switch.
 */
export async function isPiInstalled(
  execFn: typeof execFileAsync = execFileAsync,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  try {
    await execFn("pi", ["--version"], {
      timeout: 5000,
      env: await resolveSpawnEnv(process.env, homedir(), undefined, platform),
      // npm's .cmd shims only run under cmd.exe — without shell the probe
      // reports every npm-installed CLI as missing on Windows (the spawns
      // below carry the same branch).
      ...(platform === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The package root on whose PATH `pi` lives, following the bin symlink.
 * `pi`'s bin points at dist/cli.js, so the root is two directory hops up from
 * the resolved bin — dist/cli.js → dist → package root.
 */
export async function resolvePiPackageRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const spawnEnv = await resolveSpawnEnv(env, homedir(), undefined, platform);
  const pathEntry = spawnEnv.PATH ?? env.PATH ?? "";
  const separator = platform === "win32" ? ";" : ":";
  for (const dir of pathEntry.split(separator)) {
    if (!dir) continue;
    const binName = platform === "win32" ? "pi.cmd" : "pi";
    let real: string;
    try {
      real = await realpath(join(dir, binName));
    } catch {
      continue;
    }
    return dirname(dirname(real));
  }
  return null;
}

/** The store root: `$PI_CODING_AGENT_DIR/sessions`, else `~/.pi/agent/sessions`. */
function sessionsRoot(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = envDir
    ? envDir === "~"
      ? homedir()
      : envDir.startsWith("~/")
        ? join(homedir(), envDir.slice(2))
        : envDir
    : join(homedir(), ".pi", "agent");
  return join(agentDir, "sessions");
}

/** Recursively collect `.jsonl` session files under `dir`. */
async function listSessionFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  return files;
}

/**
 * Find a session file by its id under the sessions store. pi names files
 * `<timestamp>_<uuid>.jsonl`, so the id is matched against the suffix. The id
 * must pass a narrow charset check before it is glued onto a filename — an id
 * straight from the renderer could otherwise sneak a path separator through.
 */
export async function findPiSessionFile(sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null;
  const root = sessionsRoot();
  if (!existsSync(root)) return null;
  const needle = `_${sessionId}.jsonl`;
  // Session files live one level under the store (one directory per encoded
  // cwd); walk that single layer, matching the exact suffix.
  const dirs = await readdir(root, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const files = await readdir(join(root, dir.name), { withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && file.name.endsWith(needle)) {
        return join(root, dir.name, file.name);
      }
    }
  }
  return null;
}

/** Every spawned RPC child is registered here so dispose can kill the group. */
const rpcChildren = new Set<PiRpcProcess>();
const rpcChildRefs = new Set<ChildProcess>();

/** Kill a child and, on POSIX, its whole process group (cli shims' grandchildren). */
function killChild(child: ChildProcess): void {
  if (child.pid && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      /* fall through to signal the child directly */
    }
  }
  child.kill("SIGTERM");
}

/** Kill every pooled RPC child — registry dispose hands this out. */
export function stopPiChildren(): void {
  for (const child of rpcChildren) child.kill();
  for (const ref of rpcChildRefs) ref.kill();
  rpcChildren.clear();
  rpcChildRefs.clear();
}

/**
 * Run one ESM SDK program on the production node. The adapter writes scripts
 * that import from the `PI_SDK_IMPORT` placeholder; this is the only place
 * that knows the real package root, so it splices the path in here. stdout is
 * resolved; a non-zero exit folds stderr into the rejection message.
 */
async function runNodeScript(code: string): Promise<string> {
  const root = await resolvePiPackageRoot();
  if (!root) {
    throw new Error(
      "找不到 pi 运行时：请先安装 @mariozechner/pi-coding-agent 并确保 `pi` 在 PATH 上",
    );
  }
  const script = code.split(PI_SDK_IMPORT).join(root);
  const spawnEnv = await resolveSpawnEnv(process.env, homedir(), undefined, process.platform);
  return new Promise<string>((resolve, reject) => {
    const child = spawn("node", ["--input-type=module", "-e", script], {
      env: spawnEnv,
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`pi SDK 脚本执行失败：${stderr.trim() || `exit ${code}`}`));
    });
  });
}

/** newline JSON-RPC to/from a `pi --mode rpc` child. */
function createPiRpcProcess(child: ChildProcess): PiRpcProcess {
  let buffer = "";
  let eventHandler: ((event: unknown) => void) | null = null;
  let exitHandler: (() => void) | null = null;
  let nextId = 1;
  let dead = false;
  const pending = new Map<
    string,
    {
      timeout: NodeJS.Timeout;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  const settleExit = () => {
    if (dead) return;
    dead = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("pi RPC 子进程已退出"));
    }
    pending.clear();
    const cb = exitHandler;
    exitHandler = null;
    cb?.();
  };
  child.on("exit", settleExit);
  child.on("close", settleExit);
  child.on("error", () => settleExit());
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    // Decode at the source, never per chunk: a multi-byte CJK character can
    // split across reads, so the full buffer is buffered and then split into
    // complete lines, keeping any partial tail for the next chunk.
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") handleLine(line);
    }
  });
  child.stdin?.on?.("error", () => {});

  function handleLine(line: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // A malformed frame never travelled on a healthy wire; drop it rather
      // than kill the stream.
      return;
    }
    if (frame.type === "response") {
      const id = typeof frame.id === "string" ? frame.id : null;
      if (id) {
        const entry = pending.get(id);
        if (entry) {
          pending.delete(id);
          clearTimeout(entry.timeout);
          if (frame.success === false) {
            const detail = typeof frame.error === "string" ? frame.error : "pi RPC 请求失败";
            entry.reject(new Error(detail));
          } else {
            entry.resolve(frame.data ?? null);
          }
        }
      }
      return;
    }
    // Every other frame is agent activity (message_start, agent_end, …).
    eventHandler?.(frame);
  }

  return {
    request<T = unknown>(command: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
      if (dead) return Promise.reject(new Error("pi RPC 子进程未连接"));
      const id = String(nextId++);
      const payload = JSON.stringify({ ...command, id });
      return new Promise<T>((resolve, reject) => {
        // A timed-out request clears its own slot so a *late* response
        // cannot double-settle; the child is left alive for later commands.
        const timeout = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(
            new Error(`pi ${typeof command.type === "string" ? command.type : "命令"}请求超时`),
          );
        }, timeoutMs);
        pending.set(id, {
          timeout,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        child.stdin?.write(`${payload}\n`);
      });
    },
    setEventHandler(handler) {
      eventHandler = handler;
    },
    onExit(handler) {
      // A child that already died had its handler drained at exit time, so a
      // late subscription must fire immediately to avoid a leaked pool slot.
      if (dead) {
        handler();
        return;
      }
      exitHandler = handler;
    },
    kill() {
      killChild(child);
      settleExit();
    },
  };
}

/** Spawn a `pi --mode rpc` child; `cwd` selects the project config. */
async function spawnPiRpc(args: string[], cwd: string): Promise<PiRpcProcess> {
  // A cwd-agnostic probe (the global model list) arrives with the empty
  // sentinel; run it in the home directory so the child lands somewhere real.
  const effectiveCwd = cwd === PI_SPAWN_DEFAULT_CWD ? homedir() : cwd;
  const spawnEnv = await resolveSpawnEnv(process.env, homedir(), undefined, process.platform);
  const child = spawn("pi", ["--mode", "rpc", ...args], {
    stdio: ["pipe", "pipe", "ignore"],
    cwd: effectiveCwd,
    env: spawnEnv,
    // Own process group on POSIX so shutdown kills the grandchild too, same
    // as codex/opencode manage their npm-shimmed children; the win32 branch
    // carries the taskkill /T tree-kill instead.
    detached: process.platform !== "win32",
    ...(process.platform === "win32" ? { shell: true, windowsHide: true } : {}),
  });
  const proc = createPiRpcProcess(child);
  rpcChildren.add(proc);
  rpcChildRefs.add(child);
  // A child that exits mid-run must drop itself from the registry so a later
  // spawn re-pools cleanly instead of reusing a dead process.
  proc.onExit(() => {
    rpcChildren.delete(proc);
    rpcChildRefs.delete(child);
  });
  return proc;
}

/**
 * Production seams, spawned lazily by the adapter. The store root is resolved
 * once here (it cannot change inside a session); reading stays cheap.
 */
export async function piNodeSeams(): Promise<PiAdapterNodeSeams> {
  const sessionDir = sessionsRoot();
  return {
    async listSessionFiles() {
      return listSessionFiles(sessionDir);
    },
    readSessionFile(path) {
      return readFile(path, "utf8");
    },
    runNodeScript,
    spawnRpc: spawnPiRpc,
  };
}
