import { describe, expect, it } from "vitest";
import { createSseParser } from "../src/shared/sse";

describe("createSseParser", () => {
  it("parses a complete frame", () => {
    const parse = createSseParser();
    const events = parse('data: {"type":"session.idle","properties":{"sessionID":"s1"}}\n\n');
    expect(events).toEqual([
      { type: "session.idle", properties: { sessionID: "s1" }, created: null },
    ]);
  });

  it("buffers partial chunks until the frame boundary", () => {
    const parse = createSseParser();
    expect(parse('data: {"type":"a"')).toEqual([]);
    expect(parse(',"properties":{}}\n\n')).toEqual([{ type: "a", properties: {}, created: null }]);
  });

  it("handles multiple frames in one chunk", () => {
    const parse = createSseParser();
    const events = parse(
      'data: {"type":"a","properties":{}}\n\ndata: {"type":"b","properties":{}}\n\n',
    );
    expect(events.map((e) => e.type)).toEqual(["a", "b"]);
  });

  it("ignores non-data lines and invalid json", () => {
    const parse = createSseParser();
    const events = parse(
      'event: message\ndata: not-json\n\ndata: {"type":"ok","properties":{}}\n\n',
    );
    expect(events).toEqual([{ type: "ok", properties: {}, created: null }]);
  });

  it("joins multi-line data payloads", () => {
    const parse = createSseParser();
    const events = parse('data: {"type":"a",\ndata: "properties":{"x":1}}\n\n');
    expect(events).toEqual([{ type: "a", properties: { x: 1 }, created: null }]);
  });

  it("parses CRLF-framed streams, including split chunks and multi-line data", () => {
    const parse = createSseParser();
    expect(
      parse('event: message\r\ndata: {"type":"a","properties":{}}\r\n\r\ndata: {"type":"b",\r'),
    ).toEqual([{ type: "a", properties: {}, created: null }]);
    // The chunk boundary falls between the CR and LF of a data line's ending.
    expect(parse('\ndata: "properties":{"x":1}}\r\n\r\n')).toEqual([
      { type: "b", properties: { x: 1 }, created: null },
    ]);
  });

  it("reads the payload out of a v2 frame, where it moved from properties to data", () => {
    // opencode v2 wraps the event name and payload differently: the frame
    // carries id/created/type/location and the payload sits under `data`.
    const parse = createSseParser();
    const frame =
      'data: {"id":"evt_1","created":1791865456780,"type":"session.text.delta",' +
      '"location":{"directory":"/tmp"},"data":{"sessionID":"s1","assistantMessageID":"m1",' +
      '"ordinal":0,"delta":"pong"}}\n\n';
    expect(parse(frame)).toEqual([
      {
        type: "session.text.delta",
        properties: {
          sessionID: "s1",
          assistantMessageID: "m1",
          ordinal: 0,
          delta: "pong",
        },
        created: 1791865456780,
      },
    ]);
  });
});
