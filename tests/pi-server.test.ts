import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probePi, resolvePiPackageRoot } from "../src/main/pi-server.js";

describe("resolvePiPackageRoot", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "awefork-pi-root-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves the package beside a global npm win32 shim", async () => {
    const bin = join(root, "npm");
    const packageRoot = join(bin, "node_modules", "@mariozechner", "pi-coding-agent");
    mkdirSync(join(packageRoot, "dist"), { recursive: true });
    writeFileSync(join(bin, "pi.cmd"), "@echo off\r\n", "utf8");

    await expect(resolvePiPackageRoot({ PATH: bin }, "win32")).resolves.toBe(packageRoot);
  });

  it("prefers the new scope's package beside the shim", async () => {
    const bin = join(root, "npm");
    const packageRoot = join(bin, "node_modules", "@earendil-works", "pi-coding-agent");
    mkdirSync(join(packageRoot, "dist", "bundle"), { recursive: true });
    writeFileSync(join(bin, "pi.cmd"), "@echo off\r\n", "utf8");

    await expect(resolvePiPackageRoot({ PATH: bin }, "win32")).resolves.toBe(packageRoot);
  });
});

describe("probePi", () => {
  /** execFn double shaped like the promisified execFile probePi injects. */
  function fakeExec(result: { stdout: string } | Error): Parameters<typeof probePi>[0] {
    return vi.fn(() =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ stdout: result.stdout, stderr: "" }),
    ) as unknown as Parameters<typeof probePi>[0];
  }

  it("reports installed with the probed version", async () => {
    await expect(probePi(fakeExec({ stdout: "1.4.0\n" }), "win32")).resolves.toEqual({
      installed: true,
      version: "1.4.0",
    });
  });

  it("reports not installed when the CLI is missing", async () => {
    await expect(probePi(fakeExec(new Error("spawn pi ENOENT")), "win32")).resolves.toEqual({
      installed: false,
      version: null,
    });
  });

  it("reports installed with no version when the output has none", async () => {
    await expect(probePi(fakeExec({ stdout: "" }), "win32")).resolves.toEqual({
      installed: true,
      version: null,
    });
  });
});
