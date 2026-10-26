import type { RoundRecord } from "../../shared/rounds-types.js";
import type { ParallelGroup, ParallelTarget } from "./parallel-groups.js";

/**
 * The bridge between the renderer's window-local `ParallelGroup` and the
 * persisted `RoundRecord` the main process keeps in rounds.json.
 *
 * The mapping is deliberately lossy in one direction: live fields that only
 * mean something while a run is in flight (a target's "running", a summary's
 * "waiting") restore as "unknown". A restart cannot know how an interrupted
 * run ended, and a group that restored as busy would block every send into
 * it — so only endings the app actually observed survive as endings.
 */

/** Project one live group into its durable record (deep-copied, no live refs). */
export function roundRecordFromGroup(group: ParallelGroup): RoundRecord {
  return {
    id: group.id,
    backend: group.backend,
    directory: group.directory,
    anchorSessionId: group.anchorSessionId,
    anchorMessageId: group.anchorMessageId,
    contextMode: group.contextMode,
    prompt: group.prompt,
    attachments: group.attachments.map((attachment) => ({ ...attachment })),
    inheritedTags: [...group.inheritedTags],
    createdAt: group.createdAt,
    targets: group.targets.map((target) => ({
      id: target.id,
      sessionId: target.sessionId,
      model: target.model ? { ...target.model } : null,
      label: target.label,
      status: target.status,
      text: target.text,
      error: target.error,
      sentAt: target.sentAt,
      baselineMessageIds: [...target.baselineMessageIds],
    })),
    summarySessionId: group.summarySessionId,
    summaryStatus: group.summaryStatus,
    summaryText: group.summaryText,
    summaryError: group.summaryError,
    summarySourceIds: [...group.summarySourceIds],
    summaryVersions: group.summaryVersions.map((version) => ({
      version: version.version,
      sessionId: version.sessionId,
      createdAt: version.createdAt,
      sources: version.sources.map((source) => ({
        targetId: source.targetId,
        sessionId: source.sessionId,
        label: source.label,
        baselineMessageIds: [...source.baselineMessageIds],
      })),
    })),
    settings: {
      model: group.settings.model ? { ...group.settings.model } : null,
      length: group.settings.length,
    },
  };
}

/** Rebuild a live group from a persisted record, sanitizing in-flight state. */
export function groupFromRoundRecord(record: RoundRecord): ParallelGroup {
  return {
    id: record.id,
    backend: record.backend,
    directory: record.directory,
    anchorSessionId: record.anchorSessionId,
    anchorMessageId: record.anchorMessageId,
    contextMode: record.contextMode,
    prompt: record.prompt,
    attachments: record.attachments.map((attachment) => ({ ...attachment })),
    inheritedTags: [...record.inheritedTags],
    createdAt: record.createdAt,
    targets: record.targets.map(restoreTarget),
    summarySessionId: record.summarySessionId,
    summaryStatus:
      record.summaryStatus === "waiting" || record.summaryStatus === "running"
        ? "unknown"
        : record.summaryStatus,
    summaryText: record.summaryText,
    summaryError: record.summaryError,
    summarySourceIds: [...record.summarySourceIds],
    summaryVersions: record.summaryVersions.map((version) => ({
      version: version.version,
      sessionId: version.sessionId,
      createdAt: version.createdAt,
      sources: version.sources.map((source) => ({
        targetId: source.targetId,
        sessionId: source.sessionId,
        label: source.label,
        baselineMessageIds: [...source.baselineMessageIds],
      })),
    })),
    settings: {
      model: record.settings.model ? { ...record.settings.model } : null,
      length: record.settings.length,
    },
  };
}

function restoreTarget(target: RoundRecord["targets"][number]): ParallelTarget {
  return {
    id: target.id,
    sessionId: target.sessionId,
    model: target.model ? { ...target.model } : null,
    label: target.label,
    // "preparing"/"running" describe a run this window was watching; after a
    // restart nobody watched it, so the honest answer is "unknown" — which
    // the panel renders with a retry, and which never reads as busy.
    status:
      target.status === "preparing" || target.status === "running" ? "unknown" : target.status,
    text: target.text,
    error: target.error,
    sentAt: target.sentAt,
    baselineMessageIds: [...target.baselineMessageIds],
  };
}
