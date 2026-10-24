import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveSpawnEnv: vi.fn() }));

vi.mock("../src/main/opencode-server", () => ({
  resolveSpawnEnv: mocks.resolveSpawnEnv,
}));

import {
  backendInstallable,
  describeInstallFailure,
  installBackend,
  parseRetiredDir,
} from "../src/main/agent-installer";
import { readOnboardingDone, writeOnboardingDone } from "../src/main/settings-store";

/** npm-style ENOTEMPTY text, as execFile's rejected Error carries it. */
function enoemptyError(pkg: string, pkgDir: string, retired: string): Error {
  return new Error(
    [
      `Command failed:npm install -g ${pkg}@latest`,
      "npm error code ENOTEMPTY",
      "npm error syscall rename",
      `npm error path ${pkgDir}`,
      `npm error dest ${retired}`,
      "npm error errno -66",
      `npm error ENOTEMPTY: directory not empty, rename '${pkgDir}' -> '${retired}'`,
      "npm error A complete log of this run can be found in: /Users/peng/.npm/_logs/debug-0.log",
    ].join("\n"),
  );
}

/**
 * execFn double shaped like promisified execFile: dispatches on the npm
 * subcommand so a test can answer `uninstall` and `install` differently.
 */
function fakeExec(
  handler: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
): Parameters<typeof installBackend>[1] {
  return vi.fn((_file: string, args: string[]) => handler(args)) as unknown as Parameters<
    typeof installBackend
  >[1];
}

const ok = (): Promise<{ stdout: string; stderr: string }> =>
  Promise.resolve({ stdout: "", stderr: "" });

describe("installBackend", () => {
  beforeEach(() => {
    mocks.resolveSpawnEnv.mockResolvedValue({ PATH: "/usr/local/bin" });
  });

  it("installs the opencode npm package at latest", async () => {
    const calls: string[][] = [];
    const exec = fakeExec(async (args) => {
      calls.push(args);
      return ok();
    });
    await expect(installBackend("opencode", exec)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["install", "-g", "opencode-ai@latest"]]);
    expect(exec).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "opencode-ai@latest"],
      expect.objectContaining({ timeout: 5 * 60_000 }),
    );
  });

  it("installs codex through its npm package", async () => {
    await expect(
      installBackend(
        "codex",
        fakeExec(async () => ok()),
      ),
    ).resolves.toEqual({
      ok: true,
    });
    expect(backendInstallable("codex")).toBe(true);
  });

  it("installs pi from the new scope and uninstalls the legacy one first", async () => {
    const calls: string[][] = [];
    const exec = fakeExec(async (args) => {
      calls.push(args);
      return ok();
    });
    await expect(installBackend("pi", exec)).resolves.toEqual({ ok: true });
    // The legacy global package still owns the `pi` bin symlink; npm will not
    // hand it to the new package on its own.
    expect(calls).toEqual([
      ["uninstall", "-g", "@mariozechner/pi-coding-agent"],
      ["install", "-g", "@earendil-works/pi-coding-agent@latest"],
    ]);
    expect(backendInstallable("pi")).toBe(true);
  });

  it("installs pi even when the legacy uninstall fails", async () => {
    const exec = fakeExec(async (args) => {
      if (args[0] === "uninstall") throw new Error("npm error code EACCES");
      return ok();
    });
    await expect(installBackend("pi", exec)).resolves.toEqual({ ok: true });
  });

  it("refuses zcode — no one-command install — with the manual hint", async () => {
    const exec = fakeExec(async () => ok());
    await expect(installBackend("zcode", exec)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("ZCode"),
    });
    expect(exec).not.toHaveBeenCalled();
    expect(backendInstallable("zcode")).toBe(false);
  });

  it("surfaces the npm failure instead of throwing", async () => {
    const result = await installBackend(
      "opencode",
      fakeExec(async () => {
        throw new Error("EACCES: permission denied");
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("opencode-ai");
    expect(result.error).toContain("EACCES");
  });

  describe("interrupted-install recovery", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "awefork-installer-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("clears npm's leftover retire dir and retries the swap once", async () => {
      const retired = join(dir, ".pi-coding-agent-BU3NDNnF");
      await mkdir(retired, { recursive: true });
      let installs = 0;
      const exec = fakeExec(async (args) => {
        if (args[0] === "uninstall") return ok();
        installs += 1;
        if (installs === 1)
          throw enoemptyError(
            "@earendil-works/pi-coding-agent",
            join(dir, "pi-coding-agent"),
            retired,
          );
        return ok();
      });

      await expect(installBackend("pi", exec)).resolves.toEqual({ ok: true });
      expect(installs).toBe(2);
      await expect(stat(retired)).rejects.toThrow();
    });

    it("gives up with the actionable hint when the leftover cannot be cleared", async () => {
      const retired = join(dir, ".pi-coding-agent-BU3NDNnF");
      // Nothing on disk to remove: the retry would fail identically, so the
      // failure text must tell the user exactly what stands in the way.
      const exec = fakeExec(async (args) => {
        if (args[0] === "uninstall") return ok();
        throw enoemptyError(
          "@earendil-works/pi-coding-agent",
          join(dir, "pi-coding-agent"),
          retired,
        );
      });

      const result = await installBackend("pi", exec);
      expect(result.ok).toBe(false);
      expect(result.error).toContain(retired);
      expect(result.error).toContain("rm -rf");
      expect(result.error).toContain("ENOTEMPTY");
    });

    it("does not retry a second ENOTEMPTY — the loop stays bounded", async () => {
      const retired = join(dir, ".pi-coding-agent-BU3NDNnF");
      await mkdir(retired, { recursive: true });
      let installs = 0;
      const exec = fakeExec(async (args) => {
        if (args[0] === "uninstall") return ok();
        installs += 1;
        // Recreated by a concurrent npm run: every attempt sees it again.
        await mkdir(retired, { recursive: true });
        throw enoemptyError(
          "@earendil-works/pi-coding-agent",
          join(dir, "pi-coding-agent"),
          retired,
        );
      });

      await expect(installBackend("pi", exec)).resolves.toMatchObject({ ok: false });
      expect(installs).toBe(2);
    });
  });
});

