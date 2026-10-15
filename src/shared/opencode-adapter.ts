import {
  firstNumber,
  firstString,
  type OpenCodeDescriptor,
  opencodeDescriptor,
  readPath,
} from "./agent-descriptor.js";
import { canonicalizeSessionDirectories } from "./canonical-paths.js";
import {
  createFileChangeRecorder,
  type FileChangeRecorder,
  type ToolPartFrame,
} from "./file-change-recorder.js";
import { readDetachedExportIds, recordFork, removeFork } from "./lineage-store.js";
import {
  createOpencodeClient,
  type OcMessage,
  type OcPart,
  type OcSession,
  type OpencodeClient,
  OpencodeTimeoutError,
} from "./opencode-client.js";
import { createV2EventTranslator } from "./opencode-v2-events.js";
import { createSseParser, type ServerEvent } from "./sse.js";
import type {
  AgentAdapter,
  AgentEvent,
  ChatMessage,
  PromptAttachment,
  SessionOrigin,
  SessionSummary,
} from "./types.js";

export interface OpenCodeAdapterOptions {
  baseUrl: string;
  /** Path to the lineage sidecar file. */
  lineagePath: string;
  /** Root dir for per-session file-change sidecars; absent = no recording. */
  fileChangesDir?: string;
  /** Descriptor override for tests; defaults to the bundled agents/opencode.json. */
  descriptor?: OpenCodeDescriptor;
  /** Server password for the descriptor's auth scheme (v2); absent = no auth. */
  password?: string;
  /**
   * Snapshot reader handed to the file-change recorder; defaults to node:fs.
   * Tests use it to learn when a baseline read has actually landed, since
   * the recorder reads "before" asynchronously and a wall-clock guess loses that
   * race under load.
   */
  readFile?: (path: string) => Promise<Buffer>;
  /** Passed to the client; tests shrink fork's long copy deadline. */
  forkTimeoutMs?: number;
  /** Sleep between fork-adoption polls; tests inject a no-op. */
  adoptSleep?: (ms: number) => Promise<void>;
}

/**
 * opencode implementation of AgentAdapter — the interpreter over
 * agents/opencode.json. Names, paths, and shapes come from the descriptor;
 * what stays here is behavior: the reconnect loop, the part-kind state
 * machine, and the fork cut translation.
 *
 * Fork translation: the protocol promises the new branch KEEPS the turn that
 * starts at user message `atMessageId`. opencode's fork API takes an
 * exclusive cut point (keeps messages strictly before it), so we pass the
 * NEXT user message as the cut. At the last turn we omit the cut entirely.
 */
