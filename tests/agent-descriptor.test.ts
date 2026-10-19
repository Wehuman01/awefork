import { describe, expect, it } from "vitest";
import {
  firstNumber,
  firstString,
  opencodeDescriptor,
  opencodeDescriptors,
  opencodeV2Descriptor,
  opencodeVersionWarning,
  parseOpenCodeDescriptor,
  parseVersion,
  readPath,
  selectOpencodeDescriptor,
  versionInRange,
} from "../src/shared/agent-descriptor";
import bundledJson from "../src/shared/agents/opencode.json";
import bundledV2Json from "../src/shared/agents/opencode-v2.json";

/**
 * The descriptor is the place backend facts live now, so the vocabulary must
 * be closed: every test here pins a rejection the validator owes us, because
 * an unknown key that slips through is a silent behavior change at runtime —
 * the exact failure mode this layer exists to eliminate.
 */

/** Bundled descriptor as editable data, with overrides applied. */
function drifted(edit: (root: Record<string, unknown>) => void): unknown {
  const root = JSON.parse(JSON.stringify(bundledJson)) as Record<string, unknown>;
  edit(root);
  return root;
}

describe("bundled opencode descriptor", () => {
  it("parses and answers the facts the runtime reads", () => {
    const descriptor = opencodeDescriptor();
    expect(descriptor.kind).toBe("opencode");
    expect(descriptor.capabilities).toEqual({
      deleteMessage: true,
      attachments: true,
      compress: true,
    });
    expect(descriptor.endpoints.sessionSummarize).toBe("/session/{id}/summarize");
    expect(descriptor.messages.parts.compaction).toEqual({ type: "compaction" });
    expect(descriptor.fileChanges).toEqual({
      tools: ["edit", "write"],
      stateKeyPath: "state.key",
      filePathPaths: ["state.input.filePath", "filePath"],
      doneStates: ["output-available", "error"],
    });
    expect(descriptor.compat).toEqual({ min: "1.18.0", max: "1.19.0" });
    expect(descriptor.events.partSnapshot.kinds).toEqual({ text: "text", reasoning: "thinking" });
    // v1 rows carry no fork link at all — only subagents ever set a parent,
    // which is why v1 needed no fork/subagent distinction.
    expect(descriptor.sessions.fields.parentSessionId).toEqual(["parentID"]);
    expect(descriptor.sessions.fields.forkSessionId).toEqual([]);
  });

  it("accepts a legitimate variation — the drift scenario this exists for", () => {
    const descriptor = parseOpenCodeDescriptor(
      drifted((root) => {
        (root.events as Record<string, unknown>).idle = ["session.done"];
        (root.endpoints as Record<string, unknown>).sessionMessages = "/session/{id}/messages/v2";
      }),
    );
    expect(descriptor.events.idle).toEqual(["session.done"]);
    expect(descriptor.endpoints.sessionMessages).toBe("/session/{id}/messages/v2");
  });
});