describe("parseRetiredDir", () => {
  const pkg = "@earendil-works/pi-coding-agent";

  it("picks the retire dest out of an ENOTEMPTY failure", () => {
    const retired = "/npm/@earendil-works/.pi-coding-agent-BU3NDNnF";
    expect(
      parseRetiredDir(enoemptyError(pkg, "/npm/@earendil-works/pi-coding-agent", retired), pkg),
    ).toBe(retired);
  });

  it("ignores failures that are not ENOTEMPTY renames", () => {
    expect(parseRetiredDir(new Error("EACCES: permission denied"), pkg)).toBeNull();
    expect(parseRetiredDir(new Error("npm error code ETARGET"), pkg)).toBeNull();
  });

  it("ignores a dest that is not this package's retire dir", () => {
    const other = "/npm/@openai/.codex-ZZZZZZZZ";
    expect(
      parseRetiredDir(enoemptyError(pkg, "/npm/@earendil-works/pi-coding-agent", other), pkg),
    ).toBeNull();
  });
});

describe("describeInstallFailure", () => {
  const pkg = "opencode-ai";

  it("maps a permission error to a write-access hint and keeps npm's detail", () => {
    const text = describeInstallFailure(
      pkg,
      new Error("EACCES: permission denied, mkdir '/usr/local/lib/node_modules'"),
    );
    expect(text).toContain("write access");
    expect(text).toContain("EACCES");
  });

  it("maps a missing npm to a Node.js hint", () => {
    const text = describeInstallFailure(pkg, new Error("spawn npm ENOENT"));
    expect(text).toContain("npm was not found");
    expect(text).toContain("Node.js");
  });

  it("maps an unreachable registry to a network hint", () => {
    const text = describeInstallFailure(
      pkg,
      new Error("request to https://registry.npmjs.org failed, reason: ENOTFOUND"),
    );
    expect(text).toContain("unreachable");
    expect(text).toContain("network");
  });

  it("passes an unrecognized failure through with the package named", () => {
    const text = describeInstallFailure(pkg, new Error("npm error code ETARGET"));
    expect(text).toContain(pkg);
    expect(text).toContain("ETARGET");
  });
});

describe("onboarding settings flag", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "awefork-onboarding-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads false until written, true after", async () => {
    const settingsPath = join(dir, "settings.json");
    await expect(readOnboardingDone(settingsPath)).resolves.toBe(false);
    await writeOnboardingDone(settingsPath);
    await expect(readOnboardingDone(settingsPath)).resolves.toBe(true);
  });

  it("treats a corrupt settings file as not-done", async () => {
    const { writeFile } = await import("node:fs/promises");
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, "{not json", "utf8");
    await expect(readOnboardingDone(settingsPath)).resolves.toBe(false);
  });
});