export function createOpencodeAdapter(options: OpenCodeAdapterOptions): AgentAdapter {
  const descriptor = options.descriptor ?? opencodeDescriptor();
  const client: OpencodeClient = createOpencodeClient(options.baseUrl, {
    descriptor,
    password: options.password,
    forkTimeoutMs: options.forkTimeoutMs,
  });
  const adoptSleep = options.adoptSleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let abortController: AbortController | null = null;
  /** Set by subscribe; lets detached prompts report request-level failures. */
  let emitEvent: ((event: AgentEvent) => void) | null = null;

  /**
   * Observer-seat file-change recording: every tool-part frame rides the same
   * SSE stream as text parts, so the recorder hangs off the part translation
   * below. One recorder per session keeps message/path state independent per
   * branch. Frame extraction is per protocol (v1 reads the part, v2's tool
   * lifecycle events name the state outright), but the recorder is shared.
   */
  const fileChangesFact = descriptor.fileChanges;
  const recorders = new Map<string, FileChangeRecorder>();
  const feedRecorder = (sessionId: string, frame: ToolPartFrame): void => {
    if (!options.fileChangesDir || !fileChangesFact) return;
    let recorder = recorders.get(sessionId);
    if (!recorder) {
      recorder = createFileChangeRecorder({
        rootDir: options.fileChangesDir,
        fact: fileChangesFact,
        readFile: options.readFile,
        directoryOf: async (id) => {
          try {
            const session = await client.session(id);
            return firstString(session, descriptor.sessions.fields.directory);
          } catch {
            // A session the server no longer names records nothing.
            return null;
          }
        },
      });
      recorders.set(sessionId, recorder);
    }
    recorder.observe(frame);
  };

  /**
   * v1's tool frames arrive as whole parts inside `message.part.updated`, so
   * the part itself says which tool ran, which file it touched and whether it
   * finished.
   */
  const onToolPart =
    options.fileChangesDir && fileChangesFact && descriptor.protocol === "v1"
      ? (sessionId: string, messageId: string, part: unknown): void => {
          const tool =
            firstString(part, [descriptor.messages.parts.tool.nameField]) ??
            descriptor.messages.parts.tool.fallbackName;
          const partId = readPath(part, "id");
          feedRecorder(sessionId, {
            sessionId,
            messageId,
            partId: typeof partId === "string" ? partId : "",
            tool,
            filePath: firstString(part, fileChangesFact.filePathPaths),
            stateKey: (fileChangesFact.stateKeyPath
              ? readPath(part, fileChangesFact.stateKeyPath)
              : undefined) as string | null,
          });
        }
      : undefined;

  /**
   * A session row carries two different parent relationships, and only one of
   * them hides the session: `parentSessionId` is the agent that spawned it as
   * a subagent (the agent's own work), while `forkSessionId` is the session it
   * was forked from (a branch the user chose). v1 spelled both on one field
   * because only subagents ever set it; v2 gave forks their own, so reading
   * either as "the parent" turned every fork into a hidden subagent.
   * `detached` names exported copies, whose fork link is overridden so the
   * copy maps as the plain root it was exported as.
   */
  const mapSession = (raw: unknown, detached?: ReadonlySet<string>): SessionSummary => {
    const id = firstString(raw, descriptor.sessions.fields.id) ?? "";
    const subagentParent = firstString(raw, descriptor.sessions.fields.parentSessionId);
    const forkParent = firstString(raw, descriptor.sessions.fields.forkSessionId);
    const parentSessionId = detached?.has(id) ? null : (subagentParent ?? forkParent);
    const origin: SessionOrigin = detached?.has(id)
      ? "root"
      : subagentParent
        ? "subagent"
        : forkParent
          ? "fork"
          : "root";
    return {
      id,
      title: firstString(raw, descriptor.sessions.fields.title) ?? "",
      directory: firstString(raw, descriptor.sessions.fields.directory) ?? "",
      parentSessionId,
      origin,
      createdAt: firstNumber(raw, descriptor.sessions.fields.createdAt) ?? 0,
      updatedAt: firstNumber(raw, descriptor.sessions.fields.updatedAt) ?? 0,
    };
  };

  /** Concatenate one text-bearing part kind per the descriptor; rows join on its separator. */
  const joinParts = (
    parts: OcPart[],
    config: { type: string; field: string; join: string },
  ): string =>
    parts
      .filter((p) => p.type === config.type && typeof partField(p, config.field) === "string")
      .map((p) => partField(p, config.field) as string)
      .join(config.join)
      .trim();

  /** The parts array on a row — v1's `parts`, v2's `content`. */
  const partsOf = (row: Record<string, unknown>): OcPart[] => {
    const raw = readPath(row, descriptor.messages.partsPath ?? "parts");
    return Array.isArray(raw) ? (raw as OcPart[]) : [];
  };

  /** Row-level text — v2 keeps a user message's text on the row, not in parts. */
  const rowText = (row: Record<string, unknown>): string => {
    const paths = descriptor.messages.textPath;
    return paths ? (firstString(row, paths) ?? "") : "";
  };

  /**
   * The compaction marker: a part of that type (v1 — summarize inserts a user
   * row whose only part is the marker) or the row's own type field (v2 — the
   * marker IS the row).
   */
  const isCompactionRow = (row: Record<string, unknown>, parts: OcPart[]): boolean => {
    const marker = descriptor.messages.parts.compaction;
    if (!marker) return false;
    if (marker.rowTypeField) return readPath(row, marker.rowTypeField) === marker.type;
    return parts.some((p) => p.type === marker.type);
  };

  /** Attachment display names: file parts (v1) or the row's files array (v2). */
  const attachmentNamesOf = (row: Record<string, unknown>, parts: OcPart[]): string[] => {
    const fact = descriptor.messages.attachments;
    if (fact) {
      const files = readPath(row, fact.path);
      if (!Array.isArray(files)) return [];
      return files.map((f) => firstString(f, [fact.nameField]) ?? "附件");
    }
    const file = descriptor.messages.parts.file;
    return parts
      .filter((p) => p.type === file.type)
      .map((p) => firstString(p, [file.nameField]) ?? file.fallbackName);
  };

  const mapMessages = (raw: OcMessage[]): ChatMessage[] =>
    raw
      .map((m) => {
        const { fields, parts } = descriptor.messages;
        const row = m as Record<string, unknown>;
        const messageParts = partsOf(row);
        // A compaction marker part carries no text; its presence flags the row
        // summarize inserted — everything before it was folded into the summary
        // that follows. v2 makes the marker the row itself, so it maps to the
        // same user-row shape v1 produces.
        const compaction = isCompactionRow(row, messageParts);
        return {
          id: firstString(m, fields.id) ?? "",
          role: compaction
            ? ("user" as ChatMessage["role"])
            : ((firstString(m, fields.role) ?? "assistant") as ChatMessage["role"]),
          // Reasoning rows join with a blank line: a multi-step run stores one
          // part per step, and joining them bare glues the last line of one
          // step's thinking onto the first of the next.
          text: joinParts(messageParts, parts.text) || (compaction ? "" : rowText(row)),
          thinking: joinParts(messageParts, parts.thinking),
          toolNames: [
            ...new Set(
              messageParts
                .filter((p) => p.type === parts.tool.type)
                .map((p) => firstString(p, [parts.tool.nameField]) ?? parts.tool.fallbackName),
            ),
          ],
          modelId: firstString(m, fields.modelId),
          providerId: firstString(m, fields.providerId),
          variant: firstString(m, fields.variant),
          attachmentNames: attachmentNamesOf(row, messageParts),
          createdAt: firstNumber(m, fields.createdAt) ?? 0,
          completedAt: firstNumber(m, fields.completedAt),
          finish: firstString(m, fields.finish),
          outputTokens: firstNumber(m, fields.outputTokens),
          error: firstString(m, fields.error),
          ...(compaction ? { compaction: true } : {}),
        };
      })
      // v2 interleaves bookkeeping rows (idle markers, model switches) into the
      // same stream; they are not conversation. v1 only ever had user and
      // assistant rows, so this filter is a no-op there.
      .filter((m) => m.role === "user" || m.role === "assistant" || m.compaction === true);

  async function findCutMessageId(sessionId: string, atMessageId: string): Promise<string | null> {
    const messages = await client.messages(sessionId);
    const index = messages.findIndex(
      (m) => firstString(m, descriptor.messages.fields.id) === atMessageId,
    );
    if (index === -1) {
      throw new Error(
        `Message ${atMessageId} not found in session ${sessionId}. Refresh the session and try again.`,
      );
    }
    const cut = messages
      .slice(index + 1)
      .find((m) => firstString(m, descriptor.messages.fields.role) === "user");
    return cut ? (firstString(cut, descriptor.messages.fields.id) ?? null) : null;
  }

  /** Adoption polls past the fork deadline: one immediate, then this many apart. */
  const ADOPT_POLLS = 6;
  const ADOPT_POLL_INTERVAL_MS = 5_000;

  /**
   * client.fork with adoption. Copying a huge session can outlive the request
   * deadline while the server keeps working — the new session row lands only
   * when the copy finishes, and the fork DID happen. Failing here sent users
   * into blind retries, each spawning another full copy. Instead, poll the
   * sessions list for the row the server created: same directory (listSessions
   * is scoped to it), title the server derives from the parent's — "parent
   * (fork #N)" — and created no earlier than this request (server and client
   * share the localhost clock; the slack only absorbs truncation). Earliest
   * match wins, so a copy from an earlier blind retry may be adopted but is
   * never skipped past. Polls that fail read as "not landed yet"; nothing
   * found after the window rethrows the original timeout, whose message
   * already says how to check before retrying.
   */
  async function forkOrAdopt(sessionId: string, cut: string | null): Promise<OcSession> {
    const startedAt = Date.now();
    try {
      return await client.fork(sessionId, cut);
    } catch (error) {
      if (!(error instanceof OpencodeTimeoutError)) throw error;
      let parent: OcSession;
      try {
        parent = await client.session(sessionId);
      } catch {
        throw error;
      }
      const { fields } = descriptor.sessions;
      const titlePrefix = `${firstString(parent, fields.title) ?? ""} (fork #`;
      for (let poll = 0; poll < ADOPT_POLLS; poll++) {
        if (poll > 0) await adoptSleep(ADOPT_POLL_INTERVAL_MS);
        let candidates: OcSession[] = [];
        try {
          candidates = await client.listSessions(
            firstString(parent, fields.directory) || undefined,
          );
        } catch {
          continue; // Server hiccup mid-reconcile — the next poll retries.
        }
        const adopted = candidates
          .filter(
            (s) =>
              firstString(s, fields.id) !== sessionId &&
              (firstNumber(s, fields.createdAt) ?? 0) >= startedAt - 2_000 &&
              (firstString(s, fields.title) ?? "").startsWith(titlePrefix),
          )
          .sort(
            (a, b) =>
              (firstNumber(a, fields.createdAt) ?? 0) - (firstNumber(b, fields.createdAt) ?? 0),
          )[0];
        if (adopted) return adopted;
      }
      throw error;
    }
  }

  return {
    kind: "opencode",

    async listSessions() {
      // Exported copies must map as roots, so their override is read before
      // any row is mapped.
      const detached = await readDetachedExportIds(options.lineagePath);
      const [current, projects] = await Promise.all([client.listSessions(), client.listProjects()]);
      const byId = new Map(current.map((s) => [s.id, s]));
      const otherWorktrees = projects.filter((p) => p.id !== "global" && p.worktree);
      // One request per worktree, in parallel — the serial loop made every
      // debounced refresh pay the sum of all worktree round-trips. Array
      // order preserves the later-wins overwrite of duplicate ids. Each
      // query is best-effort: a worktree the server cannot read (a macOS
      // privacy denial under ~/Desktop makes /session?directory=… answer
      // 500) drops out of this refresh instead of failing every listing.
      const perWorktree = await Promise.all(
        otherWorktrees.map((project) =>
          client.listSessions(project.worktree).catch((error: unknown) => {
            console.warn(`session listing for ${project.worktree} failed: ${String(error)}`);
            return [];
          }),
        ),
      );
      for (const sessions of perWorktree) {
        for (const session of sessions) byId.set(session.id, session);
      }
      // Directories canonicalize once per listing, so a project reported via
      // different symlink spellings (macOS /var vs /private/var) stays one
      // sidebar group instead of splitting.
      return canonicalizeSessionDirectories(
        [...byId.values()]
          .map((raw) => mapSession(raw, detached))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    },

    async messages(sessionId) {
      return mapMessages(await client.messages(sessionId));
    },

    async messageAttachments(sessionId, messageId) {
      const raw = await client.messages(sessionId);
      const target = raw.find((m) => firstString(m, descriptor.messages.fields.id) === messageId);
      if (!target) return [];
      const row = target as Record<string, unknown>;
      // v2 keeps attachments on the row as a files array of raw base64; v1 as
      // file parts that kept the data URL they were sent with. Either way the
      // parts round-trip as attachments again; entries that lost their content
      // are dropped rather than resent as empty files.
      const fact = descriptor.messages.attachments;
      if (fact) {
        const files = readPath(row, fact.path);
        if (!Array.isArray(files)) return [];
        return files
          .map((f) => {
            const mime = firstString(f, [fact.mimeField]) ?? "application/octet-stream";
            const data = firstString(f, [fact.dataField]);
            return data
              ? {
                  mime,
                  filename: firstString(f, [fact.nameField]) ?? "附件",
                  dataUrl: `data:${mime};base64,${data}`,
                }
              : null;
          })
          .filter((a): a is PromptAttachment => a !== null);
      }
      const file = descriptor.messages.parts.file;
      const parts = partsOf(row);
      return parts
        .filter(
          (p) =>
            p.type === file.type &&
            typeof partField(p, file.urlField) === "string" &&
            partField(p, file.urlField),
        )
        .map((p) => ({
          mime: firstString(p, [file.mimeField]) ?? "application/octet-stream",
          filename: firstString(p, [file.nameField]) ?? file.fallbackName,
          dataUrl: partField(p, file.urlField) as string,
        }));
    },

    listModels() {
      return client.listModels();
    },

    async createSession(directory) {
      return mapSession(await client.createSession(directory ?? undefined));
    },

    async fork(sessionId, atMessageId, forkOptions) {
      // Empty-context fork: a brand-new native session in the parent's
      // directory. Nothing is copied, but lineage still records the cut so
      // the canvas hangs the branch right where the fork card floated.
      if (forkOptions?.context === "none") {
        const parent = mapSession(await client.session(sessionId));
        const created = mapSession(await client.createSession(parent.directory || undefined));
        await recordFork(options.lineagePath, created.id, {
          parentId: sessionId,
          atMessageId,
          createdAt: created.createdAt,
          context: "none",
        });
        return { ...created, origin: "fork", parentSessionId: sessionId };
      }
      const cut = atMessageId ? await findCutMessageId(sessionId, atMessageId) : null;
      const forked = await forkOrAdopt(sessionId, cut);
      await recordFork(
        options.lineagePath,
        firstString(forked, descriptor.sessions.fields.id) ?? "",
        {
          parentId: sessionId,
          atMessageId,
          createdAt: firstNumber(forked, descriptor.sessions.fields.createdAt) ?? Date.now(),
        },
      );
      return { ...mapSession(forked), origin: "fork", parentSessionId: sessionId };
    },

    async exportSession(sessionId, atMessageId) {
      // Same cut translation and stale-anchor error as fork (the pre-check:
      // an anchor the server no longer has must fail loudly here, before any
      // copy exists) — but the copy lands as a plain root session the TUI or
      // any other opencode client can continue.
      const cut = atMessageId ? await findCutMessageId(sessionId, atMessageId) : null;
      const exported = await forkOrAdopt(sessionId, cut);
      const id = firstString(exported, descriptor.sessions.fields.id) ?? "";
      // A fork leaves the copy's row naming the session it came from, which
      // would make the copy read as a branch of its source — visible, but
      // nested where an export does not belong. Recording the copy as detached
      // makes the mapping drop that link, so it lands as the plain root the
      // export promised. A protocol whose rows carry no fork link (v1) needs
      // no record.
      if (firstString(exported, descriptor.sessions.fields.forkSessionId) !== null) {
        await recordFork(options.lineagePath, id, {
          parentId: sessionId,
          atMessageId,
          createdAt: firstNumber(exported, descriptor.sessions.fields.createdAt) ?? Date.now(),
          detached: true,
        });
      }
      return { ...mapSession(exported), origin: "root", parentSessionId: null };
    },

    async prompt(sessionId, text, model, attachments) {
      // Detached on purpose: /message only resolves when the whole run
      // finishes, while progress reaches this adapter through the event
      // stream. Request-level failures (server gone, unknown session) have no
      // event, so they surface here as server.error — with the session id, so
      // the renderer can settle that run instead of waiting out the watchdog.
      client.prompt(sessionId, text, model, attachments).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        emitEvent?.({
          type: "server.error",
          sessionId,
          message: `Prompt failed for ${sessionId}: ${detail}`,
        });
      });
    },

    async compress(sessionId, model) {
      // Detached like prompt: /summarize resolves only when the whole
      // compaction finishes, while the summary itself streams in through the
      // event stream (status busy → message deltas → idle). Completion has a
      // dedicated event so the renderer can toast + refresh even if the idle
      // frame raced; request-level failures have no event, so they surface
      // here as server.error with the session id.
      client.summarize(sessionId, model).then(
        () => emitEvent?.({ type: "session.compressed", sessionId }),
        (error) => {
          const detail = error instanceof Error ? error.message : String(error);
          emitEvent?.({
            type: "server.error",
            sessionId,
            message: `Compress failed for ${sessionId}: ${detail}`,
          });
        },
      );
    },

    async deleteSession(sessionId) {
      await client.deleteSession(sessionId);
      recorders.delete(sessionId);
      await removeFork(options.lineagePath, sessionId);
    },

    async deleteMessage(sessionId, messageId) {
      await client.deleteMessage(sessionId, messageId);
    },

    async renameSession(sessionId, title) {
      await client.renameSession(sessionId, title);
    },

    // opencode's stream is one-way (server → client notifications); nothing
    // it does waits on a reply from the host, so an interaction responder is
    // meaningless here and an attempt to use one is a programming error.
    async respondInteraction() {
      throw new Error("opencode has no server-originated interactions to answer");
    },

    async abort(sessionId) {
      await client.abort(sessionId);
    },

    async subscribe(handler) {
      abortController = new AbortController();
      const { signal } = abortController;
      const partKinds = new Map<string, "text" | "thinking">();
      let stopped = false;

      const emit = (event: AgentEvent) => {
        if (!stopped) {
          handler(event);
          // A settled run streams no more tool parts; drop the recorder so
          // its pinned snapshot contents don't accumulate per session. The
          // in-flight queue is self-contained and still lands on disk; a
          // later part (replay after reconnect) builds a fresh recorder that
          // rehydrates from that sidecar.
          if (event.type === "session.idle") recorders.delete(event.sessionId);
        }
      };
      emitEvent = emit;

      // v2 replaced the streaming event family outright (ordinal-scoped
      // text/reasoning, a tool lifecycle, execution frames) — a different
      // interpreter over the same normalized feed. v1 keeps the part-level
      // translator the descriptor drives.
      const translateV2 = createV2EventTranslator({
        descriptor,
        emit,
        recordToolFrame: feedRecorder,
      });
      const translate = (event: ServerEvent): void => {
        if (descriptor.protocol === "v2") {
          translateV2(event);
          return;
        }
        emitToAgentEvent(event, emit, partKinds, descriptor, onToolPart);
      };

      const connect = async () => {
        // One notice per outage, not one per 1s retry: the toast fires on the
        // streak's first failure, then a server.reconnected event on recovery
        // lets the renderer drop the toast and rebuild what the outage missed.
        let outageNotified = false;
        while (!stopped && !signal.aborted) {
          try {
            const base = options.baseUrl.replace(/\/$/, "");
            // v2 authenticates the event stream like every other route.
            const headers: Record<string, string> = {};
            if (descriptor.auth && options.password !== undefined) {
              headers.authorization = `Basic ${Buffer.from(
                `${descriptor.auth.username}:${options.password}`,
              ).toString("base64")}`;
            }
            const response = await fetch(`${base}${descriptor.endpoints.events}`, {
              signal,
              ...(Object.keys(headers).length > 0 ? { headers } : {}),
            });
            if (!response.ok || !response.body) {
              throw new Error(`event stream returned ${response.status}`);
            }
            if (outageNotified) {
              outageNotified = false;
              emit({ type: "server.reconnected" });
            }
            const reader = response.body.getReader();
            // Fresh parser per connection: a dropped stream can end mid-frame,
            // and the leftover half-frame would splice into the next
            // connection's first event and corrupt it.
            const parse = createSseParser();
            const decoder = new TextDecoder();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              for (const event of parse(decoder.decode(value, { stream: true }))) {
                translate(event);
              }
            }
          } catch (error) {
            if (signal.aborted || stopped) break;
            if (!outageNotified) {
              outageNotified = true;
              emit({
                type: "server.error",
                message: `Event stream lost, reconnecting: ${String(error)}`,
              });
            }
            await sleep(1000, signal);
          }
        }
      };

      void connect();
      return () => {
        stopped = true;
        if (emitEvent === emit) emitEvent = null;
        abortController?.abort();
      };
    },

    dispose() {
      abortController?.abort();
    },
  };
}

