import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AweforkApi } from "../src/shared/awefork-api";
import type { BackendId } from "../src/shared/backend";
import type { PromptAttachment } from "../src/shared/types";

/**
 * Attachment preview: a sent chip's bytes come from the send-time copy first
 * and the backend's own round-trip second, and neither having them is an
 * honest "cannot preview" rather than an empty box.
 */

const IMAGE = (name: string, tag = "png"): PromptAttachment => ({
  mime: "image/png",
  filename: name,
  dataUrl: `data:image/png;base64,${tag}`,
});

const TEXT: PromptAttachment = {
  mime: "text/plain",
  filename: "notes.md",
  dataUrl: "data:text/plain;base64,bm90ZXM=",
};

let messageAttachments: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  messageAttachments = vi.fn(async () => [] as PromptAttachment[]);
  (globalThis as { window?: { awefork: Partial<AweforkApi> } }).window = {
    awefork: { messageAttachments } as unknown as Partial<AweforkApi>,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function loadModule(): Promise<typeof import("../src/renderer/src/attachment-preview")> {
  return import("../src/renderer/src/attachment-preview");
}

describe("rememberSentAttachments", () => {
  it("previews the just-sent image without touching the backend", async () => {
    const mod = await loadModule();
    mod.rememberSentAttachments("opencode", "s1", [IMAGE("shot.png")]);

    const fetched = vi.fn(async () => [] as PromptAttachment[]);
    messageAttachments.mockImplementation(fetched);

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["shot.png"],
      index: 0,
    });

    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,png");
    expect(mod.attachmentPreview.error).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("does not lend one image's bytes to a shifted chip", async () => {
    const mod = await loadModule();
    mod.rememberSentAttachments("opencode", "s1", [IMAGE("a.png", "a")]);

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["a.png", "b.png"],
      index: 1,
    });

    expect(mod.attachmentPreview.dataUrl).toBeNull();
    expect(mod.attachmentPreview.error).not.toBeNull();
  });

  it("keeps one entry per session and drops the least recently sent", async () => {
    const mod = await loadModule();
    mod.rememberSentAttachments("opencode", "s1", [IMAGE("one.png", "1")]);
    mod.rememberSentAttachments("opencode", "s2", [IMAGE("two.png", "2")]);
    // A repeat send refreshes the entry rather than appending a second one.
    mod.rememberSentAttachments("opencode", "s1", [IMAGE("three.png", "3")]);

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["three.png"],
      index: 0,
    });
    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,3");

    messageAttachments.mockImplementation(async () => []);
    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s2",
      messageId: "m1",
      names: ["two.png"],
      index: 0,
    });
    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,2");
  });

  it("drops the least recently sent session past the cap", async () => {
    const mod = await loadModule();
    const sessions = Array.from({ length: 17 }, (_, i) => `s${i}`);
    for (const sessionId of sessions) {
      mod.rememberSentAttachments("opencode", sessionId, [IMAGE("a.png", sessionId)]);
    }
    messageAttachments.mockImplementation(async () => []);

    // s0 was sent first and never again: past the cap it falls back to the
    // backend (which keeps nothing here) instead of previewing stale bytes.
    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s0",
      messageId: "m1",
      names: ["a.png"],
      index: 0,
    });
    expect(mod.attachmentPreview.dataUrl).toBeNull();
    expect(mod.attachmentPreview.error).not.toBeNull();

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s16",
      messageId: "m1",
      names: ["a.png"],
      index: 0,
    });
    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,s16");
  });

  it("separates backends for the same session id", async () => {
    const mod = await loadModule();
    mod.rememberSentAttachments("codex", "s1", [IMAGE("c.png", "codex")]);

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["c.png"],
      index: 0,
    });

    expect(mod.attachmentPreview.dataUrl).toBeNull();
  });
});

