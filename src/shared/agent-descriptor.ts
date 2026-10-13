/**
 * The agent descriptor vocabulary: every fact a backend version can change
 * without changing logic — endpoints, event names, field paths, the fork cut
 * translation, capabilities, the tested version range. The `agents/*.json`
 * files are that data; this module is the closed vocabulary they may use.
 *
 * Two opencode protocols ship side by side: v1 (the historical `/session` API,
 * tested against 1.18.x–1.19.x) and v2 (the `/api` API, authenticated, cursor
 * paged, new streaming event family). `protocol` names which interpreter the
 * adapter branches on; every name and path stays data. parseOpenCodeDescriptor
 * rejects unknown keys at every level, so a typo in a descriptor fails loudly
 * at startup instead of degrading silently at runtime (the failure mode this
 * layer exists to eliminate). The read helpers (readPath/firstString/
 * firstNumber) are the generic half of the interpreter: adapters stay code
 * only where there is real behavior.
 */
import opencodeJson from "./agents/opencode.json";
import opencodeV2Json from "./agents/opencode-v2.json";

/** Version range the adapter was developed and tested against. Inclusive min, exclusive max. */
export interface AgentCompat {
  readonly min: string;
  readonly max: string;
}

/**
 * Which wire-protocol dialect a descriptor describes. v1 is the historical
 * `/session` API; v2 is the `/api` API (authenticated, enveloped, cursor
 * paged, ordinal-scoped streaming). The adapter and client branch on this;
 * everything a version can rename stays data in the sections below.
 */
export type OpenCodeProtocol = "v1" | "v2";

/** How the transport authenticates; the password itself is runtime state. */
export interface AgentAuth {
  readonly scheme: "basic";
  readonly username: string;
}

/**
 * How responses wrap their payload (`{data: …}` on v2). `bare` names endpoint
 * keys whose response is NOT wrapped — v2's project list answers a plain array.
 */
export interface AgentEnvelope {
  readonly dataKey: string;
  readonly bare: readonly string[];
}

/** Cursor-paged list endpoints; absent = one request, no paging. */
export interface AgentPagination {
  readonly style: "cursor";
  readonly limitParam: string;
  readonly cursorParam: string;
  /** Dot-path to the next cursor inside the response envelope. */
  readonly nextPath: string;
  /** Per-endpoint page size, keyed by endpoint name; absent = `limit`. */
  readonly limits?: Readonly<Record<string, number>>;
  /** Fallback page size when an endpoint has no entry in `limits`. */
  readonly limit: number;
  /**
   * Timeline order the FIRST page is asked for; the cursor returned by it
   * carries the order onward (sending both is rejected). awefork consumes
   * every timeline oldest-first — the fork cut and the rendered conversation
   * both walk forward — while the servers default to newest-first.
   */
  readonly order?: "asc" | "desc";
}

/** How a prompt body is built. v1 posts parts + the model; v2 posts text. */
export interface AgentPrompt {
  readonly style: "parts" | "text";
  /** Whether the model rides the prompt body (v1) or lives on the session (v2). */
  readonly modelInBody: boolean;
  /**
   * How attachments encode: v1 file parts carry a data URL in their `url`
   * field; v2's prompt files take that same data URL as their `uri` (the
   * server materializes it into the inline attachment).
   */
  readonly fileEncoding: "data-url-part" | "data-url-uri";
  /** POST the session's model before prompting (v2's prompt body has none). */
  readonly setModelFirst: boolean;
}

/** Feature surface the renderer gates affordances on. */
export interface AgentCapabilities {
  readonly deleteMessage: boolean;
  readonly attachments: boolean;
  /** Session compaction through the backend's summarize primitive. */
  readonly compress: boolean;
}

/** REST paths; `{id}` / `{messageId}` are interpolated by the client. */
export interface AgentEndpoints {
  readonly sessions: string;
  readonly session: string;
  readonly sessionMessages: string;
  /** POST that starts a run. Absent on v1 — it shares sessionMessages there. */
  readonly sessionPrompt?: string;
  /** POST that pins the session's model; v2's prompt body carries none. */
  readonly sessionModel?: string;
  readonly sessionMessage: string;
  readonly sessionFork: string;
  readonly sessionAbort: string;
  /** POST — folds the session into a summary; long-running, resolves at the end. */
  readonly sessionSummarize: string;
  readonly projects: string;
  readonly providers: string;
  readonly events: string;
}

