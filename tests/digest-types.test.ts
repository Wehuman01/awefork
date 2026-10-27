import { describe, expect, it } from "vitest";
import {
  type DigestGroup,
  normalizeDigestGroup,
  restoreDigestGroup,
} from "../src/shared/digest-types";

function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
        omittedTurns: 0,
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
            omittedTurns: 0,
            chars: 120,
          },
        ],
      },
    ],
    settings: { model: null, length: "standard" },
    ...overrides,
  };
}

describe("normalizeDigestGroup", () => {
  it("keeps a well-formed record", () => {
    const normalized = normalizeDigestGroup(group());
    expect(normalized).not.toBeNull();
    expect(normalized?.id).toBe("digest-1");
    expect(normalized?.scope).toBe("story");
    expect(normalized?.sources[0]?.title).toBe("故事甲");
    expect(normalized?.versions[0]?.version).toBe(1);
    expect(normalized?.settings.length).toBe("standard");
  });

  it("drops records that lack the fields identifying a digest", () => {
    expect(normalizeDigestGroup(group({ id: "" }))).toBeNull();
    expect(normalizeDigestGroup(group({ backend: "nope" }))).toBeNull();
    expect(normalizeDigestGroup(group({ anchorSessionId: "" }))).toBeNull();
    expect(normalizeDigestGroup(group({ settings: { model: null, length: "huge" } }))).toBeNull();
    expect(normalizeDigestGroup(null)).toBeNull();
    expect(normalizeDigestGroup("digest")).toBeNull();
  });

  it("keeps the last known live state; the restore sanitizes it", () => {
    // "running" travels as-is in the record — restoreDigestGroup is what
    // turns an unwatched run into "unknown", so the record stays honest
    // about what the app last saw.
    const normalized = normalizeDigestGroup(
      group({ status: "running", scope: "weird", versions: [{ nope: true }, ...group().versions] }),
    );
    expect(normalized?.status).toBe("running");
    expect(normalized?.scope).toBe("story");
    // A malformed sub-entry is dropped, the good version survives.
    expect(normalized?.versions).toHaveLength(1);
    expect(restoreDigestGroup(normalized as DigestGroup).status).toBe("unknown");
  });

  it("restores a finished digest untouched", () => {
    const normalized = normalizeDigestGroup(group({ status: "done" })) as DigestGroup;
    expect(restoreDigestGroup(normalized)).toBe(normalized);
  });

  it("keeps a model choice and drops a malformed one", () => {
    const withModel = normalizeDigestGroup(
      group({ settings: { model: { providerId: "p", modelId: "m" }, length: "brief" } }),
    );
    expect(withModel?.settings.model).toEqual({ providerId: "p", modelId: "m" });
    const broken = normalizeDigestGroup(
      group({ settings: { model: { modelId: "m" }, length: "brief" } }),
    );
    expect(broken?.settings.model).toBeNull();
  });

  it("bounds the source and version lists", () => {
    const sources = Array.from({ length: 8 }, (_, i) => ({
      sessionId: `ses_${i}`,
      storyRootId: `root_${i}`,
      title: `故事${i}`,
      turnMessageId: null,
      turnCount: 1,
      omittedTurns: 0,
      chars: 1,
    }));
    const normalized = normalizeDigestGroup(group({ sources }));
    expect(normalized?.sources).toHaveLength(4);
  });

  it("round-trips a live group through structuredClone", () => {
    const live: DigestGroup = {
      id: "digest-2",
      backend: "codex",
      directory: "/demo",
      anchorSessionId: "ses_x",
      anchorMessageId: null,
      createdAt: 1,
      scope: "turn",
      sources: [
        {
          sessionId: "ses_x",
          storyRootId: "ses_root",
          title: "故事",
          turnMessageId: "ses_x:u1",
          turnCount: 1,
          omittedTurns: 2,
          chars: 40,
        },
      ],
      summarySessionId: "ses_sum",
      status: "done",
      text: "正文",
      error: null,
      versions: [],
      settings: { model: null, length: "brief" },
    };
    const restored = normalizeDigestGroup(structuredClone(live));
    expect(restored).toEqual(live);
  });
});
