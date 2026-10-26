import { describe, expect, it } from "vitest";
import type { ParallelGroup } from "../src/renderer/src/parallel-groups";
import { parallelGroupBusy } from "../src/renderer/src/parallel-groups";
import { groupFromRoundRecord, roundRecordFromGroup } from "../src/renderer/src/rounds";
import type { RoundRecord } from "../src/shared/rounds-types";

function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined) throw new Error("Missing test fixture value");
  return value;
}

function group(overrides: Partial<ParallelGroup> = {}): ParallelGroup {
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
        sentAt: 1_700_000_030_000,
        baselineMessageIds: ["msg_0"],
      },
      {
        id: "source-1",
        sessionId: "ses_fork_2",
        model: null,
        label: "default",
        status: "done",
        text: "答案二",
        error: null,
        sentAt: 1_700_000_030_000,
        baselineMessageIds: ["msg_0"],
      },
    ],
    summarySessionId: "ses_summary",
    summaryStatus: "done",
    summaryText: "## 结论",
    summaryError: null,
    summarySourceIds: ["source-0", "source-1"],
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
          {
            targetId: "source-1",
            sessionId: "ses_fork_2",
            label: "default",
            baselineMessageIds: ["msg_0"],
          },
        ],
      },
    ],
    settings: { model: { providerId: "demo", modelId: "summarizer" }, length: "standard" },
    ...overrides,
  };
}

describe("round record mapping", () => {
  it("projects a live group into its durable record", () => {
    const record = roundRecordFromGroup(group());
    expect(record.id).toBe("parallel-1-abc");
    expect(record.targets.map((target) => target.id)).toEqual(["source-0", "source-1"]);
    expect(record.summaryVersions).toHaveLength(1);
    expect(record.summaryVersions[0]?.sources).toHaveLength(2);
    expect(record.settings.length).toBe("standard");
  });

  it("deep-copies, so later group edits cannot mutate a saved record", () => {
    const source = group();
    const record = roundRecordFromGroup(source);
    // Mutate the live group after the save; the record must not follow.
    required(source.targets[0]).text = "改过的答案";
    required(source.targets[0]).baselineMessageIds.push("msg_late");
    source.inheritedTags.push("新标签");
    required(required(source.summaryVersions[0]).sources[0]).baselineMessageIds.push("msg_late");
    expect(record.targets[0]?.text).toBe("答案一");
    expect(record.targets[0]?.baselineMessageIds).toEqual(["msg_0"]);
    expect(record.inheritedTags).toEqual(["文献"]);
    expect(record.summaryVersions[0]?.sources[0]?.baselineMessageIds).toEqual(["msg_0"]);
  });

  it("survives a JSON round-trip with the durable fields intact", () => {
    const restored = groupFromRoundRecord(
      JSON.parse(JSON.stringify(roundRecordFromGroup(group()))) as RoundRecord,
    );
    expect(restored.targets.map((target) => target.status)).toEqual(["done", "done"]);
    expect(restored.summaryText).toBe("## 结论");
    expect(restored.summaryVersions[0]?.sources.map((source) => source.label)).toEqual([
      "first",
      "default",
    ]);
    expect(restored.settings.model).toEqual({ providerId: "demo", modelId: "summarizer" });
  });

  it("restores a finished round inert: nothing busy, nothing running", () => {
    const restored = groupFromRoundRecord(roundRecordFromGroup(group()));
    expect(parallelGroupBusy(restored)).toBe(false);
    expect(restored.targets.every((target) => target.status === "done")).toBe(true);
    expect(restored.summaryStatus).toBe("done");
  });

  it("restores an interrupted round as unknown, never as finished or busy", () => {
    const base = group();
    const interrupted = group({
      targets: [
        { ...required(base.targets[0]), status: "running", text: "", error: null },
        { ...required(base.targets[1]), status: "preparing", text: "", error: null },
      ],
      summaryStatus: "waiting",
      summaryText: "",
      summaryVersions: [],
      summarySessionId: null,
      summarySourceIds: [],
    });
    const restored = groupFromRoundRecord(roundRecordFromGroup(interrupted));
    expect(restored.targets.map((target) => target.status)).toEqual(["unknown", "unknown"]);
    expect(restored.summaryStatus).toBe("unknown");
    // A group that reads busy after a restart would block every send into it.
    expect(parallelGroupBusy(restored)).toBe(false);
  });

  it("keeps a deliberately skipped round skipped", () => {
    const skipped = group({ summaryStatus: "skipped", summaryText: "", summaryVersions: [] });
    const restored = groupFromRoundRecord(roundRecordFromGroup(skipped));
    expect(restored.summaryStatus).toBe("skipped");
    // The panel still offers a summary on demand from the collected answers.
    expect(restored.targets.map((target) => target.text)).toEqual(["答案一", "答案二"]);
  });

  it("keeps a failed round failed with its reason", () => {
    const base = group();
    const failed = group({
      targets: [{ ...required(base.targets[0]), status: "failed", text: "", error: "模型超时" }],
      summaryStatus: "failed",
      summaryText: "",
      summaryError: "没有可用回答",
      summarySourceIds: [],
    });
    const restored = groupFromRoundRecord(roundRecordFromGroup(failed));
    expect(restored.targets[0]?.status).toBe("failed");
    expect(restored.targets[0]?.error).toBe("模型超时");
    expect(restored.summaryStatus).toBe("failed");
    expect(restored.summaryError).toBe("没有可用回答");
  });

  it("keeps the empty-context marker a canvas ✂ round was sent with", () => {
    const cut = group({ contextMode: "none" });
    const restored = groupFromRoundRecord(roundRecordFromGroup(cut));
    expect(restored.contextMode).toBe("none");
    expect(restored.anchorMessageId).toBe("msg_1");
  });

  it("does not share nested objects with the record it came from", () => {
    const record = roundRecordFromGroup(group());
    const restored = groupFromRoundRecord(record);
    required(restored.targets[0]).baselineMessageIds.push("mutated");
    restored.settings.model = null;
    expect(record.targets[0]?.baselineMessageIds).toEqual(["msg_0"]);
    expect(record.settings.model).toEqual({ providerId: "demo", modelId: "summarizer" });
  });
});
