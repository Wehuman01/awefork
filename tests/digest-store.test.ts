import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DigestsStore } from "../src/shared/digest-store";
import { type DigestGroup, normalizeDigestGroup } from "../src/shared/digest-types";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "awefork-digests-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "digests.json");
}

function group(id: string, createdAt: number, text = "总结正文"): DigestGroup {
  const normalized = normalizeDigestGroup({
    id,
    backend: "opencode",
    directory: "/demo/project",
    anchorSessionId: "ses_anchor",
    anchorMessageId: null,
    createdAt,
    scope: "story",
    sources: [
      {
        sessionId: "ses_a",
        storyRootId: "ses_root_a",
        title: "故事甲",
        turnMessageId: null,
        turnCount: 2,
        omittedTurns: 0,
        chars: 90,
      },
    ],
    summarySessionId: `ses_summary_${id}`,
    status: "done",
    text,
    error: null,
    versions: [],
    settings: { model: null, length: "standard" },
  });
  if (!normalized) throw new Error("fixture failed validation");
  return normalized;
}

describe("DigestsStore", () => {
  it("upserts by id, oldest first", async () => {
    const store = new DigestsStore(await tempStorePath());
    await store.save(group("d1", 200));
    await store.save(group("d2", 100));
    await store.save(group("d1", 300, "更新后的正文"));
    const list = await store.list();
    expect(list.map((item) => [item.id, item.text])).toEqual([
      ["d2", "总结正文"],
      ["d1", "更新后的正文"],
    ]);
  });

  it("reads a missing file as no digests", async () => {
    const store = new DigestsStore(join(await tempStorePath(), "nope", "digests.json"));
    expect(await store.list()).toEqual([]);
  });

  it("reads a corrupt file as no digests instead of throwing", async () => {
    const path = await tempStorePath();
    await writeFile(path, "{ half-written", "utf8");
    expect(await new DigestsStore(path).list()).toEqual([]);
  });

  it("drops invalid entries on read", async () => {
    const path = await tempStorePath();
    await writeFile(
      path,
      `${JSON.stringify({ version: 1, digests: [{ id: "" }, group("d1", 100)] })}\n`,
      "utf8",
    );
    const list = await new DigestsStore(path).list();
    expect(list.map((item) => item.id)).toEqual(["d1"]);
  });

  it("trims to the newest cap", async () => {
    const store = new DigestsStore(await tempStorePath());
    for (let i = 0; i < 105; i += 1) {
      await store.save(group(`d${i}`, i));
    }
    const list = await store.list();
    expect(list).toHaveLength(100);
    expect(list[0]?.id).toBe("d5");
    expect(list.at(-1)?.id).toBe("d104");
  });

  it("writes atomically as one JSON document", async () => {
    const path = await tempStorePath();
    await new DigestsStore(path).save(group("d1", 100));
    const raw = JSON.parse(await readFile(path, "utf8")) as { version: number; digests: unknown[] };
    expect(raw.version).toBe(1);
    expect(raw.digests).toHaveLength(1);
  });
});
