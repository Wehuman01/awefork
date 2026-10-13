/**
 * Minimal SSE parsing for opencode's /event stream.
 * Frames arrive as `data: {...}` lines separated by blank lines. Line
 * endings may be LF or CRLF depending on the server's HTTP stack, so both
 * boundary spellings are recognized; data lines keep their exact content
 * (JSON.parse treats a trailing CR as whitespace, so CRLF payloads need no
 * extra stripping).
 *
 * The payload envelope moved between protocols: v1 frames are
 * `{type, properties}`, v2 frames are `{id, created, type, location, data}`.
 * Both spellings are normalized here so adapters read one shape — the
 * fallback is safe because no frame carries both keys.
 */

export interface ServerEvent {
  type: string;
  /** The frame's payload — `properties` on opencode v1, `data` on v2. */
  properties: Record<string, unknown>;
  /** Frame timestamp (v2); null on v1, whose payloads carry their own times. */
  created: number | null;
}

/** Earliest blank-line boundary: `\n\n`, `\r\n\r\n`, or whichever comes first. */
function nextBoundary(buffer: string): { at: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf === -1 || (lf !== -1 && lf < crlf)) return { at: lf, length: 2 };
  return { at: crlf, length: 4 };
}

/** Feed it every chunk; it buffers and yields complete frames. */
export function createSseParser(): (chunk: string) => ServerEvent[] {
  let buffer = "";

  return (chunk: string) => {
    buffer += chunk;
    const events: ServerEvent[] = [];
    for (;;) {
      const boundary = nextBoundary(buffer);
      if (boundary === null) break;
      const frame = buffer.slice(0, boundary.at);
      buffer = buffer.slice(boundary.at + boundary.length);
      const event = parseFrame(frame);
      if (event) events.push(event);
    }
    return events;
  };
}

function parseFrame(frame: string): ServerEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as {
      type?: unknown;
      properties?: unknown;
      data?: unknown;
      created?: unknown;
    };
    if (typeof parsed.type !== "string") return null;
    const payload = parsed.properties ?? parsed.data;
    return {
      type: parsed.type,
      properties:
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {},
      created: typeof parsed.created === "number" ? parsed.created : null,
    };
  } catch {
    return null;
  }
}
