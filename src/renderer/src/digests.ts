import type { DigestGroup, DigestStorySource, DigestVersion } from "../../shared/digest-types";

/**
 * The bridge between the renderer's window-local `DigestGroup` and the
 * durable record the main process keeps in digests.json.
 *
 * Unlike the rounds bridge the mapping is the identity — a digest has no
 * live-only fields — but the projection stays explicit for the same reason
 * rounds.ts exists: Electron IPC and the sidecar both want plain JSON, and
 * a Vue reactive proxy is not structured-cloneable, so every crossing of
 * that boundary goes through here.
 */

function sourceCopy(source: DigestStorySource): DigestStorySource {
  return { ...source };
}

function versionCopy(version: DigestVersion): DigestVersion {
  return { ...version, sources: version.sources.map(sourceCopy) };
}

/** Project one live group into its durable record (plain data, no live refs). */
export function digestRecordFromGroup(group: DigestGroup): DigestGroup {
  return {
    id: group.id,
    backend: group.backend,
    directory: group.directory,
    anchorSessionId: group.anchorSessionId,
    anchorMessageId: group.anchorMessageId,
    createdAt: group.createdAt,
    scope: group.scope,
    sources: group.sources.map(sourceCopy),
    summarySessionId: group.summarySessionId,
    status: group.status,
    text: group.text,
    error: group.error,
    versions: group.versions.map(versionCopy),
    settings: {
      model: group.settings.model ? { ...group.settings.model } : null,
      length: group.settings.length,
    },
  };
}