/** Candidate dot-paths per normalized field, first hit wins. */
export interface AgentSessionFields {
  readonly id: readonly string[];
  readonly title: readonly string[];
  readonly directory: readonly string[];
  readonly parentSessionId: readonly string[];
  readonly createdAt: readonly string[];
  readonly updatedAt: readonly string[];
}

export interface AgentMessageFields {
  readonly id: readonly string[];
  readonly role: readonly string[];
  readonly modelId: readonly string[];
  readonly providerId: readonly string[];
  readonly variant: readonly string[];
  readonly createdAt: readonly string[];
  readonly completedAt: readonly string[];
  readonly finish: readonly string[];
  readonly outputTokens: readonly string[];
  readonly error: readonly string[];
}

/** A text-bearing part kind: which part type holds it and how rows join. */
export interface AgentTextPart {
  readonly type: string;
  readonly field: string;
  readonly join: string;
}

export interface AgentToolPart {
  readonly type: string;
  readonly nameField: string;
  readonly fallbackName: string;
}

export interface AgentFilePart {
  readonly type: string;
  readonly nameField: string;
  readonly fallbackName: string;
  readonly urlField: string;
  readonly mimeField: string;
}

/**
 * A compaction marker part: opencode's summarize inserts a user row whose
 * only part is `type:"compaction"`. It carries no text — its presence flags
 * the row as the "history above was folded into a summary" boundary. v2 makes
 * the marker the row itself, so `rowTypeField` (a dot-path on the row) is set
 * there instead and the part list carries no marker.
 */
export interface AgentCompactionPart {
  readonly type: string;
  /** When set, the marker is the row's own type field, not a part. */
  readonly rowTypeField?: string;
}

export interface AgentMessageParts {
  readonly text: AgentTextPart;
  readonly thinking: AgentTextPart;
  readonly tool: AgentToolPart;
  readonly file: AgentFilePart;
  /** Optional: a backend version without compaction rows simply omits it. */
  readonly compaction?: AgentCompactionPart;
}

export interface AgentErrorEvent {
  readonly name: string;
  readonly detailPaths: readonly string[];
}

export interface AgentStatusEvent {
  readonly name: string;
  /** Dot-path to the status discriminator inside the frame's properties. */
  readonly valuePath: string;
  readonly busyValue: string;
  readonly idleValue: string;
}

export interface AgentPartSnapshotEvent {
  readonly name: string;
  /** Property key holding the whole part object. */
  readonly partField: string;
  /** Older builds carry the text delta in the snapshot frame itself. */
  readonly deltaField: string;
  /** Backend part type → normalized stream kind. */
  readonly kinds: Readonly<Record<string, "text" | "thinking">>;
}

export interface AgentPartDeltaEvent {
  readonly name: string;
  /** Only deltas for this field value are forwarded. */
  readonly field: string;
  readonly textFieldValue: string;
  readonly partIdField: string;
  readonly deltaField: string;
}

/**
 * Per-turn file-change recording facts: which tools touch files, where the
 * state discriminator and the file path live inside a tool part, and which
 * state values mean the tool finished. Optional — a descriptor without this
 * section runs with recording off. `stateKeyPath` is optional too: a protocol
 * whose events name the state outright (v2's tool lifecycle) supplies it from
 * the event instead of reading it off the part.
 */
export interface AgentFileChangesFact {
  readonly tools: readonly string[];
  readonly stateKeyPath?: string;
  readonly filePathPaths: readonly string[];
  readonly doneStates: readonly string[];
}

/**
 * Where a message's attachments live when they are not parts. v2 keeps them on
 * the user row as a `files` array of `{name, mime, data}`.
 */
export interface AgentAttachmentsFact {
  /** Dot-path to the array on the row. */
  readonly path: string;
  readonly nameField: string;
  readonly mimeField: string;
  /** Holds the content: a data URL (v1 file parts) or raw base64 (v2). */
  readonly dataField: string;
}

export interface AgentEvents {
  /** Frame names that mean "re-read this session". */
  readonly refresh: readonly string[];
  /** Frames that carry nothing awefork needs (message.updated replays on fork). */
  readonly ignore: readonly string[];
  readonly idle: readonly string[];
  readonly error: AgentErrorEvent;
  /** v1's busy/idle frame; absent on v2, whose lifecycle rides execution frames. */
  readonly status?: AgentStatusEvent;
  /** v1's part snapshot stream; absent on v2, which streams by ordinal. */
  readonly partSnapshot?: AgentPartSnapshotEvent;
  /** v1's part delta stream; absent on v2. */
  readonly partDelta?: AgentPartDeltaEvent;
  readonly sessionIdPaths: readonly string[];
  readonly messageIdPaths: readonly string[];
}

