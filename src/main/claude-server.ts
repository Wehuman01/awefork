import { type ChildProcess, execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseVersion } from "../shared/agent-descriptor.js";
import {
  type ClaudeAdapterNodeSeams,
  type ClaudeChild,
  claudeSpawnArgsFor,
} from "../shared/claude-adapter.js";
import { isCmdNotFound, missingCliMessage } from "./missing-cli.js";
import { resolveSpawnEnv } from "./opencode-server.js";

const execFileAsync = promisify(execFile);

/**
 * Real process wiring for the claude backend (main scope only). Everything
 * the shared adapter needs that reaches a real process — probing the CLI,
 * spawning `claude -p` streaming children, walking the transcript store —
 * lives here and is handed to the adapter as its seam set.
 *
 * Transcript store: `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<uuid>.jsonl`
 * (encoded cwd = the absolute path with "/" and "." replaced by "-", e.g.
 * `-Users-peng-Desktop-Project`). The env var is set on the spawns too so a
 * test/override stays consistent between where the child writes and where
 * the walk reads.
 */

export interface ClaudeProbe {
  installed: boolean;
  version: string | null;
}

/** `claude --version` probe for the switcher; never starts a server. */
export async function probeClaude(
  execFn: typeof execFileAsync = execFileAsync,
  platform: NodeJS.Platform = process.platform,
): Promise<ClaudeProbe> {
  try {
    const { stdout } = await execFn("claude", ["--version"], {
      timeout: 8000,
      env: await resolveSpawnEnv(process.env, homedir(), undefined, platform),
      ...(platform === "win32" ? { shell: true, windowsHide: true } : {}),
    });
    return { installed: true, version: parseVersion(stdout) };
  } catch {
    return { installed: false, version: null };
  }
}

export async function isClaudeInstalled(): Promise<boolean> {
  return (await probeClaude()).installed;
}

/** The config dir the spawned CLIs and the store walk must agree on. */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/** The projects store root. */
export function claudeProjectsRoot(): string {
  return join(claudeConfigDir(), "projects");
}

/** Recursively collect every `.jsonl` transcript under the store. */
async function listTranscripts(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  return files;
}

/**
 * Spawn one prompt child for a session. The argv carries the session id
 * (and, for a pending fork copy, its resume args); permission asks ride
 * `--permission-prompt-tool stdio` — without it the standalone CLI denies
 * every gated tool silently instead of asking.
 */
async function spawnClaudeChild(
  cwd: string,
  sessionId: string,
  resumeParent?: string,
  /** Resume-only child (no --session-id): the shape /compact needs. */
  compactOnly = false,
): Promise<ClaudeChild> {
  const argv = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-prompt-tool",
    "stdio",
    ...(compactOnly ? ["--resume", sessionId] : claudeSpawnArgsFor(sessionId, resumeParent)),
  ];
  const spawnEnv = await resolveSpawnEnv(process.env, homedir(), undefined, process.platform);
  spawnEnv.CLAUDE_CONFIG_DIR = claudeConfigDir();
  // A cwd-less session lands in the home directory: the child needs a real
  // working directory and the transcript's encoded-cwd grouping follows it.
  const effectiveCwd = cwd === "" ? homedir() : cwd;
  const child: ChildProcess = spawn("claude", argv, {
    cwd: effectiveCwd,
    env: spawnEnv,
    stdio: ["pipe", "pipe", "pipe"],
    // Own process group on POSIX so shutdown kills grandchildren; win32 uses
    // the taskkill tree-kill, matching the pi/codex backends.
    detached: process.platform !== "win32",
    ...(process.platform === "win32" ? { shell: true, windowsHide: true } : {}),
  });

  let eventHandler: ((frame: Record<string, unknown>) => void) | null = null;
  let exitHandler: ((detail: string) => void) | null = null;
  let dead = false;
  let exitCode: number | null = null;
  let stderrTail = "";

  const settleExit = () => {
    if (dead) return;
    dead = true;
    const detail = isCmdNotFound(exitCode)
      ? missingCliMessage("claude", "Install it with: npm install -g @anthropic-ai/claude-code")
      : `exit ${exitCode ?? "signal"}${stderrTail ? ` — ${stderrTail}` : ""}`;
    const cb = exitHandler;
    exitHandler = null;
    cb?.(detail);
  };

  child.on("exit", (code) => {
    exitCode = code;
    settleExit();
  });
  child.on("close", (code) => {
    if (exitCode === null && typeof code === "number") exitCode = code;
    settleExit();
  });
  child.on("error", () => settleExit());
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    // Keep a short tail for the exit detail; the CLI writes progress there.
    stderrTail = `${stderrTail}${chunk}`.split("\n").slice(-3).join(" ").slice(-400);
  });

  // Newline-delimited JSON in; the same framing pi uses, so the buffering
  // rule matches: decode at the source, keep the partial tail.
  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      eventHandler?.(frame);
    }
  });
  child.stdin?.on?.("error", () => {});

  return {
    send(frame) {
      if (dead) throw new Error("claude child has exited");
      child.stdin?.write(`${JSON.stringify(frame)}\n`);
    },
    setEventHandler(handler) {
      eventHandler = handler;
    },
    onExit(handler) {
      if (dead) {
        handler(`exit ${exitCode ?? "signal"}`);
        return;
      }
      exitHandler = handler;
    },
    kill() {
      if (child.pid && process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
      settleExit();
    },
  };
}

/** The seam set for one adapter. */
export async function claudeNodeSeams(): Promise<ClaudeAdapterNodeSeams> {
  const root = claudeProjectsRoot();
  return {
    spawnChild: (sessionId, cwd, resumeParent) => spawnClaudeChild(cwd, sessionId, resumeParent),
    spawnCompactChild: (sessionId, cwd) => spawnClaudeChild(cwd, sessionId, undefined, true),
    listTranscriptFiles: () => listTranscripts(root),
    readTranscript: (path) => readFile(path, "utf8"),
    projectDirs: async () => {
      try {
        const entries = await readdir(root, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
      } catch {
        return [];
      }
    },
  };
}