/** One named field of a part row; the key comes from the descriptor. */
function partField(part: OcPart, field: string): unknown {
  return (part as unknown as Record<string, unknown>)[field];
}

/** A part as it rides inside an SSE frame — the REST part shape plus timing. */
interface EventPart {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  time?: Record<string, unknown>;
}

/**
 * Frame-to-AgentEvent translation for v1's wire family. The names and shapes
 * come from the descriptor; the part-kind bookkeeping around them is state the
 * data cannot express: a delta is only trustworthy once the part's first
 * snapshot announced its kind, so unknown-part deltas are dropped rather than
 * guessed at (rendering reasoning as reply text is the worse failure).
 */
function emitToAgentEvent(
  event: { type: string; properties: Record<string, unknown> },
  emit: (event: AgentEvent) => void,
  partKinds: Map<string, "text" | "thinking">,
  descriptor: OpenCodeDescriptor,
  onToolPart?: (sessionId: string, messageId: string, part: unknown) => void,
): void {
  const props = event.properties;
  const { events } = descriptor;
  // The parser rejects a v1 descriptor without these sections, so a missing
  // one here is a programming error, not shape drift.
  if (!events.status || !events.partSnapshot || !events.partDelta) {
    throw new Error("opencode v1 descriptor is missing its streaming event sections");
  }
  const { status: statusEvent, partSnapshot, partDelta } = events;
  // Part timing keys differ per protocol (v1 start/end); the descriptor names them.
  const timeKeys = descriptor.partTimeKeys ?? { start: "start", end: "end" };
  const sessionId = () => firstString(props, events.sessionIdPaths);

  if (events.refresh.includes(event.type)) {
    const id = sessionId();
    if (id) emit({ type: "session.updated", sessionId: id });
    return;
  }
  // Fork creation replays message.updated for every copied message, so this
  // frame can NOT mean "a run started" — running state is driven by the
  // status/idle frames. Nothing else needs it: idle refreshes messages.
  if (events.ignore.includes(event.type)) return;

  if (events.idle.includes(event.type)) {
    const id = sessionId();
    if (id) emit({ type: "session.idle", sessionId: id });
    return;
  }

  if (event.type === events.error.name) {
    const detail = firstString(props, events.error.detailPaths);
    const message = detail ?? JSON.stringify(props.error ?? "unknown error");
    const id = sessionId();
    emit({
      type: "server.error",
      sessionId: id,
      message: id ? `${id}: ${message}` : message,
    });
    return;
  }

  if (event.type === statusEvent.name) {
    const id = sessionId();
    if (!id) return;
    const value = firstString(props, [statusEvent.valuePath]);
    if (value === statusEvent.busyValue) {
      emit({ type: "message.started", sessionId: id, messageId: "" });
    } else if (value === statusEvent.idleValue) {
      // The twin of the idle frame: handling both means a dropped frame of
      // either kind still finishes the run in UI.
      emit({ type: "session.idle", sessionId: id });
    }
    return;
  }

  if (event.type === partSnapshot.name) {
    const part = props[partSnapshot.partField] as EventPart | undefined;
    const partId = typeof part?.id === "string" ? part.id : null;
    // Register the part's kind from its snapshot BEFORE any delta handling —
    // older opencode builds put the text delta in this same frame.
    const kind = typeof part?.type === "string" ? partSnapshot.kinds[part.type] : undefined;
    if (partId && kind) partKinds.set(partId, kind);
    // Tool parts carry no text stream, but they are where file changes live:
    // hand the raw part to the recorder before anything else falls through.
    if (onToolPart && partId && !kind) {
      const id = sessionId();
      const messageId = firstString(props, events.messageIdPaths);
      if (id && messageId) onToolPart(id, messageId, part);
    }

    const id = sessionId();
    const messageId = firstString(props, events.messageIdPaths);
    // Forward the whole snapshot for text/reasoning parts: the renderer
    // reconciles its live buffer with it (self-heal after a dropped delta)
    // and reads the part's end time as the reasoning-finished signal.
    if (partId && id && messageId && kind) {
      const time = part?.time;
      const started = time?.[timeKeys.start];
      const ended = time?.[timeKeys.end];
      emit({
        type: "message.part",
        sessionId: id,
        messageId,
        partId,
        kind,
        text: typeof part?.text === "string" ? part.text : "",
        startedAt: typeof started === "number" ? started : null,
        endedAt: typeof ended === "number" ? ended : null,
      });
    }

    // Snapshot frames carry no delta on current builds; older ones put the
    // text delta here. A delta whose part kind is unknown is dropped.
    emitPartDelta(emit, partKinds, {
      delta: props[partSnapshot.deltaField],
      partId,
      sessionId: id,
      messageId,
    });
    return;
  }

  if (event.type === partDelta.name) {
    if (props[partDelta.field] !== partDelta.textFieldValue) return;
    emitPartDelta(emit, partKinds, {
      delta: props[partDelta.deltaField],
      partId: firstString(props, [partDelta.partIdField]),
      sessionId: sessionId(),
      messageId: firstString(props, events.messageIdPaths),
    });
  }
}

/** Shared tail of both delta-bearing frames: forward only what can be routed. */
function emitPartDelta(
  emit: (event: AgentEvent) => void,
  partKinds: Map<string, "text" | "thinking">,
  frame: {
    delta: unknown;
    partId: string | null;
    sessionId: string | null;
    messageId: string | null;
  },
): void {
  if (typeof frame.delta !== "string" || frame.delta === "") return;
  // Unknown part → drop and wait for the snapshot: a delta that arrives
  // before the app saw the part's first frame is guesswork, and the snapshot
  // that follows carries the full content anyway.
  const kind = frame.partId ? partKinds.get(frame.partId) : undefined;
  if (!frame.sessionId || !frame.messageId || !frame.partId || !kind) return;
  emit({
    type: "message.delta",
    sessionId: frame.sessionId,
    messageId: frame.messageId,
    partId: frame.partId,
    kind,
    delta: frame.delta,
  });
}

/** Timed sleep, abortable; exported for tests. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    // The timer path must drop its own listener: the reconnect loop calls
    // this every second during an outage, and listeners that only fire on
    // abort would otherwise pile up without bound on the same signal.
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
