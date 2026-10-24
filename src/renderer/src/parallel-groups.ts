import type { BackendId } from "../../shared/backend";
import type {
  ChatMessage,
  ModelChoice,
  ParallelSummaryLength,
  PromptAttachment,
} from "../../shared/types";

export interface ParallelSummarySettings {
  model: ModelChoice | null;
  /** "none" leaves the round's answers unsummarized. */
  length: ParallelSummaryLength;
}

export interface ParallelTarget {
  id: string;
  sessionId: string | null;
  model: ModelChoice | null;
  label: string;
  status: "preparing" | "running" | "done" | "failed" | "unknown";
  /** True between the user's stop click and the run actually settling. */
  stopping?: boolean;
  text: string;
  error: string | null;
  sentAt: number;
  baselineMessageIds: string[];
}

export interface ParallelSummarySource {
  targetId: string;
  sessionId: string;
  label: string;
  baselineMessageIds: string[];
}

export interface ParallelSummaryVersion {
  version: number;
  sessionId: string;
  createdAt: number;
  sources: ParallelSummarySource[];
}

/** A reading group references native sessions; it never changes their history. */
export interface ParallelGroup {
  id: string;
  backend: BackendId;
  directory: string;
  anchorSessionId: string;
  anchorMessageId: string | null;
  /** "none" forks the targets with no ancestor history (canvas ✂ drafts). */
  contextMode: "inherit" | "none";
  prompt: string;
  attachments: PromptAttachment[];
  inheritedTags: string[];
  createdAt: number;
  targets: ParallelTarget[];
  summarySessionId: string | null;
  /** "skipped" = the round asked for no summary; the panel offers one on demand. */
  summaryStatus: "waiting" | "running" | "done" | "failed" | "unknown" | "skipped";
  summaryText: string;
  summaryError: string | null;
  summarySourceIds: string[];
  summaryVersions: ParallelSummaryVersion[];
  settings: ParallelSummarySettings;
}

export function parallelGroupBusy(group: ParallelGroup): boolean {
  return (
    group.summaryStatus === "running" ||
    group.targets.some((target) => target.status === "preparing" || target.status === "running")
  );
}

/** Inspect the latest step of this request, never a completed intermediate tool step. */
export function parallelReply(
  messages: readonly ChatMessage[],
  prompt: string,
  baselineMessageIds: readonly string[] = [],
): { status: "done" | "failed" | "unknown"; text: string; error: string | null } {
  const baseline = new Set(baselineMessageIds);
  const userIndex = messages.findLastIndex(
    (message) => message.role === "user" && message.text === prompt && !baseline.has(message.id),
  );
  if (userIndex < 0) return { status: "unknown", text: "", error: null };
  const following = messages.slice(userIndex + 1);
  const nextUser = following.findIndex((message) => message.role === "user");
  const reply = (nextUser < 0 ? following : following.slice(0, nextUser))
    .filter((message) => message.role === "assistant")
    .at(-1);
  if (reply?.error) return { status: "failed", text: "", error: reply.error };
  if (!reply || reply.completedAt === null || reply.finish === "tool-calls") {
    return { status: "unknown", text: "", error: null };
  }
  return { status: reply.text.trim() ? "done" : "failed", text: reply.text.trim(), error: null };
}
