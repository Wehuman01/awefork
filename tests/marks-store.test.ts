import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  markKey,
  pruneSessionMarks,
  pruneTurnMark,
  readMarks,
  toggleMark,
} from "../src/shared/marks-store";

async function tempMarksPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "awefork-marks-")), "marks.json");
}

describe("marks store", () => {
  it("returns empty list when file does not exist", async () => {
    expect(await readMarks(await tempMarksPath())).toEqual([]);
  });

  it("round-trips toggles", async () => {
    const path = await tempMarksPath();
    const first = await toggleMark(path, "ses-a", "msg-1");
    expect(first).toEqual(["ses-a:msg-1"]);
    const second = await toggleMark(path, "ses-a", "msg-2");
    expect(second).toEqual(["ses-a:msg-1", "ses-a:msg-2"]);
    const off = await toggleMark(path, "ses-a", "msg-1");
    expect(off).toEqual(["ses-a:msg-2"]);
  });

  it("uses sessionId:messageId as the key", async () => {
    expect(markKey("ses", "msg")).toBe("ses:msg");
    const path = await tempMarksPath();
    await toggleMark(path, "ses", "msg");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(["ses:msg"]);
  });

  it("treats corrupted files as empty", async () => {
    const path = await tempMarksPath();
    await writeFile(path, "not json", "utf8");
    expect(await readMarks(path)).toEqual([]);
  });

  it("drops non-string and prototype-polluting entries", async () => {
    const path = await tempMarksPath();
    await writeFile(path, JSON.stringify(["ses:ok", 1, "__proto__", null]), "utf8");
    expect(await readMarks(path)).toEqual(["ses:ok"]);
  });

  it("pruneTurnMark drops only that turn", async () => {
    const path = await tempMarksPath();
    await toggleMark(path, "ses", "m1");
    await toggleMark(path, "ses", "m2");
    await pruneTurnMark(path, "ses", "m1");
    expect(await readMarks(path)).toEqual(["ses:m2"]);
  });

  it("pruneSessionMarks drops every turn of the session", async () => {
    const path = await tempMarksPath();
    await toggleMark(path, "ses-a", "m1");
    await toggleMark(path, "ses-a", "m2");
    await toggleMark(path, "ses-b", "m1");
    await pruneSessionMarks(path, "ses-a");
    expect(await readMarks(path)).toEqual(["ses-b:m1"]);
  });

  it("does not treat a session id prefix as a substring match", async () => {
    const path = await tempMarksPath();
    await toggleMark(path, "ses", "m1");
    await toggleMark(path, "ses-extra", "m1");
    await pruneSessionMarks(path, "ses");
    expect(await readMarks(path)).toEqual(["ses-extra:m1"]);
  });

  it("serializes concurrent toggles", async () => {
    const path = await tempMarksPath();
    await Promise.all([
      toggleMark(path, "ses", "m1"),
      toggleMark(path, "ses", "m2"),
      toggleMark(path, "ses", "m3"),
    ]);
    expect(await readMarks(path)).toEqual(["ses:m1", "ses:m2", "ses:m3"]);
  });

  it("creates the parent directory on demand", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "awefork-marks-")), "nested", "marks.json");
    await toggleMark(path, "ses", "m1");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(["ses:m1"]);
  });
});

describe("cleanup", () => {
  it("removes temp dirs", async () => {
    const path = await tempMarksPath();
    await rm(join(path, ".."), { recursive: true, force: true });
  });
});
