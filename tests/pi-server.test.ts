import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePiPackageRoot } from "../src/main/pi-server.js";

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
});
