import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteTag,
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
});
