import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveSpawnEnv: vi.fn() }));

vi.mock("../src/main/opencode-server", () => ({
  resolveSpawnEnv: mocks.resolveSpawnEnv,
}));

import { backendInstallable, installBackend } from "../src/main/agent-installer";
import { readOnboardingDone, writeOnboardingDone } from "../src/main/settings-store";

/** execFn double shaped like promisified execFile for installBackend. */
function fakeExec(result: "ok" | "fail") {
  return vi
    .fn()
    .mockImplementation(() =>
      result === "ok"
        ? Promise.resolve({ stdout: "", stderr: "" })
        : Promise.reject(new Error("EACCES: permission denied")),
    ) as unknown as Parameters<typeof installBackend>[1];
}

describe("installBackend", () => {
  beforeEach(() => {
    mocks.resolveSpawnEnv.mockResolvedValue({ PATH: "/usr/local/bin" });
  });

  it("installs the opencode npm package at latest", async () => {
    const exec = fakeExec("ok");
    await expect(installBackend("opencode", exec)).resolves.toEqual({ ok: true });
    expect(exec).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "opencode-ai@latest"],
      expect.objectContaining({ timeout: 5 * 60_000 }),
    );
  });

  it("installs codex and pi through their npm packages", async () => {
    await expect(installBackend("codex", fakeExec("ok"))).resolves.toEqual({ ok: true });
    await expect(installBackend("pi", fakeExec("ok"))).resolves.toEqual({ ok: true });
    expect(backendInstallable("codex")).toBe(true);
    expect(backendInstallable("pi")).toBe(true);
  });

  it("refuses zcode — no one-command install — with the manual hint", async () => {
    const exec = fakeExec("ok");
    await expect(installBackend("zcode", exec)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("ZCode"),
    });
    expect(exec).not.toHaveBeenCalled();
    expect(backendInstallable("zcode")).toBe(false);
  });

  it("surfaces the npm failure instead of throwing", async () => {
    const result = await installBackend("opencode", fakeExec("fail"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("opencode-ai");
    expect(result.error).toContain("EACCES");
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