/**
 * Field names for a part's timing, where they differ per protocol: v1 parts
 * carry `time:{start,end}`, v2's `{created,completed}`.
 */
export interface AgentPartTimeKeys {
  readonly start: string;
  readonly end: string;
}

export interface OpenCodeDescriptor {
  readonly kind: "opencode";
  readonly protocol: OpenCodeProtocol;
  readonly compat: AgentCompat;
  readonly capabilities: AgentCapabilities;
  /** Present = the transport authenticates; the password is runtime state. */
  readonly auth?: AgentAuth;
  /** Present = responses wrap their payload; absent = bare bodies (v1). */
  readonly envelope?: AgentEnvelope;
  /** Present = list endpoints page by cursor; absent = single request (v1). */
  readonly pagination?: AgentPagination;
  /** Present = how prompt bodies are built; absent = v1's parts + model. */
  readonly prompt?: AgentPrompt;
  /**
   * How the backend's fork primitive takes a cut point. opencode's cut is
   * exclusive (the branch keeps messages strictly before it), so the adapter
   * passes the NEXT user message after the fork anchor — "next-user-exclusive".
   * `cutParam` names the body key carrying it (`messageID` on v1, `before` on v2).
   */
  readonly fork: { readonly cut: "next-user-exclusive"; readonly cutParam: string };
  /** Present = the adapter records per-turn file changes from tool parts. */
  readonly fileChanges?: AgentFileChangesFact;
  readonly endpoints: AgentEndpoints;
  readonly sessions: {
    readonly fields: AgentSessionFields;
    /** How POST sessions takes the target directory; absent = query param (v1). */
    readonly create?: { readonly directoryIn: "query" | "body" };
  };
  readonly messages: {
    readonly fields: AgentMessageFields;
    readonly parts: AgentMessageParts;
    /** Dot-path to the parts array on a row; absent = "parts" (v1). */
    readonly partsPath?: string;
    /** Row-level text field(s) — v2 keeps a user message's text on the row. */
    readonly textPath?: readonly string[];
    /** Row-level attachment array; absent = attachments are file parts (v1). */
    readonly attachments?: AgentAttachmentsFact;
  };
  /** Part timing field names; absent = v1's start/end. */
  readonly partTimeKeys?: AgentPartTimeKeys;
  readonly events: AgentEvents;
}

