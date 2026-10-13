import { describe, expect, it, vi } from "vitest";
import { opencodeV2Descriptor } from "../src/shared/agent-descriptor";
import type { ToolPartFrame } from "../src/shared/file-change-recorder";
import { createV2EventTranslator, type V2Frame } from "../src/shared/opencode-v2-events";
import type { AgentEvent } from "../src/shared/types";

/**
 * The v2 streaming family, verified frame-for-frame against a real
 * opencode 2.0.26 run: a live run emits execution/step/text/reasoning/tool
 * frames and NEVER the v1 part-level frames (no session.status, no
 * session.idle, no message.part.updated/delta). These tests pin that mapping.
 */

function setup(): {
  translate: (frame: V2Frame) => void;
  events: AgentEvent[];
  toolFrames: ToolPartFrame[];
} {
  const events: AgentEvent[] = [];
  const toolFrames: ToolPartFrame[] = [];
  const translate = createV2EventTranslator({
    descriptor: opencodeV2Descriptor(),
    emit: (event) => events.push(event),
    recordToolFrame: (_sessionId, frame) => toolFrames.push(frame),
  });
  return { translate, events, toolFrames };
}

const frame = (type: string, data: Record<string, unknown>, created = 1000): V2Frame => ({
  type,
  properties: data,
  created,
});

const SESSION = "ses_1";
const MESSAGE = "msg_1";

describe("v2 run lifecycle", () => {
  it("starts a run on execution.started and settles it on succeeded", () => {
    const { translate, events } = setup();
    translate(frame("session.execution.started", { sessionID: SESSION }));
    translate(frame("session.execution.succeeded", { sessionID: SESSION }));
    expect(events).toEqual([
      { type: "message.started", sessionId: SESSION, messageId: "" },
      { type: "session.idle", sessionId: SESSION },
    ]);
  });

  it("settles an interrupted run without an error", () => {
    const { translate, events } = setup();
    translate(frame("session.execution.interrupted", { sessionID: SESSION }));
    expect(events).toEqual([{ type: "session.idle", sessionId: SESSION }]);
  });

  it("surfaces a failed run as an error, then still settles it", () => {
    const { translate, events } = setup();
    translate(
      frame("session.execution.failed", {
        sessionID: SESSION,
        error: { type: "provider.auth", message: "consumer key required" },
      }),
    );
    expect(events).toEqual([
      {
        type: "server.error",
        sessionId: SESSION,
        message: `${SESSION}: consumer key required`,
      },
      { type: "session.idle", sessionId: SESSION },
    ]);
  });

  it("maps session.error frames with the descriptor's detail paths", () => {
    const { translate, events } = setup();
    translate(frame("session.error", { sessionID: SESSION, error: { message: "boom" } }));
    expect(events).toEqual([
      { type: "server.error", sessionId: SESSION, message: `${SESSION}: boom` },
    ]);
  });
});

describe("v2 text and reasoning streams", () => {
  it("streams text as snapshot → delta → snapshot, one part per ordinal", () => {
    const { translate, events } = setup();
    translate(
      frame(
        "session.text.started",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0 },
        100,
      ),
    );
    translate(
      frame(
        "session.text.delta",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0, delta: "po" },
        101,
      ),
    );
    translate(
      frame(
        "session.text.delta",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0, delta: "ng" },
        102,
      ),
    );
    translate(
      frame(
        "session.text.ended",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0, text: "pong" },
        103,
      ),
    );

    expect(events).toEqual([
      {
        type: "message.part",
        sessionId: SESSION,
        messageId: MESSAGE,
        partId: "text:msg_1#0",
        kind: "text",
        text: "",
        startedAt: null,
        endedAt: null,
      },
      {
        type: "message.delta",
        sessionId: SESSION,
        messageId: MESSAGE,
        partId: "text:msg_1#0",
        kind: "text",
        delta: "po",
      },
      {
        type: "message.delta",
        sessionId: SESSION,
        messageId: MESSAGE,
        partId: "text:msg_1#0",
        kind: "text",
        delta: "ng",
      },
      {
        type: "message.part",
        sessionId: SESSION,
        messageId: MESSAGE,
        partId: "text:msg_1#0",
        kind: "text",
        text: "pong",
        startedAt: null,
        endedAt: 103,
      },
    ]);
  });

  it("streams reasoning as thinking, with a distinct part id per kind", () => {
    const { translate, events } = setup();
    translate(
      frame(
        "session.reasoning.started",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0 },
        200,
      ),
    );
    translate(
      frame(
        "session.reasoning.delta",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0, delta: "hmm" },
        201,
      ),
    );
    translate(
      frame(
        "session.reasoning.ended",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0, text: "hmm." },
        202,
      ),
    );
    // The same ordinal in a text stream is a DIFFERENT part — the ids must not collide.
    translate(
      frame(
        "session.text.started",
        { sessionID: SESSION, assistantMessageID: MESSAGE, ordinal: 0 },
        203,
      ),
    );

    const partIds = events.filter((e) => e.type === "message.part").map((e) => e.partId);
    expect(partIds).toEqual(["thinking:msg_1#0", "thinking:msg_1#0", "text:msg_1#0"]);
    expect(events.find((e) => e.type === "message.delta")).toMatchObject({
      kind: "thinking",
      delta: "hmm",
    });
  });

  it("drops frames that name no session or message", () => {
    const { translate, events } = setup();
    translate(frame("session.text.delta", { ordinal: 0, delta: "lost" }));
    translate(frame("session.text.delta", { sessionID: SESSION, ordinal: 0, delta: "lost" }));
    expect(events).toEqual([]);
  });
});