describe("previewSentAttachment", () => {
  it("fetches the bytes the backend kept when there is no send-time copy", async () => {
    const mod = await loadModule();
    messageAttachments.mockImplementation(async () => [TEXT, IMAGE("old.png", "old")]);

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["notes.md", "old.png"],
      index: 1,
    });

    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,old");
    expect(mod.attachmentPreview.loading).toBe(false);
  });

  it("says so when the backend kept no bytes for that chip", async () => {
    const mod = await loadModule();
    messageAttachments.mockImplementation(async () => [] as PromptAttachment[]);

    await mod.previewSentAttachment({
      backend: "codex",
      sessionId: "c1",
      messageId: "m1",
      names: ["gone.png"],
      index: 0,
    });

    expect(mod.attachmentPreview.open).toBe(true);
    expect(mod.attachmentPreview.dataUrl).toBeNull();
    expect(mod.attachmentPreview.error).not.toBeNull();
    expect(mod.attachmentPreview.loading).toBe(false);
  });

  it("does not preview a non-image attachment the backend did keep", async () => {
    const mod = await loadModule();
    messageAttachments.mockImplementation(async () => [TEXT]);

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["notes.md"],
      index: 0,
    });

    expect(mod.attachmentPreview.dataUrl).toBeNull();
    expect(mod.attachmentPreview.error).not.toBeNull();
  });

  it("surfaces a failed fetch as the notice, not a crash", async () => {
    const mod = await loadModule();
    messageAttachments.mockImplementation(async () => {
      throw new Error("adapter gone");
    });

    await mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["x.png"],
      index: 0,
    });

    expect(mod.attachmentPreview.error).not.toBeNull();
  });

  it("lets a newer click win over an in-flight fetch", async () => {
    const mod = await loadModule();
    let releaseFirst: (value: PromptAttachment[]) => void = () => {};
    messageAttachments.mockImplementationOnce(
      () =>
        new Promise<PromptAttachment[]>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    messageAttachments.mockImplementationOnce(async () => [IMAGE("second.png", "2")]);

    const first = mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m1",
      names: ["first.png"],
      index: 0,
    });
    const second = mod.previewSentAttachment({
      backend: "opencode",
      sessionId: "s1",
      messageId: "m2",
      names: ["second.png"],
      index: 0,
    });
    await second;
    // The slow first reply lands after the newer click; it must not overwrite.
    releaseFirst([IMAGE("first.png", "1")]);
    await first;

    expect(mod.attachmentPreview.name).toBe("second.png");
    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,2");
  });
});

describe("openLocalAttachmentPreview", () => {
  it("shows a composer chip's own bytes with no fetch", async () => {
    const mod = await loadModule();
    mod.openLocalAttachmentPreview("draft.png", "data:image/png;base64,draft");

    expect(mod.attachmentPreview.open).toBe(true);
    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,draft");
    expect(messageAttachments).not.toHaveBeenCalled();
  });
});

describe("closeAttachmentPreview", () => {
  it("clears the overlay so a reopened chip starts clean", async () => {
    const mod = await loadModule();
    mod.openLocalAttachmentPreview("a.png", "data:image/png;base64,a");
    mod.closeAttachmentPreview();

    expect(mod.attachmentPreview.open).toBe(false);
    expect(mod.attachmentPreview.dataUrl).toBeNull();
    expect(mod.attachmentPreview.error).toBeNull();
  });
});

describe("backend ids", () => {
  it("accepts every backend the app ships", async () => {
    const mod = await loadModule();
    for (const backend of ["opencode", "codex", "claude", "pi", "zcode"] as BackendId[]) {
      mod.rememberSentAttachments(backend, "s1", [IMAGE("b.png", backend)]);
    }
    await mod.previewSentAttachment({
      backend: "zcode",
      sessionId: "s1",
      messageId: "m1",
      names: ["b.png"],
      index: 0,
    });
    expect(mod.attachmentPreview.dataUrl).toBe("data:image/png;base64,zcode");
  });
});