describe("vocabulary enforcement", () => {
  it("rejects an unknown top-level key, naming it", () => {
    expect(() => parseOpenCodeDescriptor(drifted((root) => (root.remote = true)))).toThrow(
      /unknown key\(s\) remote/,
    );
  });

  it("rejects an unknown key deep in a section", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          const text = (root.messages as Record<string, unknown>).parts as Record<string, unknown>;
          (text.text as Record<string, unknown>).seperator = "\n";
        }),
      ),
    ).toThrow(/messages\.parts\.text: unknown key\(s\) seperator/);
  });

  it("rejects a wrong type", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => ((root.compat as Record<string, unknown>).min = 1.18)),
      ),
    ).toThrow(/compat\.min: expected a non-empty string/);
  });

  it("rejects a dot-path that walks into a prototype", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          ((root.messages as Record<string, unknown>).fields as Record<string, unknown>).modelId = [
            "info.__proto__.modelID",
          ];
        }),
      ),
    ).toThrow(/bad path segment "__proto__"/);
  });

  it("rejects an empty candidate list", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          ((root.sessions as Record<string, unknown>).fields as Record<string, unknown>).title = [];
        }),
      ),
    ).toThrow(/sessions\.fields\.title: expected a non-empty array/);
  });

  it("rejects a part-kind mapping to an unknown normalized kind", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          const snapshot = (root.events as Record<string, unknown>).partSnapshot as Record<
            string,
            unknown
          >;
          (snapshot.kinds as Record<string, unknown>).reasoning = "musing";
        }),
      ),
    ).toThrow(/expected "text" or "thinking"/);
  });

  it("rejects an unknown key inside fileChanges", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          (root.fileChanges as Record<string, unknown>).edits = ["edit"];
        }),
      ),
    ).toThrowError(/fileChanges: unknown key\(s\) edits/);
  });

  it("rejects a fileChanges stateKeyPath into a prototype", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          (root.fileChanges as Record<string, unknown>).stateKeyPath = "state.__proto__";
        }),
      ),
    ).toThrowError(/bad path segment/);
  });

  it("accepts a descriptor without the optional fileChanges section", () => {
    const descriptor = parseOpenCodeDescriptor(
      drifted((root) => {
        delete root.fileChanges;
      }),
    );
    expect(descriptor.fileChanges).toBeUndefined();
  });

  it("accepts a descriptor without the optional compaction part", () => {
    const descriptor = parseOpenCodeDescriptor(
      drifted((root) => {
        ((root.messages as Record<string, unknown>).parts as Record<string, unknown>).compaction =
          undefined;
      }),
    );
    expect(descriptor.messages.parts.compaction).toBeUndefined();
  });

  it("rejects an unknown key inside the compaction part", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          const parts = (root.messages as Record<string, unknown>).parts as Record<string, unknown>;
          (parts.compaction as Record<string, unknown>).field = "text";
        }),
      ),
    ).toThrow(/messages\.parts\.compaction: unknown key\(s\) field/);
  });

  it("rejects an unknown fork cut strategy", () => {
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => ((root.fork as Record<string, unknown>).cut = "inclusive")),
      ),
    ).toThrow(/fork\.cut: unknown strategy/);
  });

  it("rejects the wrong backend kind", () => {
    expect(() => parseOpenCodeDescriptor(drifted((root) => (root.kind = "codex")))).toThrow(
      /expected "opencode"/,
    );
  });

  it("rejects a v1 descriptor that dropped its part-streaming sections", () => {
    // The v1 translator is data-driven off those three sections; a v1
    // descriptor without them would translate nothing, silently.
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          delete (root.events as Record<string, unknown>).partSnapshot;
        }),
      ),
    ).toThrow(/protocol v1 requires status, partSnapshot and partDelta/);
  });

  it("accepts a v2 descriptor without the part-streaming sections", () => {
    const descriptor = parseOpenCodeDescriptor(
      JSON.parse(JSON.stringify(bundledV2Json)) as unknown,
    );
    expect(descriptor.protocol).toBe("v2");
    expect(descriptor.events.partSnapshot).toBeUndefined();
  });

  it("rejects an unknown protocol name", () => {
    expect(() => parseOpenCodeDescriptor(drifted((root) => (root.protocol = "v3")))).toThrow(
      /expected "v1" or "v2"/,
    );
  });

  it("rejects an unknown key inside the new optional sections", () => {
    expect(() =>
      parseOpenCodeDescriptor(drifted((root) => (root.auth = { scheme: "basic", token: "x" }))),
    ).toThrow(/auth: unknown key\(s\) token/);
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => ((root.pagination as Record<string, unknown>) = { style: "cursor" })),
      ),
    ).toThrow(/pagination\.limitParam: missing/);
    expect(() =>
      parseOpenCodeDescriptor(
        drifted((root) => {
          (root.pagination as Record<string, unknown>) = {
            style: "cursor",
            limitParam: "limit",
            cursorParam: "cursor",
            nextPath: "cursor.next",
            limit: 200,
            order: "sideways",
          };
        }),
      ),
    ).toThrow(/pagination\.order: expected "asc" or "desc"/);
    expect(() =>
      parseOpenCodeDescriptor(drifted((root) => (root.envelope = { dataKey: "data" }))),
    ).toThrow(/envelope\.bare: expected a non-empty array/);
    expect(() =>
      parseOpenCodeDescriptor(drifted((root) => (root.prompt = { style: "text" }))),
    ).toThrow(/prompt\./);
  });

  it("defaults the v1 prompt/fork facts when the sections are absent", () => {
    const descriptor = opencodeDescriptor();
    expect(descriptor.protocol).toBe("v1");
    expect(descriptor.fork.cutParam).toBe("messageID");
    expect(descriptor.prompt).toBeUndefined();
    expect(descriptor.sessions.create).toBeUndefined();
    expect(descriptor.messages.partsPath).toBeUndefined();
    expect(descriptor.messages.textPath).toBeUndefined();
  });
});