describe("v2 tool lifecycle feeds the file-change recorder", () => {
  it("records running at tool.called with the parsed input's path", () => {
    const { translate, toolFrames } = setup();
    translate(
      frame("session.tool.called", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_1",
        name: "edit",
        input: { path: "/tmp/probe.md", oldString: "a", newString: "b" },
        executed: false,
      }),
    );
    expect(toolFrames).toEqual([
      {
        sessionId: SESSION,
        messageId: MESSAGE,
        partId: "call_1",
        tool: "edit",
        filePath: "/tmp/probe.md",
        stateKey: "running",
      },
    ]);
  });

  it("carries the path from called through to success and failed", () => {
    const { translate, toolFrames } = setup();
    const call = frame("session.tool.called", {
      sessionID: SESSION,
      assistantMessageID: MESSAGE,
      id: "call_1",
      name: "edit",
      input: { path: "/tmp/probe.md" },
    });
    const success = frame("session.tool.success", {
      sessionID: SESSION,
      assistantMessageID: MESSAGE,
      id: "call_1",
      content: [{ type: "text", text: "Edited" }],
    });
    translate(call);
    translate(success);
    expect(toolFrames.map((f) => f.stateKey)).toEqual(["running", "completed"]);
    expect(toolFrames.every((f) => f.filePath === "/tmp/probe.md")).toBe(true);
    expect(toolFrames.every((f) => f.tool === "edit")).toBe(true);
  });

  it("records a failed tool as terminal too", () => {
    const { translate, toolFrames } = setup();
    translate(
      frame("session.tool.called", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_2",
        name: "write",
        input: { path: "/tmp/new.md" },
      }),
    );
    translate(
      frame("session.tool.failed", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_2",
        error: { message: "denied" },
      }),
    );
    expect(toolFrames.map((f) => f.stateKey)).toEqual(["running", "error"]);
  });

  it("ignores input streaming frames — the parsed input arrives at called", () => {
    const { translate, toolFrames } = setup();
    translate(
      frame("session.tool.input.started", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_3",
        name: "read",
      }),
    );
    translate(
      frame("session.tool.input.ended", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_3",
        text: '{"path":"/x"}',
      }),
    );
    expect(toolFrames).toEqual([]);
  });

  it("forgets a session's tool state once its run settles", () => {
    const { translate, toolFrames } = setup();
    translate(
      frame("session.tool.called", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_4",
        name: "edit",
        input: { path: "/tmp/a.md" },
      }),
    );
    translate(frame("session.execution.succeeded", { sessionID: SESSION }));
    // A late success frame for the settled run records nothing new to remember.
    const before = toolFrames.length;
    translate(
      frame("session.tool.success", {
        sessionID: SESSION,
        assistantMessageID: MESSAGE,
        id: "call_4",
      }),
    );
    expect(toolFrames.length).toBe(before + 1);
    expect(toolFrames[before]?.stateKey).toBe("completed");
    expect(toolFrames[before]?.filePath).toBeNull();
  });
});

describe("v2 refresh and ignore sets", () => {
  it("refreshes on session and message rows", () => {
    const { translate, events } = setup();
    for (const type of [
      "session.created",
      "session.updated",
      "session.renamed",
      "session.compacted",
      "message.updated",
    ]) {
      translate(frame(type, { sessionID: SESSION }));
    }
    expect(events).toEqual(Array(5).fill({ type: "session.updated", sessionId: SESSION }));
  });

  it("says nothing for the frames the descriptor lists as noise", () => {
    const { translate, events, toolFrames } = setup();
    for (const type of [
      "session.inbox.enqueued",
      "session.inbox.delivered",
      "session.step.started",
      "session.step.streamed",
      "session.step.ended",
      "session.usage.updated",
      "session.model.selected",
      "session.instructions.updated",
      "project.updated",
      "mcp.status.changed",
      "server.connected",
      // A failed STEP is not the run's failure — execution.failed carries it.
      "session.step.failed",
    ]) {
      translate(frame(type, { sessionID: SESSION }));
    }
    expect(events).toEqual([]);
    expect(toolFrames).toEqual([]);
  });
});
