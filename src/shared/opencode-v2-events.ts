/**
 * The v2 event-family translator. opencode v2 kept the frame names awefork
 * already knew (`session.updated`, `session.error`, …) but replaced the
 * streaming wire family entirely: a live run no longer emits
 * `session.status`/`session.idle`/`message.part.updated`/`message.part.delta`
 * (verified against a real 2.0.26 run — none of them fire). It emits
 *
 *  - `session.execution.started|succeeded|failed|interrupted` — the run
 *  - `session.step.started|streamed|ended|failed` — one model step
 *  - `session.text.started|delta|ended` and `session.reasoning.*` — streams
 *    addressed by (assistantMessageID, ordinal)
 *  - `session.tool.input.started|ended`, `session.tool.called|progress|
 *    success|failed` — the tool lifecycle, tools addressed by call id
 *
 * This module maps that family onto the same normalized `AgentEvent` feed the
 * v1 translator produces, so the renderer, the run watchdog and the
 * file-change recorder all behave identically. Text/reasoning parts get a
 * synthesized partId (`kind:messageId#ordinal`) because v2 has no part ids on
 * the wire; tool frames carry the path `session.tool.called` parsed for us.
 */

import { firstString, type OpenCodeDescriptor, readPath } from "./agent-descriptor.js";
import type { ToolPartFrame } from "./file-change-recorder.js";
import { subagentCallOf } from "./subagent-task.js";
import type { AgentEvent, SubagentCall } from "./types.js";

/** One SSE frame as the shared parser normalized it. */
export interface V2Frame {
  type: string;
  properties: Record<string, unknown>;
  created: number | null;
}

/** One `permission.asked` frame, normalized off the descriptor's paths. */
export interface V2PermissionAskFrame {
  sessionId: string;
  requestId: string;
  permission: string;
  tool: string | null;
  patterns: string[];
  /** The gated tool call's id, when the frame names one under `source`. */
  callId: string | null;
}

/** One `form.created` frame, normalized off the descriptor's paths. */
export interface V2FormAskFrame {
  sessionId: string;
  formId: string;
  title: string;
  /** The raw `form.fields` array; the adapter narrows each field's type. */
  fields: unknown[];
}

/** One `form.replied` / `form.cancelled` frame — the form settled elsewhere. */
export interface V2FormSettledFrame {
  sessionId: string | null;
  formId: string;
}

export interface V2EventDeps {
  descriptor: OpenCodeDescriptor;
  emit: (event: AgentEvent) => void;
  /** Feed one tool frame to the session's file-change recorder. */
  recordToolFrame: (sessionId: string, frame: ToolPartFrame) => void;
  /** Surface a permission ask as an answerable interaction. */
  onPermissionAsk?: (frame: V2PermissionAskFrame) => void;
  /** Surface a form ask as an answerable interaction. */
  onFormAsk?: (frame: V2FormAskFrame) => void;
  /** A form settled elsewhere (TUI answered it, or it was cancelled). */
  onFormSettled?: (frame: V2FormSettledFrame) => void;
  /** Track a tool call's name + parsed input for the ask's command correlation. */
  onToolCalled?: (sessionId: string, tool: string, input: unknown, callId: string | null) => void;
}

/**
 * Run-lifecycle frames with no descriptor home of their own: the frames that
 * settle a run and the error frame ride the descriptor's `idle` / `error`
 * lists, like every other event name here.
 */
const EXECUTION_FAILED = "session.execution.failed";
const EXECUTION_STARTED = "session.execution.started";

/** Per-call tool state remembered between the called and success/failed frames. */
interface ToolCall {
  messageId: string;
  tool: string;
  filePath: string | null;
  input: unknown;
  createdAt: number | null;
}

/**
 * Translate one v2 frame. Tool state is kept across frames (a `tool.success`
 * carries no input, so the path learned at `tool.called` is what the recorder
 * needs), pruned per session when its run settles.
 */