describe("read helpers", () => {
  const row = {
    info: { id: "m1", modelID: "top", model: { modelID: "nested" }, variant: "" },
  };

  it("readPath walks dot-paths and stops at missing objects", () => {
    expect(readPath(row, "info.model.modelID")).toBe("nested");
    expect(readPath(row, "info.gone.modelID")).toBeUndefined();
    expect(readPath(null, "info")).toBeUndefined();
  });

  it("firstString takes the first non-empty candidate and skips blanks", () => {
    expect(firstString(row, ["info.modelID", "info.model.modelID"])).toBe("top");
    expect(firstString(row, ["info.variant", "info.model.modelID"])).toBe("nested");
    expect(firstString(row, ["info.nope"])).toBeNull();
  });

  it("firstNumber only accepts numbers", () => {
    expect(firstNumber({ c: "4", a: { b: 3 } }, ["c", "a.b"])).toBe(3);
    expect(firstNumber({ c: "4" }, ["c"])).toBeNull();
  });
});

describe("version probe helpers", () => {
  it("parses the first triple from CLI output", () => {
    expect(parseVersion("1.18.30")).toBe("1.18.30");
    expect(parseVersion("codex-cli 0.154.0\n")).toBe("0.154.0");
    expect(parseVersion("opencode 1.19.0 (abc+) extra 2.0")).toBe("1.19.0");
    expect(parseVersion("no digits here")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("treats compat as min-inclusive, max-exclusive", () => {
    const compat = { min: "1.18.0", max: "1.19.0" };
    expect(versionInRange("1.18.0", compat)).toBe(true);
    expect(versionInRange("1.18.30", compat)).toBe(true);
    expect(versionInRange("1.18", compat)).toBe(true); // missing patch counts as .0
    expect(versionInRange("1.17.9", compat)).toBe(false);
    expect(versionInRange("1.19.0", compat)).toBe(false);
    expect(versionInRange("2.0.0", compat)).toBe(false);
  });
});

describe("bundled v2 descriptor", () => {
  it("parses and carries the /api protocol's facts", () => {
    const descriptor = opencodeV2Descriptor();
    expect(descriptor.protocol).toBe("v2");
    expect(descriptor.compat).toEqual({ min: "2.0.0", max: "2.1.0" });
    // v2 dropped single-message delete; the renderer must not offer it.
    expect(descriptor.capabilities.deleteMessage).toBe(false);
    expect(descriptor.auth).toEqual({ scheme: "basic", username: "opencode" });
    expect(descriptor.envelope).toEqual({ dataKey: "data", bare: ["projects"] });
    // Every timeline is consumed oldest-first; the first page asks for it and
    // the cursor carries the order onward.
    expect(descriptor.pagination?.order).toBe("asc");
    // Attachments ride the data URL as the prompt file's uri.
    expect(descriptor.prompt?.fileEncoding).toBe("data-url-uri");
    expect(descriptor.fork).toEqual({ cut: "next-user-exclusive", cutParam: "before" });
    expect(descriptor.endpoints.sessionPrompt).toBe("/api/session/{id}/prompt");
    expect(descriptor.endpoints.sessionModel).toBe("/api/session/{id}/model");
    expect(descriptor.endpoints.sessionAbort).toBe("/api/session/{id}/interrupt");
    expect(descriptor.endpoints.sessionSummarize).toBe("/api/session/{id}/compact");
    expect(descriptor.sessions.fields.directory).toEqual(["location.directory"]);
    // v2 split the two parent relationships: a subagent parent and a fork
    // parent. Reading both as one turned every fork into a hidden subagent.
    expect(descriptor.sessions.fields.parentSessionId).toEqual(["parentID"]);
    expect(descriptor.sessions.fields.forkSessionId).toEqual(["fork.sessionID"]);
    expect(descriptor.messages.partsPath).toBe("content");
    expect(descriptor.messages.textPath).toEqual(["text"]);
    expect(descriptor.messages.parts.tool.nameField).toBe("name");
    expect(descriptor.messages.parts.compaction).toEqual({
      type: "compaction",
      rowTypeField: "type",
    });
    expect(descriptor.fileChanges).toEqual({
      tools: ["edit", "write"],
      filePathPaths: ["input.path", "input.filePath"],
      doneStates: ["completed", "error"],
    });
    // v2 replaced the streaming family, so the v1 part sections are absent.
    expect(descriptor.events.status).toBeUndefined();
    expect(descriptor.events.partSnapshot).toBeUndefined();
    expect(descriptor.events.partDelta).toBeUndefined();
    expect(descriptor.events.idle).toContain("session.execution.succeeded");
  });

  it("omits a stateKeyPath — v2's tool events name the state outright", () => {
    expect(opencodeV2Descriptor().fileChanges?.stateKeyPath).toBeUndefined();
  });

  it("carries the form ask facts and its reply/cancel endpoints", () => {
    const descriptor = opencodeV2Descriptor();
    expect(descriptor.events.form).toEqual({
      created: "form.created",
      replied: "form.replied",
      cancelled: "form.cancelled",
      idPath: "form.id",
      sessionIdPath: "form.sessionID",
      titlePath: "form.title",
      fieldsPath: "form.fields",
      replyIdPath: "id",
      replySessionIdPath: "sessionID",
    });
    expect(descriptor.endpoints.sessionFormReply).toBe("/api/session/{id}/form/{formId}/reply");
    expect(descriptor.endpoints.sessionFormCancel).toBe("/api/session/{id}/form/{formId}");
    // The form's session id lives under `form.sessionID`, which the shared
    // sessionIdPaths do not cover — the fact carries its own path.
    expect(descriptor.events.sessionIdPaths).not.toContain("form.sessionID");
  });

  it("accepts a descriptor without the optional form section", () => {
    const raw = JSON.parse(JSON.stringify(bundledV2Json)) as Record<string, unknown>;
    delete (raw.events as Record<string, unknown>).form;
    expect(parseOpenCodeDescriptor(raw).events.form).toBeUndefined();
  });

  it("rejects an unknown key inside the form section", () => {
    const raw = JSON.parse(JSON.stringify(bundledV2Json)) as Record<string, unknown>;
    ((raw.events as Record<string, unknown>).form as Record<string, unknown>).titelPath =
      "form.title";
    expect(() => parseOpenCodeDescriptor(raw)).toThrow(/events\.form.*titelPath/);
  });
});

describe("protocol selection", () => {
  it("picks each protocol's descriptor for a version inside its range", () => {
    expect(selectOpencodeDescriptor("1.18.30").protocol).toBe("v1");
    expect(selectOpencodeDescriptor("2.0.26").protocol).toBe("v2");
    expect(selectOpencodeDescriptor("2.0.0").protocol).toBe("v2");
  });

  it("falls back to the closest known protocol for an untested version", () => {
    // A future release is more likely to still speak the newer API.
    expect(selectOpencodeDescriptor("2.5.0").protocol).toBe("v2");
    expect(selectOpencodeDescriptor("3.0.0").protocol).toBe("v2");
    // An old build below every floor gets the historical protocol.
    expect(selectOpencodeDescriptor("1.17.0").protocol).toBe("v1");
    // A gap between ranges (1.19.x) is still the v1 API line.
    expect(selectOpencodeDescriptor("1.19.5").protocol).toBe("v1");
  });

  it("keeps the v1 default when the probe read no version", () => {
    expect(selectOpencodeDescriptor(null).protocol).toBe("v1");
  });

  it("ships both descriptors, oldest first", () => {
    expect(opencodeDescriptors().map((d) => d.protocol)).toEqual(["v1", "v2"]);
  });
});

describe("version warning", () => {
  it("stays silent for versions inside either tested range", () => {
    expect(opencodeVersionWarning("1.18.30")).toBeNull();
    expect(opencodeVersionWarning("2.0.26")).toBeNull();
  });

  it("names every tested range for a version outside them", () => {
    const warning = opencodeVersionWarning("2.5.0");
    expect(warning).toContain("2.5.0");
    expect(warning).toContain("≥1.18.0，<1.19.0");
    expect(warning).toContain("≥2.0.0，<2.1.0");
  });

  it("stays silent when the probe could not read a version", () => {
    expect(opencodeVersionWarning(null)).toBeNull();
  });
});
