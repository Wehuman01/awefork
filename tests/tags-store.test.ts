import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteTag,
  pruneTags,
  readTags,
  setSessionTags,
  setTagColor,
  writeTags,
} from "../src/shared/tags-store";

async function tempTagsPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "awefork-tags-")), "tags.json");
}

describe("tags store", () => {
  it("returns empty store when file does not exist", async () => {
    expect(await readTags(await tempTagsPath())).toEqual({ sessions: {}, colors: {} });
  });

  it("treats corrupted files as empty", async () => {
    const path = await tempTagsPath();
    await writeFile(path, "not json at all", "utf8");
    expect(await readTags(path)).toEqual({ sessions: {}, colors: {} });
  });

  it("migrates the legacy sessionId → names map on read", async () => {
    const path = await tempTagsPath();
    await writeFile(path, JSON.stringify({ ses_1: ["执行"], ses_2: ["执行", "咨询"] }), "utf8");
    expect(await readTags(path)).toEqual({
      sessions: { ses_1: ["执行"], ses_2: ["执行", "咨询"] },
      colors: {},
    });
  });

  it("setSessionTags adds then clears a session", async () => {
    const path = await tempTagsPath();
    await expect(setSessionTags(path, "ses_1", ["执行"])).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: {},
    });
    await expect(setSessionTags(path, "ses_1", [])).resolves.toEqual({
      sessions: {},
      colors: {},
    });
  });

  it("setTagColor sets, normalizes and clears a hue", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行"]);
    await expect(setTagColor(path, "执行", 380)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 20 },
    });
    await expect(setTagColor(path, "执行", null)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: {},
    });
  });

  it("deleteTag strips the tag from every session and its color", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行", "咨询"]);
    await setSessionTags(path, "ses_2", ["执行"]);
    await setTagColor(path, "执行", 210);
    await expect(deleteTag(path, "执行")).resolves.toEqual({
      sessions: { ses_1: ["咨询"] },
      colors: {},
    });
    expect(await readTags(path)).toEqual({ sessions: { ses_1: ["咨询"] }, colors: {} });
  });

  it("round-trips the new shape through writeTags/readTags", async () => {
    const path = await tempTagsPath();
    await writeTags(path, { sessions: { ses_1: ["执行"] }, colors: { 执行: 40 } });
    expect(await readTags(path)).toEqual({ sessions: { ses_1: ["执行"] }, colors: { 执行: 40 } });
  });

  it("keeps a color while at least one session still references the tag", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行"]);
    await setSessionTags(path, "ses_2", ["执行"]);
    await setTagColor(path, "执行", 40);
    await expect(setSessionTags(path, "ses_1", [])).resolves.toEqual({
      sessions: { ses_2: ["执行"] },
      colors: { 执行: 40 },
    });
  });

  it("setSessionTags drops the color once its last session reference is gone", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行"]);
    await setTagColor(path, "执行", 40);
    await expect(setSessionTags(path, "ses_1", [])).resolves.toEqual({
      sessions: {},
      colors: {},
    });
    expect(await readTags(path)).toEqual({ sessions: {}, colors: {} });
  });

  it("pruneTags drops orphan colors from the removed session", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行"]);
    await setSessionTags(path, "ses_2", ["咨询"]);
    await setTagColor(path, "执行", 40);
    await setTagColor(path, "咨询", 200);
    await expect(pruneTags(path, "ses_1")).resolves.toEqual({
      sessions: { ses_2: ["咨询"] },
      colors: { 咨询: 200 },
    });
    expect(await readTags(path)).toEqual({ sessions: { ses_2: ["咨询"] }, colors: { 咨询: 200 } });
  });

  it("pruneTags is a no-op for unknown sessions", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行"]);
    await setTagColor(path, "执行", 40);
    await expect(pruneTags(path, "ses_missing")).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 40 },
    });
  });

  it("setTagColor ignores unknown or inactive tags instead of orphaning colors", async () => {
    const path = await tempTagsPath();
    await expect(setTagColor(path, "幽灵", 100)).resolves.toEqual({ sessions: {}, colors: {} });
    expect(await readTags(path)).toEqual({ sessions: {}, colors: {} });

    await setSessionTags(path, "ses_1", ["执行"]);
    await setTagColor(path, "执行", 40);
    await expect(setTagColor(path, "幽灵", 100)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 40 },
    });
    expect(await readTags(path)).toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 40 },
    });
  });

  it("setTagColor ignores non-finite hues and no-op clears", async () => {
    const path = await tempTagsPath();
    await setSessionTags(path, "ses_1", ["执行"]);
    await setTagColor(path, "执行", 40);
    await expect(setTagColor(path, "执行", Number.NaN)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 40 },
    });
    await expect(setTagColor(path, "执行", Number.POSITIVE_INFINITY)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 40 },
    });
    await expect(setTagColor(path, "执行", null)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: {},
    });
    await expect(setTagColor(path, "执行", null)).resolves.toEqual({
      sessions: { ses_1: ["执行"] },
      colors: {},
    });
  });

  it("readTags drops invalid and orphan colors defensively", async () => {
    const path = await tempTagsPath();
    await writeFile(
      path,
      JSON.stringify({
        sessions: { ses_1: ["执行"] },
        colors: { 执行: 380, 咨询: "red", 幽灵: 30, 废弃: null },
      }),
      "utf8",
    );
    expect(await readTags(path)).toEqual({
      sessions: { ses_1: ["执行"] },
      colors: { 执行: 20 },
    });
  });
});