export function createV2EventTranslator(deps: V2EventDeps): (frame: V2Frame) => void {
  const { descriptor, emit } = deps;
  const { events } = descriptor;
  const toolCalls = new Map<string, ToolCall>();

  const sessionId = (props: Record<string, unknown>): string | null =>
    firstString(props, events.sessionIdPaths);
  const messageId = (props: Record<string, unknown>): string | null =>
    firstString(props, events.messageIdPaths);

  /** (assistantMessageID, ordinal) → the renderer's opaque partId. */
  const partId = (kind: "text" | "thinking", id: string, ordinal: unknown): string =>
    `${kind}:${id}#${typeof ordinal === "number" ? ordinal : 0}`;

  const emitPart = (
    props: Record<string, unknown>,
    kind: "text" | "thinking",
    text: string,
    ended: boolean,
    frameCreated: number | null,
  ): void => {
    const id = sessionId(props);
    const message = messageId(props);
    if (!id || !message) return;
    emit({
      type: "message.part",
      sessionId: id,
      messageId: message,
      partId: partId(kind, message, props.ordinal),
      kind,
      text,
      startedAt: null,
      endedAt: ended ? frameCreated : null,
    });
  };

  const emitDelta = (
    props: Record<string, unknown>,
    kind: "text" | "thinking",
    delta: unknown,
  ): void => {
    if (typeof delta !== "string" || delta === "") return;
    const id = sessionId(props);
    const message = messageId(props);
    if (!id || !message) return;
    emit({
      type: "message.delta",
      sessionId: id,
      messageId: message,
      partId: partId(kind, message, props.ordinal),
      kind,
      delta,
    });
  };

  const emitError = (props: Record<string, unknown>, session: string | null): void => {
    const detail = firstString(props, events.error.detailPaths);
    const message = detail ?? JSON.stringify(props.error ?? "unknown error");
    emit({
      type: "server.error",
      sessionId: session,
      message: session ? `${session}: ${message}` : message,
    });
  };

  /** One tool lifecycle frame → one recorder frame, when it names a tracked file. */
  const recordTool = (
    props: Record<string, unknown>,
    stateKey: "running" | "completed" | "error",
    remembered: ToolCall | undefined,
    frameCreated: number | null,
  ): void => {
    const fact = descriptor.fileChanges;
    const id = sessionId(props);
    const callId = typeof props.id === "string" ? props.id : null;
    if (!fact || !id || !callId) return;
    const tool = typeof props.name === "string" ? props.name : (remembered?.tool ?? "");
    // `session.tool.called` carries the parsed input; later frames do not, so
    // the path learned there is what later states report against.
    const filePath =
      (stateKey === "running" ? firstString(props, fact.filePathPaths) : null) ??
      remembered?.filePath ??
      null;
    const message = messageId(props) ?? remembered?.messageId ?? "";
    const rememberedInput = stateKey === "running" ? props.input : remembered?.input;
    const createdAt = stateKey === "running" ? frameCreated : (remembered?.createdAt ?? null);
    if (stateKey === "running") {
      toolCalls.set(`${id}\u0000${callId}`, {
        messageId: message,
        tool,
        filePath,
        input: rememberedInput,
        createdAt,
      });
    }
    deps.recordToolFrame(id, {
      sessionId: id,
      messageId: message,
      partId: callId,
      tool,
      filePath,
      stateKey,
    });
  };

  /** Build a v1-shaped task part so the shared descriptor mapper can read it. */
  const taskSnapshotOf = (
    props: Record<string, unknown>,
    stateKey: "running" | "completed" | "error",
    remembered: ToolCall | undefined,
    input: unknown,
    createdAt: number | null,
    frameCreated: number | null,
    tool: string,
  ): unknown => {
    const content = props.content;
    const outputs = Array.isArray(content)
      ? content.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && "text" in item,
        )
      : [];
    return {
      id: typeof props.id === "string" ? props.id : null,
      name: tool,
      state: {
        status: stateKey,
        input: stateKey === "running" ? input : remembered?.input,
        output: outputs.map((item) => item.text).join("\n"),
        error: readPath(props, "error"),
        metadata: readPath(props, "metadata"),
        time: { created: createdAt, completed: frameCreated },
      },
    };
  };

  const emitTask = (
    props: Record<string, unknown>,
    stateKey: "running" | "completed" | "error",
    remembered: ToolCall | undefined,
    frameCreated: number | null,
  ): SubagentCall | null => {
    const fact = descriptor.messages.parts.tool.task;
    const id = sessionId(props);
    const message = messageId(props) ?? remembered?.messageId;
    const callId = typeof props.id === "string" ? props.id : null;
    const tool = typeof props.name === "string" ? props.name : (remembered?.tool ?? "");
    if (!fact || !id || !message || !callId || tool !== fact.name) return null;
    const input = stateKey === "running" ? props.input : remembered?.input;
    const createdAt = stateKey === "running" ? frameCreated : (remembered?.createdAt ?? null);
    const raw = taskSnapshotOf(props, stateKey, remembered, input, createdAt, frameCreated, tool);
    const call = subagentCallOf(raw, callId, tool, fact);
    if (!call) return null;
    emit({ type: "message.toolCall", sessionId: id, messageId: message, partId: callId, call });
    return call;
  };

  const dropSessionTools = (session: string): void => {
    const prefix = `${session}\u0000`;
    for (const key of toolCalls.keys()) {
      if (key.startsWith(prefix)) toolCalls.delete(key);
    }
  };

  return (frame) => {
    const props = frame.properties;
    const id = sessionId(props);

    if (events.refresh.includes(frame.type)) {
      if (id) emit({ type: "session.updated", sessionId: id });
      return;
    }
    if (events.ignore.includes(frame.type)) return;
    // The descriptor names the frames that settle a run (execution.succeeded
    // / .interrupted), exactly as v1's `idle` list does — one spelling, read
    // from data like every other event name here.
    if (events.idle.includes(frame.type)) {
      if (id) {
        dropSessionTools(id);
        emit({ type: "session.idle", sessionId: id });
      }
      return;
    }

    // v2 kept the ask frame's name and payload shape; the reply moved to
    // POST /api/session/{id}/permission/{requestId}/reply (descriptor data).
    const ask = events.permissionAsk;
    if (ask && frame.type === ask.name) {
      const requestId = firstString(props, [ask.idPath]);
      if (id && requestId && deps.onPermissionAsk) {
        const rawPatterns = readPath(props, ask.patternsPath);
        deps.onPermissionAsk({
          sessionId: id,
          requestId,
          permission: firstString(props, [ask.permissionPath]) ?? "",
          tool: firstString(props, [ask.toolPath]) ?? null,
          patterns: Array.isArray(rawPatterns)
            ? rawPatterns.filter((p): p is string => typeof p === "string" && p !== "")
            : [],
          callId: firstString(props, ask.sourceIdPaths ?? []),
        });
      }
      return;
    }

    // A form ask is the typed sibling of a permission ask: the fields ride
    // `form.fields`, the owning session under `form.sessionID` (which is not
    // in sessionIdPaths — hence the descriptor's own sessionIdPath). Its
    // settlement frames (`form.replied`/`form.cancelled`) name the id at the
    // frame root, not under `form`.
    const form = events.form;
    if (form) {
      if (frame.type === form.created) {
        const formId = firstString(props, [form.idPath]);
        const session = firstString(props, [form.sessionIdPath]);
        const rawFields = readPath(props, form.fieldsPath);
        if (formId && session && deps.onFormAsk) {
          deps.onFormAsk({
            sessionId: session,
            formId,
            title: firstString(props, [form.titlePath]) ?? "opencode.formTitleFallback",
            fields: Array.isArray(rawFields) ? rawFields : [],
          });
        }
        return;
      }
      if (frame.type === form.replied || frame.type === form.cancelled) {
        const formId = firstString(props, [form.replyIdPath]);
        if (formId && deps.onFormSettled) {
          deps.onFormSettled({
            sessionId: firstString(props, [form.replySessionIdPath]),
            formId,
          });
        }
        return;
      }
    }

    switch (frame.type) {
      case EXECUTION_STARTED:
        if (id) emit({ type: "message.started", sessionId: id, messageId: "" });
        return;
      case EXECUTION_FAILED:
        emitError(props, id);
        if (id) {
          dropSessionTools(id);
          emit({ type: "session.idle", sessionId: id });
        }
        return;
      case events.error.name:
        emitError(props, id);
        return;
      case "session.text.started":
        emitPart(props, "text", "", false, frame.created);
        return;
      case "session.text.delta":
        emitDelta(props, "text", props.delta);
        return;
      case "session.text.ended":
        emitPart(
          props,
          "text",
          typeof props.text === "string" ? props.text : "",
          true,
          frame.created,
        );
        return;
      case "session.reasoning.started":
        emitPart(props, "thinking", "", false, frame.created);
        return;
      case "session.reasoning.delta":
        emitDelta(props, "thinking", props.delta);
        return;
      case "session.reasoning.ended":
        emitPart(
          props,
          "thinking",
          typeof props.text === "string" ? props.text : "",
          true,
          frame.created,
        );
        return;
      case "session.tool.called":
        if (id && deps.onToolCalled) {
          deps.onToolCalled(
            id,
            typeof props.name === "string" ? props.name : "",
            props.input,
            typeof props.id === "string" ? props.id : null,
          );
        }
        emitTask(props, "running", undefined, frame.created);
        recordTool(props, "running", undefined, frame.created);
        return;
      case "session.tool.success": {
        const callId = typeof props.id === "string" ? props.id : null;
        const key = id && callId ? `${id}\u0000${callId}` : null;
        emitTask(props, "completed", key ? toolCalls.get(key) : undefined, frame.created);
        recordTool(props, "completed", key ? toolCalls.get(key) : undefined, frame.created);
        if (key) toolCalls.delete(key);
        return;
      }
      case "session.tool.failed": {
        const callId = typeof props.id === "string" ? props.id : null;
        const key = id && callId ? `${id}\u0000${callId}` : null;
        emitTask(props, "error", key ? toolCalls.get(key) : undefined, frame.created);
        recordTool(props, "error", key ? toolCalls.get(key) : undefined, frame.created);
        if (key) toolCalls.delete(key);
        return;
      }
      default:
        // session.step.* (their content rides execution frames), inbox frames,
        // usage updates, and anything a future build adds: nothing to say.
        return;
    }
  };
}
