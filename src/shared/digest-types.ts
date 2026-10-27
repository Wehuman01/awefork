import { type BackendId, isBackendId } from "./backend.js";
import type { ModelChoice } from "./types.js";

/**
 * One persisted after-the-fact digest (多故事事后总结的落盘记录).
 *
 * A digest is the retroactive sibling of a multi-model round: instead of
 * forking one prompt into several models, it summarizes up to four stories
 * the user already ran. Its summary session is a ✂ empty-context fork on
 * the first story's tree, so the canvas draws it with a ✦ card and the
 * pane reads it as a digest — which is what this record makes durable
 * across restarts, exactly like RoundRecord does for rounds.
 *
 * Types and validation live here (renderer-safe); the node-side file store
 * is digest-store.ts.
 */

/** Bounds that keep one record — and the sidecar — sane whatever arrives. */
const MAX_SOURCES = 4;
const MAX_VERSIONS = 20;
const MAX_TITLE = 256;
const MAX_TEXT = 200_000;

/** What each source story contributed: its whole record, or one turn. */
export type DigestScope = "story" | "turn";

export interface DigestStorySource {
  /** Session the story's chain ended on when the digest ran (the parked tip). */
  sessionId: string;
  /** Story root — where a jump from the digest card lands. */
  storyRootId: string;
  /** Story title at digest time; the label every list shows. */
  title: string;
  /** The locked turn a "turn" scope read; null for a "story" scope. */
  turnMessageId: string | null;
  /** Turns included (1 for a "turn" scope). */
  turnCount: number;
  /** Turns dropped from the head to fit the budget; 0 = nothing omitted. */
  omittedTurns: number;
  /** Characters of story text included. */
  chars: number;
}

export interface DigestVersion {
  version: number;
  sessionId: string;
  createdAt: number;
  scope: DigestScope;
  sources: DigestStorySource[];
}

/**
 * The digest's live and durable state share one shape. Unlike a round, a
 * digest has no in-flight target states — only the summary run itself —
 * so the restore sanitization is a single field (a run nobody watched
 * reads as "unknown", never as finished).
 */
export interface DigestGroup {
  id: string;
  backend: BackendId;
  directory: string;
  /** First source story: the digest's fork base and canvas home. */
  anchorSessionId: string;
  /** Message the summary fork was cut at; null = the anchor's tip. */
  anchorMessageId: string | null;
  createdAt: number;
  scope: DigestScope;
  sources: DigestStorySource[];
  summarySessionId: string | null;
  status: "running" | "done" | "failed" | "unknown";
  text: string;
  error: string | null;
  versions: DigestVersion[];
  settings: { model: ModelChoice | null; length: "brief" | "standard" };
}

const SCOPES = new Set(["story", "turn"]);
const STATUSES = new Set(["running", "done", "failed", "unknown"]);

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function nullableText(value: unknown, max: number): string | null {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function storySource(value: unknown): DigestStorySource | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sessionId !== "string" || raw.sessionId === "") return null;
  if (typeof raw.storyRootId !== "string" || raw.storyRootId === "") return null;
  return {
    sessionId: raw.sessionId.slice(0, 256),
    storyRootId: raw.storyRootId.slice(0, 256),
    title: text(raw.title, MAX_TITLE),
    turnMessageId: nullableText(raw.turnMessageId, 256),
    turnCount: finiteNumber(raw.turnCount, 0),
    omittedTurns: finiteNumber(raw.omittedTurns, 0),
    chars: finiteNumber(raw.chars, 0),
  };
}

function version(value: unknown): DigestVersion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sessionId !== "string" || raw.sessionId === "") return null;
  return {
    version: finiteNumber(raw.version, 1),
    sessionId: raw.sessionId.slice(0, 256),
    createdAt: finiteNumber(raw.createdAt, 0),
    scope: raw.scope === "turn" ? "turn" : "story",
    sources: (Array.isArray(raw.sources) ? raw.sources : [])
      .flatMap((source) => {
        const record = storySource(source);
        return record ? [record] : [];
      })
      .slice(0, MAX_SOURCES),
  };
}

/**
 * The digest as a restart sees it: the durable record, with a run nobody
 * watched reading as "unknown" rather than finished. A digest that
 * restored as busy would block every re-summary forever, and only an
 * ending the app actually observed may read as one — the same rule the
 * rounds restore applies.
 */
export function restoreDigestGroup(group: DigestGroup): DigestGroup {
  return group.status === "running" ? { ...group, status: "unknown" } : group;
}

/**
 * Validate one untrusted digest (the sidecar is a file on disk; a hand-edited
 * or half-written entry must not crash the canvas). Returns null when the
 * record lacks the fields that identify a digest — those cannot be
 * defaulted. Sub-entries that fail validation are dropped rather than
 * failing the digest.
 */
export function normalizeDigestGroup(value: unknown): DigestGroup | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (!isBackendId(raw.backend)) return null;
  if (typeof raw.anchorSessionId !== "string" || raw.anchorSessionId === "") return null;
  const length =
    raw.settings && typeof raw.settings === "object"
      ? (raw.settings as Record<string, unknown>).length
      : undefined;
  if (length !== "brief" && length !== "standard") return null;
  return {
    id: raw.id.slice(0, 128),
    backend: raw.backend,
    directory: text(raw.directory, 1_024),
    anchorSessionId: raw.anchorSessionId,
    anchorMessageId: nullableText(raw.anchorMessageId, 256),
    createdAt: finiteNumber(raw.createdAt, 0),
    scope: raw.scope === "turn" ? "turn" : "story",
    sources: (Array.isArray(raw.sources) ? raw.sources : [])
      .flatMap((source) => {
        const record = storySource(source);
        return record ? [record] : [];
      })
      .slice(0, MAX_SOURCES),
    summarySessionId: nullableText(raw.summarySessionId, 256),
    status: STATUSES.has(raw.status as string) ? (raw.status as DigestGroup["status"]) : "unknown",
    text: text(raw.text, MAX_TEXT),
    error: nullableText(raw.error, 2_000),
    versions: (Array.isArray(raw.versions) ? raw.versions : [])
      .flatMap((item) => {
        const record = version(item);
        return record ? [record] : [];
      })
      .slice(0, MAX_VERSIONS),
    settings: {
      model: modelChoice((raw.settings as Record<string, unknown> | undefined)?.model),
      length,
    },
  };
}
