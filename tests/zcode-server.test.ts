import type { ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureZcodeServer, resolveZcodeCli, stopZcodeServer } from "../src/main/zcode-server.js";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  existsSync: vi.fn(),
  execFile: vi.fn(),
  resolveSpawnEnv: vi.fn().mockResolvedValue({}),
  createZcodeJsonRpc: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: mocks.spawn };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: mocks.existsSync };
});

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return { ...actual, promisify: actual.promisify };
});

vi.mock("../src/main/opencode-server.js", () => ({
  resolveSpawnEnv: mocks.resolveSpawnEnv,
}));

vi.mock("../src/main/zcode-jsonrpc.js", () => ({
  createZcodeJsonRpc: mocks.createZcodeJsonRpc,
}));

function fakeClient(overrides: Partial<ReturnType<typeof mocks.createZcodeJsonRpc>> = {}) {
  return {
    setNotificationHandler: vi.fn(),
    setRequestHandler: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof mocks.createZcodeJsonRpc>;
}

function createFakeChild(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let exitCode: number | null = null;
  let killed = false;

  const child = {
    stdin: {
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === "error") {
          const arr = listeners.get("stdinError");
          if (arr) arr.push(listener as () => void);
          else listeners.set("stdinError", [listener as () => void]);
        }
        return child.stdin;
      },
      write() {
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    stdout: {} as NodeJS.ReadableStream,
    on(event: string, listener: (...args: unknown[]) => void) {
      const arr = listeners.get(event);
      if (arr) arr.push(listener as (...args: unknown[]) => void);
      else listeners.set(event, [listener as (...args: unknown[]) => void]);
      return child;
    },
    get exitCode() {
      return exitCode;
    },
    set exitCode(value: number | null) {
      exitCode = value;
    },
    get pid() {
      return 12345;
    },
    kill(_signal?: string) {
      killed = true;
      exitCode = 0;
      const exitListeners = listeners.get("exit") ?? [];
      for (const listener of exitListeners) listener(0);
      return true;
    },
    ...overrides,
  } as unknown as ChildProcess;

  return child;
}

describe("zcode-server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.execFile.mockResolvedValue({ stdout: "zcode 0.16.5\n", stderr: "" });
    mocks.resolveSpawnEnv.mockResolvedValue({});
    mocks.createZcodeJsonRpc.mockImplementation(() => fakeClient());
    vi.resetModules();
  });

  afterEach(async () => {
    const { stopZcodeServer: stop } = await import("../src/main/zcode-server.js");
    stop();
  });

  describe("ensureZcodeServer", () => {
    it("respawns once under concurrent client() calls", async () => {
      vi.useFakeTimers();

      let spawnedChild: ChildProcess | null = null;
      mocks.spawn.mockImplementation(() => {
        const child = createFakeChild();
        spawnedChild = child;
        return child;
      });

      const { ensureZcodeServer: ensure } = await import("../src/main/zcode-server.js");
      const ensurePromise = ensure({}, mocks.spawn as typeof spawn);

      // Advance past the 300 ms startup observation window BEFORE awaiting
      // the pending ensure() so its internal setTimeout can resolve.
      await vi.advanceTimersByTimeAsync(350);
      const handle = await ensurePromise;

      const replacedClients: unknown[] = [];
      handle.onClientReplaced((c) => replacedClients.push(c));

      // Simulate the child dying (e.g., crash) before the concurrent calls.
      spawnedChild?.kill("SIGTERM");
      await vi.advanceTimersByTimeAsync(50);

      // The respawn re-checks the fresh child after the same 300 ms grace the
      // initial spawn gets; keep the fake clock moving while the callers wait.
      const pending = Promise.all([handle.client(), handle.client()]);
      await vi.advanceTimersByTimeAsync(350);
      const [clientA, clientB] = await pending;

      // initial spawn + one shared respawn
      expect(mocks.spawn).toHaveBeenCalledTimes(2);
      expect(clientA).toBe(clientB);
      expect(replacedClients.length).toBe(1);
      expect(replacedClients[0]).toBe(clientB);
    });

    it("stop() during an in-flight respawn discards the fresh child", async () => {
      vi.useFakeTimers();

      const children: ChildProcess[] = [];
      mocks.spawn.mockImplementation(() => {
        const child = createFakeChild();
        children.push(child);
        return child;
      });

      const { ensureZcodeServer: ensure } = await import("../src/main/zcode-server.js");
      const ensurePromise = ensure({}, mocks.spawn as typeof spawn);
      await vi.advanceTimersByTimeAsync(350);
      const handle = await ensurePromise;

      children[0]?.kill("SIGTERM");
      await vi.advanceTimersByTimeAsync(50);

      // client() runs synchronously up to its first await, so the respawn is
      // in flight by the time stop() tears the handle down. The rejection
      // assertion must be attached before the clock advances, or the promise
      // rejects unhandled.
      const pending = expect(handle.client()).rejects.toThrow("已停止");
      handle.stop();
      await vi.advanceTimersByTimeAsync(50);
      await pending;
      // The respawned child must not have been installed — a follow-up client()
      // on a fresh handle (not the stopped one) would spawn again, not adopt it.
      expect(mocks.spawn).toHaveBeenCalledTimes(2);
      await expect(handle.client()).rejects.toThrow("已停止");
    });

    it("a respawn that dies inside the grace window rejects instead of returning a dead client", async () => {
      vi.useFakeTimers();

      const children: ChildProcess[] = [];
      mocks.spawn.mockImplementation(() => {
        const child = createFakeChild();
        children.push(child);
        return child;
      });

      const { ensureZcodeServer: ensure } = await import("../src/main/zcode-server.js");
      const ensurePromise = ensure({}, mocks.spawn as typeof spawn);
      await vi.advanceTimersByTimeAsync(350);
      const handle = await ensurePromise;

      children[0]?.kill("SIGTERM");
      await vi.advanceTimersByTimeAsync(50);

      const pending = expect(handle.client()).rejects.toThrow("重启后立即退出");
      // Let the respawn spawn, then kill the fresh child inside its grace.
      await vi.advanceTimersByTimeAsync(1);
      children[1]?.kill("SIGTERM");
      await vi.advanceTimersByTimeAsync(350);
      await pending;

      expect(mocks.spawn).toHaveBeenCalledTimes(2);
    });

    it("stop() is idempotent", async () => {
      const { ensureZcodeServer: ensure } = await import("../src/main/zcode-server.js");
      const ensurePromise = ensure({}, mocks.spawn as typeof spawn);
      await vi.advanceTimersByTimeAsync(350);
      const handle = await ensurePromise;
      expect(() => {
        handle.stop();
        handle.stop();
      }).not.toThrow();
    });
  });

  describe("resolveZcodeCli", () => {
    it("finds a per-user macOS app bundle before falling back to PATH", async () => {
      const home = "/Users/tester";
      const bundledCli = "/Users/tester/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
      mocks.existsSync.mockImplementation((path: string) => path === bundledCli);

      const { resolveZcodeCli } = await import("../src/main/zcode-server.js");
      const result = await resolveZcodeCli(
        process.env,
        home,
        "darwin",
        mocks.execFile as typeof execFile,
      );

      expect(result).toEqual({
        command: process.execPath,
        args: [bundledCli],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      });
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it("prefers env override over bundle and PATH", async () => {
      const fakeCliPath = "/tmp/fake-zcode.cjs";
      mocks.existsSync.mockImplementation((path: string) => {
        if (path === fakeCliPath) return true;
        if (typeof path === "string" && path.includes("ZCode.app")) return false;
        return false;
      });

      const { resolveZcodeCli } = await import("../src/main/zcode-server.js");
      const result = await resolveZcodeCli(
        { ...process.env, AWEFORK_ZCODE_CLI: fakeCliPath },
        homedir(),
        "darwin",
        mocks.execFile as typeof execFile,
      );

      expect(result).toEqual({
        command: process.execPath,
        args: [fakeCliPath],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      });
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it("falls back to bundle on darwin when no env override", async () => {
      mocks.existsSync.mockImplementation((path: string) => {
        return typeof path === "string" && path.includes("ZCode.app");
      });

      const { resolveZcodeCli } = await import("../src/main/zcode-server.js");
      const result = await resolveZcodeCli(
        process.env,
        homedir(),
        "darwin",
        mocks.execFile as typeof execFile,
      );

      expect(result).toEqual({
        command: process.execPath,
        args: ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      });
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it("uses PATH fallback on linux when bundle is absent", async () => {
      mocks.existsSync.mockReturnValue(false);
      mocks.execFile.mockResolvedValue({ stdout: "zcode 0.16.5\n", stderr: "" });

      const { resolveZcodeCli } = await import("../src/main/zcode-server.js");
      const result = await resolveZcodeCli(
        process.env,
        homedir(),
        "linux",
        mocks.execFile as typeof execFile,
      );

      expect(result).toEqual({ command: "zcode", args: [] });
      expect(mocks.execFile).toHaveBeenCalledWith("zcode", ["--version"], expect.any(Object));
    });
  });
});
