import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RoundsStore } from "../src/shared/rounds-store";
import { normalizeRoundRecord, type RoundRecord } from "../src/shared/rounds-types";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "awefork-rounds-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "rounds.json");
}

function record(id: string, createdAt: number, text = "答案"): RoundRecord {
  const normalized = normalizeRoundRecord({
    id,
    backend: "opencode",
    directory: "/demo/project",
    anchorSessionId: "ses_anchor",
    anchorMessageId: "msg_1",
    contextMode: "inherit",
    prompt: "问题",
    attachments: [],
    inheritedTags: [],
    createdAt,
    targets: [
      {
        id: "source-0",
        sessionId: `ses_${id}`,
        model: null,
        label: "first",
        status: "done",
        text,
        error: null,
        sentAt: createdAt,
        baselineMessageIds: [],
      },
    ],
    summarySessionId: null,
    summaryStatus: "skipped",
    summaryText: "",
    summaryError: null,
    summarySourceIds: [],
    summaryVersions: [],
    settings: { model: null, length: "none" },
  });
  if (!normalized) throw new Error("fixture record failed validation");
  return normalized;
}

describe("rounds store", () => {
  it("lists an empty store when the file does not exist", async () => {
    expect(await new RoundsStore(await tempStorePath()).list()).toEqual([]);
  });

  it("round-trips a saved record", async () => {
    const store = new RoundsStore(await tempStorePath());
    await store.save(record("round-1", 1));
    const [restored] = await store.list();
    expect(restored?.id).toBe("round-1");
    expect(restored?.targets[0]?.text).toBe("答案");
  });

  it("upserts by id, keeping one record per round", async () => {
    const store = new RoundsStore(await tempStorePath());
    await store.save(record("round-1", 1, "第一版"));
    await store.save(record("round-1", 1, "第二版"));
    const rounds = await store.list();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.targets[0]?.text).toBe("第二版");
  });

  it("keeps rounds ordered oldest first", async () => {
    const store = new RoundsStore(await tempStorePath());
    await store.save(record("round-b", 2));
    await store.save(record("round-a", 1));
    expect((await store.list()).map((item) => item.id)).toEqual(["round-a", "round-b"]);
  });

  it("drops the oldest rounds past the cap", async () => {
    const store = new RoundsStore(await tempStorePath());
    for (let i = 0; i < 205; i += 1) {
      await store.save(record(`round-${i}`, i));
    }
    const rounds = await store.list();
    expect(rounds).toHaveLength(200);
    expect(rounds[0]?.id).toBe("round-5");
    expect(rounds.at(-1)?.id).toBe("round-204");
  });

  it("treats a corrupted file as no rounds", async () => {
    const path = await tempStorePath();
    await writeFile(path, "not json at all", "utf8");
    expect(await new RoundsStore(path).list()).toEqual([]);
  });

  it("drops invalid entries but keeps the valid ones", async () => {
    const path = await tempStorePath();
    const good = record("round-1", 1);
    await writeFile(
      path,
      JSON.stringify({ version: 1, rounds: [good, { id: "broken" }, null] }),
      "utf8",
    );
    expect((await new RoundsStore(path).list()).map((item) => item.id)).toEqual(["round-1"]);
  });

  it("writes a versioned document", async () => {
    const path = await tempStorePath();
    await new RoundsStore(path).save(record("round-1", 1));
    const raw = JSON.parse(await readFile(path, "utf8")) as { version: number; rounds: unknown[] };
    expect(raw.version).toBe(1);
    expect(raw.rounds).toHaveLength(1);
  });
});