export class DescriptorSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DescriptorSchemaError";
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DescriptorSchemaError(`${where}: expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const unknownKeys = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new DescriptorSchemaError(`${where}: unknown key(s) ${unknownKeys.join(", ")}`);
  }
}

function stringAt(value: unknown, where: string): string {
  if (value === undefined) {
    throw new DescriptorSchemaError(`${where}: missing`);
  }
  if (typeof value !== "string" || value === "") {
    throw new DescriptorSchemaError(`${where}: expected a non-empty string`);
  }
  return value;
}

function booleanAt(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new DescriptorSchemaError(`${where}: expected a boolean`);
  }
  return value;
}

function stringsAt(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DescriptorSchemaError(`${where}: expected a non-empty array of strings`);
  }
  return value.map((entry, index) => stringAt(entry, `${where}[${index}]`));
}

/** A dot-path segment must never walk off plain data into an object's prototype chain. */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function dotPathsAt(value: unknown, where: string): string[] {
  return stringsAt(value, where).map((path, index) => {
    for (const segment of path.split(".")) {
      if (segment === "" || FORBIDDEN_SEGMENTS.has(segment)) {
        throw new DescriptorSchemaError(`${where}[${index}]: bad path segment "${segment}"`);
      }
    }
    return path;
  });
}

function section(value: unknown, key: string, where: string): Record<string, unknown> {
  const record = objectAt(value, where);
  if (!(key in record)) throw new DescriptorSchemaError(`${where}: missing "${key}"`);
  return objectAt(record[key], `${where}.${key}`);
}

/** A section that may be absent entirely; still key-checked when present. */
function optionalSection(
  parent: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): Record<string, unknown> | null {
  if (parent[key] === undefined) return null;
  const record = objectAt(parent[key], `events.${key}`);
  onlyKeys(record, allowed, `events.${key}`);
  return record;
}

function parseFieldPaths<T extends object>(
  value: unknown,
  keys: readonly (keyof T & string)[],
  where: string,
): T {
  const record = objectAt(value, where);
  onlyKeys(record, keys, where);
  return Object.fromEntries(
    keys.map((key) => [key, dotPathsAt(record[key], `${where}.${key}`)]),
  ) as unknown as T;
}

function parseTextPart(value: unknown, where: string): AgentTextPart {
  const record = objectAt(value, where);
  onlyKeys(record, ["type", "field", "join"], where);
  return {
    type: stringAt(record.type, `${where}.type`),
    field: stringAt(record.field, `${where}.field`),
    join: stringAt(record.join, `${where}.join`),
  };
}

export function parseOpenCodeDescriptor(value: unknown): OpenCodeDescriptor {
  const root = objectAt(value, "agent descriptor");
  onlyKeys(
    root,
    [
      "kind",
      "protocol",
      "compat",
      "capabilities",
      "auth",
      "envelope",
      "pagination",
      "prompt",
      "fork",
      "fileChanges",
      "endpoints",
      "sessions",
      "messages",
      "partTimeKeys",
      "events",
    ],
    "agent descriptor",
  );
  if (root.kind !== "opencode") {
    throw new DescriptorSchemaError(`agent descriptor.kind: expected "opencode"`);
  }
  // Absent protocol means the historical dialect; v2 declares itself.
  const protocol: OpenCodeProtocol =
    root.protocol === undefined ? "v1" : root.protocol === "v2" ? "v2" : "v1";
  if (root.protocol !== undefined && root.protocol !== "v1" && root.protocol !== "v2") {
    throw new DescriptorSchemaError(
      `agent descriptor.protocol: expected "v1" or "v2", got ${describe(root.protocol)}`,
    );
  }

  const compat = section(root, "compat", "agent descriptor");
  onlyKeys(compat, ["min", "max"], "compat");
  const parsedCompat = {
    min: stringAt(compat.min, "compat.min"),
    max: stringAt(compat.max, "compat.max"),
  };

  const capabilities = section(root, "capabilities", "agent descriptor");
  onlyKeys(capabilities, ["deleteMessage", "attachments", "compress"], "capabilities");
  const parsedCapabilities = {
    deleteMessage: booleanAt(capabilities.deleteMessage, "capabilities.deleteMessage"),
    attachments: booleanAt(capabilities.attachments, "capabilities.attachments"),
    compress: booleanAt(capabilities.compress, "capabilities.compress"),
  };

  // Optional transport auth: the scheme is data, the password runtime state.
  let auth: AgentAuth | undefined;
  if (root.auth !== undefined) {
    const record = objectAt(root.auth, "auth");
    onlyKeys(record, ["scheme", "username"], "auth");
    if (record.scheme !== "basic") {
      throw new DescriptorSchemaError(`auth.scheme: unknown scheme "${String(record.scheme)}"`);
    }
    auth = { scheme: "basic", username: stringAt(record.username, "auth.username") };
  }

  // Optional response envelope; `bare` lists endpoint keys answered unwrapped.
  let envelope: AgentEnvelope | undefined;
  if (root.envelope !== undefined) {
    const record = objectAt(root.envelope, "envelope");
    onlyKeys(record, ["dataKey", "bare"], "envelope");
    envelope = {
      dataKey: stringAt(record.dataKey, "envelope.dataKey"),
      bare: stringsAt(record.bare, "envelope.bare"),
    };
  }

  // Optional cursor paging for list endpoints.
  let pagination: AgentPagination | undefined;
  if (root.pagination !== undefined) {
    const record = objectAt(root.pagination, "pagination");
    onlyKeys(
      record,
      ["style", "limitParam", "cursorParam", "nextPath", "limits", "limit", "order"],
      "pagination",
    );
    if (record.style !== "cursor") {
      throw new DescriptorSchemaError(`pagination.style: unknown style "${String(record.style)}"`);
    }
    let order: "asc" | "desc" | undefined;
    if (record.order !== undefined) {
      if (record.order !== "asc" && record.order !== "desc") {
        throw new DescriptorSchemaError(
          `pagination.order: expected "asc" or "desc", got ${describe(record.order)}`,
        );
      }
      order = record.order;
    }
    const limits: Record<string, number> = {};
    if (record.limits !== undefined) {
      const limitsRecord = objectAt(record.limits, "pagination.limits");
      for (const [key, value] of Object.entries(limitsRecord)) {
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
          throw new DescriptorSchemaError(`pagination.limits.${key}: expected a positive integer`);
        }
        limits[key] = value;
      }
    }
    pagination = {
      style: "cursor",
      limitParam: stringAt(record.limitParam, "pagination.limitParam"),
      cursorParam: stringAt(record.cursorParam, "pagination.cursorParam"),
      nextPath: stringAt(record.nextPath, "pagination.nextPath"),
      ...(Object.keys(limits).length > 0 ? { limits } : {}),
      ...(order ? { order } : {}),
      limit: (() => {
        const fallback = record.limit;
        if (typeof fallback !== "number" || !Number.isInteger(fallback) || fallback <= 0) {
          throw new DescriptorSchemaError("pagination.limit: expected a positive integer");
        }
        return fallback;
      })(),
    };
  }

  // Optional prompt-body recipe; absent = v1's parts + inline model.
  let prompt: AgentPrompt | undefined;
  if (root.prompt !== undefined) {
    const record = objectAt(root.prompt, "prompt");
    onlyKeys(record, ["style", "modelInBody", "fileEncoding", "setModelFirst"], "prompt");
    const style = record.style;
    const fileEncoding = record.fileEncoding;
    if (style !== "parts" && style !== "text") {
      throw new DescriptorSchemaError(`prompt.style: unknown style "${String(style)}"`);
    }
    if (fileEncoding !== "data-url-part" && fileEncoding !== "data-url-uri") {
      throw new DescriptorSchemaError(
        `prompt.fileEncoding: unknown encoding "${String(fileEncoding)}"`,
      );
    }
    prompt = {
      style,
      modelInBody: booleanAt(record.modelInBody, "prompt.modelInBody"),
      fileEncoding,
      setModelFirst: booleanAt(record.setModelFirst, "prompt.setModelFirst"),
    };
  }

  const fork = section(root, "fork", "agent descriptor");
  onlyKeys(fork, ["cut", "cutParam"], "fork");
  if (fork.cut !== "next-user-exclusive") {
    throw new DescriptorSchemaError(`fork.cut: unknown strategy "${String(fork.cut)}"`);
  }

  // Optional section: present = file-change recording is on for this backend.
  let fileChanges: AgentFileChangesFact | undefined;
  if (root.fileChanges !== undefined) {
    const changes = objectAt(root.fileChanges, "fileChanges");
    onlyKeys(changes, ["tools", "stateKeyPath", "filePathPaths", "doneStates"], "fileChanges");
    let stateKeyPath: string | undefined;
    if (changes.stateKeyPath !== undefined) {
      stateKeyPath = stringAt(changes.stateKeyPath, "fileChanges.stateKeyPath");
      for (const segment of stateKeyPath.split(".")) {
        if (segment === "" || FORBIDDEN_SEGMENTS.has(segment)) {
          throw new DescriptorSchemaError(
            `fileChanges.stateKeyPath: bad path segment "${segment}"`,
          );
        }
      }
    }
    fileChanges = {
      tools: stringsAt(changes.tools, "fileChanges.tools"),
      ...(stateKeyPath ? { stateKeyPath } : {}),
      filePathPaths: dotPathsAt(changes.filePathPaths, "fileChanges.filePathPaths"),
      doneStates: stringsAt(changes.doneStates, "fileChanges.doneStates"),
    };
  }

  const endpoints = section(root, "endpoints", "agent descriptor");
  const endpointKeys = [
    "sessions",
    "session",
    "sessionMessages",
    "sessionPrompt",
    "sessionModel",
    "sessionMessage",
    "sessionFork",
    "sessionAbort",
    "sessionSummarize",
    "projects",
    "providers",
    "events",
  ] as const;
  onlyKeys(endpoints, endpointKeys, "endpoints");
  const parsedEndpoints = Object.fromEntries(
    endpointKeys
      .filter((key) => endpoints[key] !== undefined)
      .map((key) => [key, stringAt(endpoints[key], `endpoints.${key}`)]),
  ) as unknown as AgentEndpoints;

  const sessions = section(root, "sessions", "agent descriptor");
  onlyKeys(sessions, ["fields", "create"], "sessions");
  const sessionsFields = parseFieldPaths<AgentSessionFields>(
    sessions.fields,
    ["id", "title", "directory", "parentSessionId", "createdAt", "updatedAt"],
    "sessions.fields",
  );
  let createDirectoryIn: "query" | "body" | undefined;
  if (sessions.create !== undefined) {
    const create = objectAt(sessions.create, "sessions.create");
    onlyKeys(create, ["directoryIn"], "sessions.create");
    if (create.directoryIn !== "query" && create.directoryIn !== "body") {
      throw new DescriptorSchemaError(
        `sessions.create.directoryIn: expected "query" or "body", got ${describe(create.directoryIn)}`,
      );
    }
    createDirectoryIn = create.directoryIn;
  }

  const messages = section(root, "messages", "agent descriptor");
  onlyKeys(messages, ["fields", "parts", "partsPath", "textPath", "attachments"], "messages");
  const messagesFields = parseFieldPaths<AgentMessageFields>(
    messages.fields,
    [
      "id",
      "role",
      "modelId",
      "providerId",
      "variant",
      "createdAt",
      "completedAt",
      "finish",
      "outputTokens",
      "error",
    ],
    "messages.fields",
  );

  const parts = objectAt(messages.parts, "messages.parts");
  onlyKeys(parts, ["text", "thinking", "tool", "file", "compaction"], "messages.parts");
  const tool = section(parts, "tool", "messages.parts");
  onlyKeys(tool, ["type", "nameField", "fallbackName"], "messages.parts.tool");
  const file = section(parts, "file", "messages.parts");
  onlyKeys(
    file,
    ["type", "nameField", "fallbackName", "urlField", "mimeField"],
    "messages.parts.file",
  );
  // Optional marker part: a descriptor without it maps no compaction rows.
  let compactionPart: AgentCompactionPart | undefined;
  if (parts.compaction !== undefined) {
    const compaction = objectAt(parts.compaction, "messages.parts.compaction");
    onlyKeys(compaction, ["type", "rowTypeField"], "messages.parts.compaction");
    compactionPart = {
      type: stringAt(compaction.type, "messages.parts.compaction.type"),
      ...(compaction.rowTypeField !== undefined
        ? {
            rowTypeField: dotPathsAt(
              [compaction.rowTypeField],
              "messages.parts.compaction.rowTypeField",
            )[0],
          }
        : {}),
    };
  }

  // Optional row-level text/attachments/parts-path facts (v2's flat messages).
  let partsPath: string | undefined;
  if (messages.partsPath !== undefined) {
    partsPath = stringAt(messages.partsPath, "messages.partsPath");
  }
  let textPath: string[] | undefined;
  if (messages.textPath !== undefined) {
    textPath = dotPathsAt(messages.textPath, "messages.textPath");
  }
  let attachments: AgentAttachmentsFact | undefined;
  if (messages.attachments !== undefined) {
    const record = objectAt(messages.attachments, "messages.attachments");
    onlyKeys(record, ["path", "nameField", "mimeField", "dataField"], "messages.attachments");
    attachments = {
      path: dotPathsAt([record.path], "messages.attachments.path")[0] as string,
      nameField: stringAt(record.nameField, "messages.attachments.nameField"),
      mimeField: stringAt(record.mimeField, "messages.attachments.mimeField"),
      dataField: stringAt(record.dataField, "messages.attachments.dataField"),
    };
  }

  // Optional part timing keys; absent = v1's start/end.
  let partTimeKeys: AgentPartTimeKeys | undefined;
  if (root.partTimeKeys !== undefined) {
    const record = objectAt(root.partTimeKeys, "partTimeKeys");
    onlyKeys(record, ["start", "end"], "partTimeKeys");
    partTimeKeys = {
      start: stringAt(record.start, "partTimeKeys.start"),
      end: stringAt(record.end, "partTimeKeys.end"),
    };
  }

  const events = section(root, "events", "agent descriptor");
  onlyKeys(
    events,
    [
      "refresh",
      "ignore",
      "idle",
      "error",
      "status",
      "partSnapshot",
      "partDelta",
      "sessionIdPaths",
      "messageIdPaths",
    ],
    "events",
  );

  const errorEvent = section(events, "error", "events");
  onlyKeys(errorEvent, ["name", "detailPaths"], "events.error");
  // The part-level streaming sections describe v1's wire family; v2 streams by
  // ordinal through its own translator and omits them.
  const status = optionalSection(events, "status", ["name", "valuePath", "busyValue", "idleValue"]);
  const partSnapshot = optionalSection(events, "partSnapshot", [
    "name",
    "partField",
    "deltaField",
    "kinds",
  ]);
  if (partSnapshot) {
    const kindsRecord = objectAt(partSnapshot.kinds, "events.partSnapshot.kinds");
    for (const [partType, kind] of Object.entries(kindsRecord)) {
      if (kind !== "text" && kind !== "thinking") {
        throw new DescriptorSchemaError(
          `events.partSnapshot.kinds.${partType}: expected "text" or "thinking", got ${describe(kind)}`,
        );
      }
    }
  }
  const partDelta = optionalSection(events, "partDelta", [
    "name",
    "field",
    "textFieldValue",
    "partIdField",
    "deltaField",
  ]);
  if (protocol === "v1" && (!status || !partSnapshot || !partDelta)) {
    throw new DescriptorSchemaError(
      "events: protocol v1 requires status, partSnapshot and partDelta",
    );
  }

  return {
    kind: "opencode",
    protocol,
    compat: parsedCompat,
    capabilities: parsedCapabilities,
    ...(auth ? { auth } : {}),
    ...(envelope ? { envelope } : {}),
    ...(pagination ? { pagination } : {}),
    ...(prompt ? { prompt } : {}),
    fork: {
      cut: "next-user-exclusive",
      cutParam: stringAt(fork.cutParam ?? "messageID", "fork.cutParam"),
    },
    ...(fileChanges ? { fileChanges } : {}),
    endpoints: parsedEndpoints,
    sessions: {
      fields: sessionsFields,
      ...(createDirectoryIn ? { create: { directoryIn: createDirectoryIn } } : {}),
    },
    messages: {
      fields: messagesFields,
      ...(partsPath ? { partsPath } : {}),
      ...(textPath ? { textPath } : {}),
      ...(attachments ? { attachments } : {}),
      parts: {
        text: parseTextPart(parts.text, "messages.parts.text"),
        thinking: parseTextPart(parts.thinking, "messages.parts.thinking"),
        ...(compactionPart ? { compaction: compactionPart } : {}),
        tool: {
          type: stringAt(tool.type, "messages.parts.tool.type"),
          nameField: stringAt(tool.nameField, "messages.parts.tool.nameField"),
          fallbackName: stringAt(tool.fallbackName, "messages.parts.tool.fallbackName"),
        },
        file: {
          type: stringAt(file.type, "messages.parts.file.type"),
          nameField: stringAt(file.nameField, "messages.parts.file.nameField"),
          fallbackName: stringAt(file.fallbackName, "messages.parts.file.fallbackName"),
          urlField: stringAt(file.urlField, "messages.parts.file.urlField"),
          mimeField: stringAt(file.mimeField, "messages.parts.file.mimeField"),
        },
      },
    },
    ...(partTimeKeys ? { partTimeKeys } : {}),
    events: {
      refresh: stringsAt(events.refresh, "events.refresh"),
      ignore: stringsAt(events.ignore, "events.ignore"),
      idle: stringsAt(events.idle, "events.idle"),
      error: {
        name: stringAt(errorEvent.name, "events.error.name"),
        detailPaths: dotPathsAt(errorEvent.detailPaths, "events.error.detailPaths"),
      },
      ...(status
        ? {
            status: {
              name: stringAt(status.name, "events.status.name"),
              valuePath: stringAt(status.valuePath, "events.status.valuePath"),
              busyValue: stringAt(status.busyValue, "events.status.busyValue"),
              idleValue: stringAt(status.idleValue, "events.status.idleValue"),
            },
          }
        : {}),
      ...(partSnapshot
        ? {
            partSnapshot: {
              name: stringAt(partSnapshot.name, "events.partSnapshot.name"),
              partField: stringAt(partSnapshot.partField, "events.partSnapshot.partField"),
              deltaField: stringAt(partSnapshot.deltaField, "events.partSnapshot.deltaField"),
              kinds: partSnapshot.kinds as Record<string, "text" | "thinking">,
            },
          }
        : {}),
      ...(partDelta
        ? {
            partDelta: {
              name: stringAt(partDelta.name, "events.partDelta.name"),
              field: stringAt(partDelta.field, "events.partDelta.field"),
              textFieldValue: stringAt(partDelta.textFieldValue, "events.partDelta.textFieldValue"),
              partIdField: stringAt(partDelta.partIdField, "events.partDelta.partIdField"),
              deltaField: stringAt(partDelta.deltaField, "events.partDelta.deltaField"),
            },
          }
        : {}),
      sessionIdPaths: dotPathsAt(events.sessionIdPaths, "events.sessionIdPaths"),
      messageIdPaths: dotPathsAt(events.messageIdPaths, "events.messageIdPaths"),
    },
  };
}

let cached: OpenCodeDescriptor | null = null;

/** The bundled v1 opencode descriptor, validated once per process. */
export function opencodeDescriptor(): OpenCodeDescriptor {
  cached ??= parseOpenCodeDescriptor(opencodeJson);
  return cached;
}

let cachedV2: OpenCodeDescriptor | null = null;

/** The bundled v2 opencode descriptor, validated once per process. */
export function opencodeV2Descriptor(): OpenCodeDescriptor {
  cachedV2 ??= parseOpenCodeDescriptor(opencodeV2Json);
  return cachedV2;
}

let cachedAll: OpenCodeDescriptor[] | null = null;

/**
 * Every bundled opencode descriptor, oldest protocol first. Both are parsed
 * (and schema-validated) once per process, so a malformed descriptor fails at
 * startup rather than when a version selects it.
 */
export function opencodeDescriptors(): readonly OpenCodeDescriptor[] {
  cachedAll ??= [opencodeDescriptor(), opencodeV2Descriptor()];
  return cachedAll;
}

/**
 * The descriptor for a probed CLI version. An exact compat-range hit wins; an
 * unknown version (a future release, or an old one below every range) falls
 * back to the closest known protocol — the last descriptor whose floor the
 * version has passed, since a newer opencode is far more likely to still speak
 * the newer API than to have reverted to the historical one. A null version
 * (probe failed) keeps the v1 default.
 */
export function selectOpencodeDescriptor(version: string | null): OpenCodeDescriptor {
  if (version === null) return opencodeDescriptor();
  const descriptors = opencodeDescriptors();
  const exact = descriptors.find((descriptor) => versionInRange(version, descriptor.compat));
  if (exact) return exact;
  const actual = versionTriple(version);
  let closest = descriptors[0] as OpenCodeDescriptor;
  for (const descriptor of descriptors) {
    if (compareTriples(actual, versionTriple(descriptor.compat.min)) >= 0) closest = descriptor;
  }
  return closest;
}

function versionTriple(version: string): [number, number, number] {
  const parts = version.split(".").map((segment) => Number.parseInt(segment, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareTriples(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/**
 * The switcher's compat warning: set when the probed version matches no
 * descriptor's tested range. The old failure mode was silent degradation — an
 * opencode whose event shapes drifted away made runs hang forever with nothing
 * saying why. A version outside the tested ranges now carries an explicit
 * warning instead — visible, but not a block (it may well still work, on the
 * closest protocol's interpreter).
 */
export function opencodeVersionWarning(version: string | null): string | null {
  if (version === null) return null;
  const supported = opencodeDescriptors().some((descriptor) =>
    versionInRange(version, descriptor.compat),
  );
  if (supported) return null;
  const ranges = opencodeDescriptors()
    .map((descriptor) => `≥${descriptor.compat.min}，<${descriptor.compat.max}`)
    .join("；");
  return `opencode ${version} 不在 awefork 已测试的版本区间（${ranges}）；若运行不结束或回复为空，请切换到已测试版本`;
}

// ---------------------------------------------------------------------------
// Generic read helpers: the interpretation half of the data/code split. They
// take `unknown` on purpose — tolerance for shape drift is the whole point.

/** Walk one dot-path ("info.model.modelID"); undefined as soon as it leaves the data. */
export function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** First dot-path whose value is a non-empty string, null when none is. */
export function firstString(source: unknown, candidates: readonly string[]): string | null {
  for (const path of candidates) {
    const value = readPath(source, path);
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/** First dot-path whose value is a number, null when none is. */
export function firstNumber(source: unknown, candidates: readonly string[]): number | null {
  for (const path of candidates) {
    const value = readPath(source, path);
    if (typeof value === "number") return value;
  }
  return null;
}

/** First x.y[.z…] triple in raw CLI output, null when there is none. */
export function parseVersion(raw: string): string | null {
  return raw.match(/\d+\.\d+(?:\.\d+)*/)?.[0] ?? null;
}

/** min inclusive, max exclusive; missing patch segments count as .0. */
export function versionInRange(version: string, compat: AgentCompat): boolean {
  const actual = versionTriple(version);
  return (
    compareTriples(actual, versionTriple(compat.min)) >= 0 &&
    compareTriples(actual, versionTriple(compat.max)) < 0
  );
}
