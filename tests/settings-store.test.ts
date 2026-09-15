import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readBackendSelection,
  readOpencodePort,
  writeBackendSelection,
  writeOpencodePort,
} from "../src/main/settings-store";

const dirs: string[] = [];

async function tempSettingsPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "awefork-settings-"));
  dirs.push(dir);
  return join(dir, "settings.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readBackendSelection", () => {
  it("defaults to opencode when the file does not exist", async () => {
    expect(await readBackendSelection(await tempSettingsPath())).toBe("opencode");
  });

  it("reads a persisted selection", async () => {
    const path = await tempSettingsPath();
    await writeFile(path, JSON.stringify({ backend: "codex" }), "utf8");
    expect(await readBackendSelection(path)).toBe("codex");
  });

  it("falls back to opencode on a corrupt file", async () => {
    const path = await tempSettingsPath();
    await writeFile(path, "{not json", "utf8");
    expect(await readBackendSelection(path)).toBe("opencode");
  });

  it("falls back to opencode on an unknown backend value", async () => {
    const path = await tempSettingsPath();
    await writeFile(path, JSON.stringify({ backend: "claude" }), "utf8");
    expect(await readBackendSelection(path)).toBe("opencode");
  });
});

describe("writeBackendSelection", () => {
  it("round-trips a selection", async () => {
    const path = await tempSettingsPath();
    await writeBackendSelection(path, "codex");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ backend: "codex" });
    expect(await readBackendSelection(path)).toBe("codex");
  });

  it("preserves unknown keys from future versions", async () => {
    const path = await tempSettingsPath();
    await writeFile(path, JSON.stringify({ backend: "codex", theme: "dark" }), "utf8");
    await writeBackendSelection(path, "opencode");
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved).toEqual({ backend: "opencode", theme: "dark" });
  });

  it("recovers from a corrupt existing file instead of crashing", async () => {
    const path = await tempSettingsPath();
    await writeFile(path, "]]]garbage", "utf8");
    await writeBackendSelection(path, "codex");
    expect(await readBackendSelection(path)).toBe("codex");
  });
});

describe("opencodePort", () => {
  it("defaults to null when never recorded", async () => {
    expect(await readOpencodePort(await tempSettingsPath())).toBeNull();
  });

  it("round-trips a port and keeps the backend selection", async () => {
    const path = await tempSettingsPath();
    await writeBackendSelection(path, "codex");
    await writeOpencodePort(path, 18765);
    expect(await readOpencodePort(path)).toBe(18765);
    expect(await readBackendSelection(path)).toBe("codex");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      backend: "codex",
      opencodePort: 18765,
    });
  });

  it("ignores out-of-range or non-integer writes", async () => {
    const path = await tempSettingsPath();
    await writeOpencodePort(path, 0);
    await writeOpencodePort(path, 70000);
    expect(await readOpencodePort(path)).toBeNull();
  });

  it("reads back null on a corrupt value type", async () => {
    const path = await tempSettingsPath();
    await writeFile(path, JSON.stringify({ opencodePort: "4096" }), "utf8");
    expect(await readOpencodePort(path)).toBeNull();
  });
});
