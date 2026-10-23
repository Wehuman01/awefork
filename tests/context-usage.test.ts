import { describe, expect, it } from "vitest";
import {
  contextUsageOf,
  contextWindowFor,
  latestContextTokens,
  latestContextWindow,
} from "../src/renderer/src/context-usage";
import type { ChatMessage, ModelOption } from "../src/shared/types";

function assistantRow(id: string, contextTokens?: number, contextWindow?: number): ChatMessage {
  return {
    id,
    role: "assistant",
    text: "reply",
    thinking: "",
    toolNames: [],
    modelId: "glm-5.3",
    providerId: "oc",
    variant: null,
    attachmentNames: [],
    createdAt: 1,
    completedAt: 2,
    finish: "stop",
    outputTokens: 10,
    ...(contextTokens === undefined ? {} : { contextTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    error: null,
  };
}

describe("latestContextTokens", () => {
  it("takes the newest assistant row that reported a footprint", () => {
    const messages = [
      assistantRow("a1", 12_000),
      assistantRow("a2"), // backend reported nothing for this step
      assistantRow("a3", 41_000),
    ];
    expect(latestContextTokens(messages)).toBe(41_000);
  });

  it("skips zero/unreported rows and returns null when none reported", () => {
    expect(latestContextTokens([assistantRow("a1", 0), assistantRow("a2")])).toBeNull();
    expect(latestContextTokens([])).toBeNull();
  });
});

describe("latestContextWindow", () => {
  it("reads the window the newest reporting row carried", () => {
    const messages = [assistantRow("a1", 12_000, 200_000), assistantRow("a2", 41_000, 828_400)];
    expect(latestContextWindow(messages)).toBe(828_400);
  });

  it("stops at the newest footprint — an older row's window is another model's", () => {
    // The meter's `used` comes from a3, so a2's window (set while another model
    // was configured) must not leak into the ratio.
    const messages = [
      assistantRow("a1", 12_000, 200_000),
      assistantRow("a2", 41_000, 828_400),
      assistantRow("a3", 50_000),
    ];
    expect(latestContextWindow(messages)).toBeNull();
  });

  it("returns null when no row reported a footprint or a window", () => {
    expect(latestContextWindow([assistantRow("a1", 12_000)])).toBeNull();
    expect(latestContextWindow([])).toBeNull();
    // A user row can never lend a window.
    expect(
      latestContextWindow([{ ...assistantRow("u1"), role: "user", contextWindow: 1_000 }]),
    ).toBeNull();
  });
});

describe("contextWindowFor", () => {
  const models: ModelOption[] = [
    {
      providerId: "oc",
      providerName: "oc",
      modelId: "glm-5.3",
      modelName: "GLM 5.3",
      variants: [],
      attachment: true,
      contextWindow: 200_000,
    },
    {
      providerId: "oc",
      providerName: "oc",
      modelId: "opaque",
      modelName: "Opaque",
      variants: [],
      attachment: true,
      contextWindow: null,
    },
  ];

  it("resolves the window from the catalog", () => {
    expect(contextWindowFor({ providerId: "oc", modelId: "glm-5.3" }, models)).toBe(200_000);
  });

  it("stays null without a choice or when the catalog is silent", () => {
    expect(contextWindowFor(null, models)).toBeNull();
    expect(contextWindowFor({ providerId: "oc", modelId: "opaque" }, models)).toBeNull();
    expect(contextWindowFor({ providerId: "oc", modelId: "missing" }, models)).toBeNull();
  });
});

describe("contextUsageOf", () => {
  it("divides usage by the window and keeps overflow visible", () => {
    expect(contextUsageOf(50_000, 200_000)?.ratio).toBe(0.25);
    expect(contextUsageOf(260_000, 200_000)?.ratio).toBe(1.3);
  });

  it("hides without a reported usage; drops only the ratio without a window", () => {
    expect(contextUsageOf(null, 200_000)).toBeNull();
    const usage = contextUsageOf(50_000, null);
    expect(usage?.used).toBe(50_000);
    expect(usage?.ratio).toBeNull();
  });
});
