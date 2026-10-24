import type { BackendId } from "../../shared/backend";
import type { ChatMessage } from "../../shared/types";

interface SessionLoad {
  generation: number;
  pendingGeneration: number;
  pending: Promise<ChatMessage[]> | null;
  queued: Promise<ChatMessage[]> | null;
}

/** Serialize one session's reads. A force refresh must start after the current read. */
export function createMessageLoader(context: {
  fetch: (backend: BackendId, sessionId: string) => Promise<ChatMessage[]>;
  publish: (backend: BackendId, sessionId: string, messages: ChatMessage[]) => void | Promise<void>;
}) {
  const sessions = new Map<string, SessionLoad>();

  function entryFor(backend: BackendId, sessionId: string): SessionLoad {
    const key = `${backend}:${sessionId}`;
    let entry = sessions.get(key);
    if (!entry) {
      entry = { generation: 0, pendingGeneration: 0, pending: null, queued: null };
      sessions.set(key, entry);
    }
    return entry;
  }

  function start(
    backend: BackendId,
    sessionId: string,
    entry: SessionLoad,
  ): Promise<ChatMessage[]> {
    const generation = entry.generation;
    entry.pendingGeneration = generation;
    const request: Promise<ChatMessage[]> = context
      .fetch(backend, sessionId)
      .then(async (messages) => {
        // A local send or deletion superseded the snapshot this request began with.
        if (generation === entry.generation) await context.publish(backend, sessionId, messages);
        return messages;
      })
      .finally(() => {
        if (entry.pending === request) entry.pending = null;
      });
    entry.pending = request;
    return request;
  }

  function load(backend: BackendId, sessionId: string, fresh = false): Promise<ChatMessage[]> {
    const entry = entryFor(backend, sessionId);
    if (entry.queued) return entry.queued;
    if (!entry.pending) return start(backend, sessionId, entry);
    if (!fresh && entry.pendingGeneration === entry.generation) return entry.pending;
    const restart = () => {
      entry.queued = null;
      return start(backend, sessionId, entry);
    };
    entry.queued = entry.pending.then(restart, restart);
    return entry.queued;
  }

  return {
    load,
    generation: (backend: BackendId, sessionId: string) => entryFor(backend, sessionId).generation,
    invalidate(backend: BackendId, sessionId: string): void {
      entryFor(backend, sessionId).generation += 1;
    },
  };
}

/** Coalesce independent IPC replies into one renderer update, before resolving their reads. */
export function createMessagePublisher(context: {
  apply: (backend: BackendId, sessionId: string, messages: ChatMessage[]) => void;
  generation: (backend: BackendId, sessionId: string) => number;
}) {
  let pending: Array<() => void> = [];
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = null;
    timer = null;
    const jobs = pending;
    pending = [];
    for (const apply of jobs) apply();
  }

  return (backend: BackendId, sessionId: string, messages: ChatMessage[]): void | Promise<void> => {
    // Non-DOM hosts have no animation clock. Keep their publication synchronous.
    if (typeof requestAnimationFrame !== "function")
      return context.apply(backend, sessionId, messages);
    const generation = context.generation(backend, sessionId);
    return new Promise<void>((resolve, reject) => {
      pending.push(() => {
        try {
          if (generation === context.generation(backend, sessionId))
            context.apply(backend, sessionId, messages);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      if (timer === null) {
        // A minimized window can stop rAF. Completion must still make progress.
        timer = setTimeout(flush, 32);
        frame = requestAnimationFrame(flush);
      }
    });
  };
}

/** Preserve the cached array only when every message's display and run state agree. */
export function sameMessages(
  before: readonly ChatMessage[],
  after: readonly ChatMessage[],
): boolean {
  if (before === after) return true;
  if (before.length !== after.length) return false;
  return before.every((a, i) => {
    const b = after[i];
    return (
      b !== undefined &&
      a.id === b.id &&
      a.role === b.role &&
      a.text === b.text &&
      a.thinking === b.thinking &&
      a.modelId === b.modelId &&
      a.providerId === b.providerId &&
      a.variant === b.variant &&
      a.createdAt === b.createdAt &&
      a.completedAt === b.completedAt &&
      a.finish === b.finish &&
      a.outputTokens === b.outputTokens &&
      a.contextTokens === b.contextTokens &&
      a.contextWindow === b.contextWindow &&
      a.error === b.error &&
      a.compaction === b.compaction &&
      a.toolNames.length === b.toolNames.length &&
      a.toolNames.every((name, j) => name === b.toolNames[j]) &&
      a.attachmentNames.length === b.attachmentNames.length &&
      a.attachmentNames.every((name, j) => name === b.attachmentNames[j])
    );
  });
}
