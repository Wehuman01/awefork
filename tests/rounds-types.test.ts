import { describe, expect, it } from "vitest";
import { normalizeRoundRecord, type RoundRecord } from "../src/shared/rounds-types";

function validRecord(): Record<string, unknown> {
  return {
    id: "parallel-1-abc",
    backend: "opencode",
    directory: "/demo/project",
    anchorSessionId: "ses_anchor",
    anchorMessageId: "msg_1",
    contextMode: "inherit",
    prompt: "怎样设计多模型阅读体验？",
    attachments: [{ mime: "image/png", filename: "a.png", dataUrl: "data:image/png;base64,AA" }],
    inheritedTags: ["文献"],
    createdAt: 1_700_000_000_000,
    targets: [
      {
        id: "source-0",
        sessionId: "ses_fork_1",
        model: { providerId: "demo", modelId: "first", variant: "high" },
        label: "first",
        status: "done",
        text: "答案一",
        error: null,
        sentAt: 1_700_000_001_000,
        baselineMessageIds: ["msg_0"],
      },
    ],
    summarySessionId: "ses_summary",
    summaryStatus: "done",
    summaryText: "## 结论",
    summaryError: null,
    summarySourceIds: ["source-0"],
    summaryVersions: [
      {
        version: 1,
        sessionId: "ses_summary",
        createdAt: 1_700_000_060_000,
        sources: [
          {
            targetId: "source-0",
            sessionId: "ses_fork_1",
            label: "first",
            baselineMessageIds: ["msg_0"],
          },
        ],
      },
    ],
    settings: { model: { providerId: "demo", modelId: "summarizer" }, length: "brief" },
  };
}

describe("normalizeRoundRecord", () => {
  it("keeps a well-formed record", () => {
    const record = normalizeRoundRecord(validRecord());
    expect(record).not.toBeNull();
    expect(record?.id).toBe("parallel-1-abc");
    expect(record?.backend).toBe("opencode");
    expect(record?.targets).toHaveLength(1);
    expect(record?.targets[0]?.model).toEqual({
      providerId: "demo",
      modelId: "first",
      variant: "high",
    });
    expect(record?.summaryVersions[0]?.sources).toHaveLength(1);
    expect(record?.settings).toEqual({
      model: { providerId: "demo", modelId: "summarizer" },
      length: "brief",
    });
  });

  it("rejects records missing their identity", () => {
    for (const field of ["id", "backend", "anchorSessionId", "prompt"]) {
      const raw = validRecord();
      delete raw[field];
      expect(normalizeRoundRecord(raw), field).toBeNull();
    }
    expect(normalizeRoundRecord(null)).toBeNull();
    expect(normalizeRoundRecord("nope")).toBeNull();
    expect(normalizeRoundRecord([])).toBeNull();
  });

  it("rejects an unknown backend and an unknown summary length", () => {
    expect(normalizeRoundRecord({ ...validRecord(), backend: "gemini" })).toBeNull();
    expect(
      normalizeRoundRecord({ ...validRecord(), settings: { model: null, length: "verbose" } }),
    ).toBeNull();
  });

  it("defaults tolerant fields instead of failing the round", () => {
    const raw = validRecord();
    delete raw.directory;
    delete raw.contextMode;
    delete raw.anchorMessageId;
    delete raw.summarySessionId;
    delete raw.summaryText;
    const record = normalizeRoundRecord(raw);
    expect(record).not.toBeNull();
    expect(record?.directory).toBe("");
    // A record written before the context field existed is an inheriting fork.
    expect(record?.contextMode).toBe("inherit");
    expect(record?.anchorMessageId).toBeNull();
    expect(record?.summarySessionId).toBeNull();
    expect(record?.summaryText).toBe("");
  });

  it("sanitizes an unknown status to unknown", () => {
    const raw = validRecord();
    (raw.targets as Array<Record<string, unknown>>)[0].status = "exploded";
    (raw as Record<string, unknown>).summaryStatus = "exploded";
    const record = normalizeRoundRecord(raw);
    expect(record?.targets[0]?.status).toBe("unknown");
    expect(record?.summaryStatus).toBe("unknown");
  });

  it("drops invalid sub-entries but keeps the round", () => {
    const raw = validRecord();
    raw.targets = [
      { id: "source-0", sessionId: "ses_fork_1", label: "first", status: "done" },
      { sessionId: "no-id" }, // no id: dropped, never renumbered
      null,
      "garbage",
    ];
    raw.summaryVersions = [{ version: 1, sessionId: "" }, null];
    raw.attachments = [
      { mime: "image/png" },
      { mime: "text/plain", filename: "a.txt", dataUrl: "data:,x" },
    ];
    raw.inheritedTags = ["文献", 42];
    const record = normalizeRoundRecord(raw);
    expect(record?.targets.map((target) => target.id)).toEqual(["source-0"]);
    expect(record?.targets[0]?.baselineMessageIds).toEqual([]);
    expect(record?.summaryVersions).toEqual([]);
    expect(record?.attachments).toHaveLength(1);
    expect(record?.inheritedTags).toEqual(["文献"]);
  });

  it("bounds oversized payloads", () => {
    const raw = validRecord();
    (raw as Record<string, unknown>).prompt = "x".repeat(100_000);
    const oversized = {
      ...(raw.targets as Array<Record<string, unknown>>)[0],
      text: "y".repeat(500_000),
      baselineMessageIds: Array.from({ length: 20_000 }, (_, i) => `msg_${i}`),
    };
    const many = Array.from({ length: 100 }, (_, i) => ({ ...oversized, id: `s${i}` }));
    (raw as Record<string, unknown>).targets = many;
    const record = normalizeRoundRecord(raw);
    expect(record?.prompt).toHaveLength(64_000);
    expect(record?.targets).toHaveLength(64);
    expect(record?.targets[0]?.text).toHaveLength(200_000);
    expect(record?.targets[0]?.baselineMessageIds).toHaveLength(10_000);
  });

  it("round-trips through JSON without losing the durable fields", () => {
    const record = normalizeRoundRecord(JSON.parse(JSON.stringify(validRecord())));
    expect(record).toEqual(normalizeRoundRecord(validRecord()));
    const typed: RoundRecord | null = record;
    expect(typed?.summarySourceIds).toEqual(["source-0"]);
  });
});
