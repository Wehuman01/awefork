import {
  type AgentTaskToolFact,
  firstNumber,
  firstString,
  type OpenCodeDescriptor,
  readPath,
} from "./agent-descriptor.js";
import type { SubagentCall } from "./types.js";

const TASK_HEAD = /^<task\b[^>]*>\s*<task_result>\s*/;
const TASK_TAIL = /\s*<\/task_result>\s*<\/task>\s*$/;
const TASK_HEAD_ID = /^<task\b[^>]*\bid="([^"]+)"/;

export function taskCallsOf(
  parts: readonly unknown[],
  toolPart: OpenCodeDescriptor["messages"]["parts"]["tool"],
): SubagentCall[] {
  const fact = toolPart.task;
  if (!fact) return [];
  const calls: SubagentCall[] = [];
  for (const part of parts) {
    if (firstString(part, ["type"]) !== toolPart.type) continue;
    const partId = readPath(part, "id");
    if (typeof partId !== "string") continue;
    const tool = firstString(part, [toolPart.nameField]) ?? toolPart.fallbackName;
    const call = subagentCallOf(part, partId, tool, fact);
    if (call) calls.push(call);
  }
  return calls;
}

export function subagentCallOf(
  part: unknown,
  partId: string,
  tool: string,
  fact: AgentTaskToolFact,
): SubagentCall | null {
  if (tool !== fact.name) return null;
  const rawStatus = readPath(part, fact.statusPath);
  const status: SubagentCall["status"] =
    rawStatus === "pending" ||
    rawStatus === "running" ||
    rawStatus === "completed" ||
    rawStatus === "error"
      ? rawStatus
      : "running";
  let result = stringOrNull(readPath(part, fact.resultPath));
  let childSessionId = firstString(part, fact.childSessionIdPaths);
  if (result !== null) {
    childSessionId ??= result.match(TASK_HEAD_ID)?.[1] ?? null;
    result = result.replace(TASK_HEAD, "").replace(TASK_TAIL, "").trim();
  }
  if (status === "error") result = firstString(part, [fact.errorPath]) ?? result;
  return {
    partId,
    tool,
    agent: firstString(part, [fact.agentPath]),
    title: firstString(part, [fact.titlePath]),
    prompt: firstString(part, [fact.promptPath]),
    status,
    result,
    childSessionId,
    // Live feed fields: the translator fills these as the subagent works;
    // a snapshot read off the wire has neither.
    action: null,
    toolCount: 0,
    modelId: firstString(part, fact.modelIdPaths),
    startedAt: firstNumber(part, [fact.startedAtPath]),
    endedAt: firstNumber(part, [fact.endedAtPath]),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
