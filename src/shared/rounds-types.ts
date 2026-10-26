import { type BackendId, isBackendId } from "./backend.js";
import type { ModelChoice, ParallelSummaryLength, PromptAttachment } from "./types.js";

/**
 * One persisted multi-model round (并行多模型轮次的落盘记录).
 *
 * The renderer's `ParallelGroup` is window-local memory: a round the user ran
 * yesterday is gone after a restart, and its sessions degrade into plain fork
 * cards on the canvas — the summary branch even reads as a hand-made ✂
 * empty-context fork, because that is what its lineage record says. This
 * record is the durable half of that group: the skeleton the canvas badges,
 * the source→summary links and the pane's reading view are drawn from.
 *
 * Live fields (target status, summary status) travel as their last known
 * value. A record written mid-run restores as "unknown", never as finished:
 * only an ending the app actually observed may read as one, and a group that
 * looks busy after a restart would block sends forever.
 *
 * Types and validation live here (renderer-safe, mirroring
 * overview-ledger-types.ts); the node-side file store is rounds-store.ts.
 */

/** Bounds that keep one record — and the sidecar — sane whatever arrives. */
const MAX_PROMPT = 64_000;
const MAX_TEXT = 200_000;
const MAX_TARGETS = 64;
const MAX_VERSIONS = 50;
const MAX_SOURCES = 64;
const MAX_BASELINE_IDS = 10_000;

export interface RoundTargetRecord {
  id: string;
  sessionId: string | null;
  model: ModelChoice | null;
  label: string;
  status: "preparing" | "running" | "done" | "failed" | "unknown";
  text: string;
  error: string | null;
  sentAt: number;
  baselineMessageIds: string[];
}

export interface RoundSummarySourceRecord {
  targetId: string;
  sessionId: string;
  label: string;
  baselineMessageIds: string[];
}

export interface RoundSummaryVersionRecord {
  version: number;
  sessionId: string;
  createdAt: number;
  sources: RoundSummarySourceRecord[];
}

export interface RoundRecord {
  id: string;
  backend: BackendId;
  directory: string;
  anchorSessionId: string;
  anchorMessageId: string | null;
  /** "none" = the round's forks carry no ancestor history (canvas ✂ drafts). */
  contextMode: "inherit" | "none";
  prompt: string;
  attachments: PromptAttachment[];
  inheritedTags: string[];
  createdAt: number;
  targets: RoundTargetRecord[];
  summarySessionId: string | null;
  summaryStatus: "waiting" | "running" | "done" | "failed" | "unknown" | "skipped";
  summaryText: string;
  summaryError: string | null;
  summarySourceIds: string[];
  summaryVersions: RoundSummaryVersionRecord[];
  settings: { model: ModelChoice | null; length: ParallelSummaryLength };
}

const TARGET_STATUSES = new Set(["preparing", "running", "done", "failed", "unknown"]);
const SUMMARY_STATUSES = new Set(["waiting", "running", "done", "failed", "unknown", "skipped"]);

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function nullableText(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, max)
    .map((item) => item.slice(0, 256));
}

function modelChoice(value: unknown): ModelChoice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.providerId !== "string" || typeof raw.modelId !== "string") return null;
  return {
    providerId: raw.providerId.slice(0, 256),
    modelId: raw.modelId.slice(0, 256),
    ...(typeof raw.variant === "string" ? { variant: raw.variant.slice(0, 64) } : {}),
  };
}

function attachments(value: unknown): PromptAttachment[] {
  if (!Array.isArray(value)) return [];
  const result: PromptAttachment[] = [];
  for (const item of value.slice(0, 32)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.mime !== "string" || typeof raw.filename !== "string") continue;
    if (typeof raw.dataUrl !== "string") continue;
    result.push({
      mime: raw.mime.slice(0, 256),
      filename: raw.filename.slice(0, 512),
      dataUrl: raw.dataUrl.slice(0, 8_000_000),
    });
  }
  return result;
}

