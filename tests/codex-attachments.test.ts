import { existsSync, readdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageCodexImages } from "../src/main/codex-attachments";
import type { PromptAttachment } from "../src/shared/types";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Track the staging dir so a failed cleanup assertion can still be inspected. */
function trackStaging(images: PromptAttachment[]) {
  const staged = stageCodexImages(images);
  dirs.push(dirname(staged.paths[0] ?? join(tmpdir(), "awefork-codex-att-none")));
  return staged;
}

const image = (filename: string, mime = "image/png", body = "png-bytes"): PromptAttachment => ({
  mime,
  filename,
  dataUrl: `data:${mime};base64,${Buffer.from(body).toString("base64")}`,
});

describe("stageCodexImages", () => {
  it("writes each image's decoded payload under a fresh temp dir", async () => {
    const staged = trackStaging([image("one.png"), image("two.png", "image/jpeg", "jpg-bytes")]);

    expect(staged.paths).toHaveLength(2);
    const [first, second] = staged.paths;
    expect(first?.endsWith("/one.png")).toBe(true);
    expect(second?.endsWith("/two.png")).toBe(true);
    expect(await readFile(first as string, "utf8")).toBe("png-bytes");
    expect(await readFile(second as string, "utf8")).toBe("jpg-bytes");
  });

  it("keeps the attachment's filename — history reads it back off the path", async () => {
    const staged = trackStaging([image("Screenshot 2026-10-24 at 10.41.02.png")]);
    expect(staged.paths[0]?.endsWith("/Screenshot 2026-10-24 at 10.41.02.png")).toBe(true);
  });

  it("dedupes colliding names within one batch", () => {
    const staged = trackStaging([image("photo.png"), image("photo.png"), image("photo.png")]);
    expect(staged.paths.map((p) => p.split("/").pop())).toEqual([
      "photo.png",
      "photo-2.png",
      "photo-3.png",
    ]);
  });

  it("flattens path traversal in the filename down to its basename", () => {
    const staged = trackStaging([image("../../etc/passwd")]);
    expect(staged.paths[0]?.split("/").pop()).toBe("passwd.png");
    expect(staged.paths[0]?.includes("..")).toBe(false);
  });

  it("gives an extensionless attachment one derived from its mime", () => {
    const staged = trackStaging([
      image("photo", "image/jpeg"),
      image("vector", "image/svg+xml"),
      image("mystery", "image/unknown"),
    ]);
    expect(staged.paths.map((p) => p.split("/").pop())).toEqual([
      "photo.jpg",
      "vector.svg",
      "mystery.unknown",
    ]);
  });

  it("cleanup removes the whole staging dir, and is safe to call twice", async () => {
    const staged = stageCodexImages([image("one.png")]);
    const dir = dirname(staged.paths[0] as string);

    expect(existsSync(dir)).toBe(true);
    staged.cleanup();
    expect(existsSync(dir)).toBe(false);
    expect(() => staged.cleanup()).not.toThrow();
  });

  it("cleans up and rethrows when a file cannot be written", async () => {
    // A 300-char filename is ENAMETOOLONG on macOS — the staging dir must not
    // survive the failure, and the caller's catch must see the error.
    const leftovers = () =>
      readdirSync(tmpdir()).filter((name) => name.startsWith("awefork-codex-att-"));
    expect(leftovers()).toEqual([]);

    expect(() => stageCodexImages([image(`${"x".repeat(300)}.png`)])).toThrow();
    expect(leftovers()).toEqual([]);
  });
});
