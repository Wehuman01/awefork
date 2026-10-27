import { describe, expect, it } from "vitest";
import { digestRecordFromGroup } from "../src/renderer/src/digests";
import { type DigestGroup, normalizeDigestGroup } from "../src/shared/digest-types";

function group(): DigestGroup {
  const normalized = normalizeDigestGroup({
    id: "digest-1",
    backend: "opencode",
    directory: "/demo/project",
    anchorSessionId: "ses_anchor",
    anchorMessageId: "msg_1",
    createdAt: 100,
    scope: "story",
    sources: [
      {
        sessionId: "ses_a",
        storyRootId: "ses_root_a",
        title: "故事甲",
        turnMessageId: null,
        turnCount: 3,
        omittedTurns: 1,
        chars: 120,
      },
    ],
    summarySessionId: "ses_summary",
    status: "done",
    text: "总结正文",
    error: null,
    versions: [
      {
        version: 1,
        sessionId: "ses_summary",
        createdAt: 200,
        scope: "story",
        sources: [
          {
            sessionId: "ses_a",
            storyRootId: "ses_root_a",
            title: "故事甲",
            turnMessageId: null,
            turnCount: 3,
            omittedTurns: 1,
            chars: 120,
          },
        ],
      },
    ],
    settings: { model: { providerId: "p", modelId: "m" }, length: "standard" },
  });
  if (!normalized) throw new Error("fixture failed validation");
  return normalized;
}

describe("digestRecordFromGroup", () => {
  it("projects plain data that survives the sidecar round-trip", () => {
    const record = digestRecordFromGroup(group());
    // The record is plain JSON: structuredClone (what the IPC boundary and
    // the sidecar both do) must accept it.
    expect(structuredClone(record)).toEqual(record);
    expect(normalizeDigestGroup(record)).toEqual(record);
  });

  it("copies nested sources and versions instead of sharing references", () => {
    const live = group();
    const record = digestRecordFromGroup(live);
    expect(record.sources[0]).not.toBe(live.sources[0]);
    expect(record.versions[0]).not.toBe(live.versions[0]);
    expect(record.versions[0]?.sources[0]).not.toBe(live.versions[0]?.sources[0]);
    expect(record.settings).not.toBe(live.settings);
    expect(record.settings.model).not.toBe(live.settings.model);
  });
});