function targetRecord(value: unknown): RoundTargetRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  // A target keeps its own id when it has one: the canvas badges and the
  // compare picks address targets by id, so an entry without one is dropped
  // rather than renumbered by position.
  if (typeof raw.id !== "string" || raw.id === "") return null;
  const sessionId =
    typeof raw.sessionId === "string" && raw.sessionId !== "" ? raw.sessionId : null;
  const status = TARGET_STATUSES.has(raw.status as string)
    ? (raw.status as RoundTargetRecord["status"])
    : "unknown";
  return {
    id: raw.id.slice(0, 128),
    sessionId,
    model: modelChoice(raw.model),
    label: text(raw.label, 256),
    status,
    text: text(raw.text, MAX_TEXT),
    error: nullableText(raw.error, 2_000),
    sentAt: finiteNumber(raw.sentAt, 0),
    baselineMessageIds: stringArray(raw.baselineMessageIds, MAX_BASELINE_IDS),
  };
}

function summarySource(value: unknown): RoundSummarySourceRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sessionId !== "string" || raw.sessionId === "") return null;
  return {
    targetId: text(raw.targetId, 128),
    sessionId: raw.sessionId,
    label: text(raw.label, 256),
    baselineMessageIds: stringArray(raw.baselineMessageIds, MAX_BASELINE_IDS),
  };
}

function summaryVersion(value: unknown): RoundSummaryVersionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sessionId !== "string" || raw.sessionId === "") return null;
  return {
    version: finiteNumber(raw.version, 1),
    sessionId: raw.sessionId,
    createdAt: finiteNumber(raw.createdAt, 0),
    sources: (Array.isArray(raw.sources) ? raw.sources : [])
      .flatMap((source) => {
        const record = summarySource(source);
        return record ? [record] : [];
      })
      .slice(0, MAX_SOURCES),
  };
}

/**
 * Validate one untrusted record (the sidecar is a file on disk; a hand-edited
 * or half-written entry must not crash the canvas). Returns null when the
 * record lacks the fields that identify a round — those cannot be defaulted.
 * Sub-entries that fail validation are dropped rather than failing the round.
 */
export function normalizeRoundRecord(value: unknown): RoundRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (!isBackendId(raw.backend)) return null;
  if (typeof raw.anchorSessionId !== "string" || raw.anchorSessionId === "") return null;
  if (typeof raw.prompt !== "string") return null;
  const length =
    raw.settings && typeof raw.settings === "object"
      ? (raw.settings as Record<string, unknown>).length
      : undefined;
  if (length !== "brief" && length !== "standard" && length !== "none") return null;
  return {
    id: raw.id.slice(0, 128),
    backend: raw.backend,
    directory: text(raw.directory, 1_024),
    anchorSessionId: raw.anchorSessionId,
    anchorMessageId: nullableText(raw.anchorMessageId, 256),
    contextMode: raw.contextMode === "none" ? "none" : "inherit",
    prompt: text(raw.prompt, MAX_PROMPT),
    attachments: attachments(raw.attachments),
    inheritedTags: stringArray(raw.inheritedTags, 64),
    createdAt: finiteNumber(raw.createdAt, 0),
    targets: (Array.isArray(raw.targets) ? raw.targets : [])
      .flatMap((target) => {
        const record = targetRecord(target);
        return record ? [record] : [];
      })
      .slice(0, MAX_TARGETS),
    summarySessionId: nullableText(raw.summarySessionId, 256),
    summaryStatus: SUMMARY_STATUSES.has(raw.summaryStatus as string)
      ? (raw.summaryStatus as RoundRecord["summaryStatus"])
      : "unknown",
    summaryText: text(raw.summaryText, MAX_TEXT),
    summaryError: nullableText(raw.summaryError, 2_000),
    summarySourceIds: stringArray(raw.summarySourceIds, MAX_TARGETS),
    summaryVersions: (Array.isArray(raw.summaryVersions) ? raw.summaryVersions : [])
      .flatMap((version) => {
        const record = summaryVersion(version);
        return record ? [record] : [];
      })
      .slice(0, MAX_VERSIONS),
    settings: {
      model: modelChoice((raw.settings as Record<string, unknown> | undefined)?.model),
      length,
    },
  };
}
