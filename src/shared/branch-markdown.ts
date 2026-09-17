/**
 * Branch → Markdown export, shared so tests can pin the exact document shape.
 *
 * One H1 for the branch, a blockquote line with export metadata, then one H2
 * per turn carrying the metadata the canvas card footer shows (model, 档位,
 * duration, output tokens, tools, failure) plus the full prompt and reply.
 * The reply is embedded verbatim — it is already markdown — so only the
 * prompt gets fenced, with a fence at least one backtick longer than the
 * longest run inside it (4 minimum) so embedded code blocks can't close it.
 */

/** One turn's export payload; all display formatting happens in the builder. */
export interface BranchMarkdownTurn {
  /** First line of the prompt, as shown on the canvas card. */
  title: string;
  /** Full prompt body; falls back to the title when empty. */
  prompt: string;
  /** The turn's assistant text, already joined; empty for tool-only turns. */
  reply: string;
  toolNames: string[];
  /** Model id that wrote the last reply; null when unreported. */
  model: string | null;
  /** Reasoning-effort variant in effect; null = the model's default. */
  variant: string | null;
  /** Last reply's completion minus the prompt's creation; null when unfinished. */
  durationMs: number | null;
  /** Output tokens summed across the turn's replies; 0 when unreported. */
  outputTokens: number;
  /** Why the turn's run failed; null for successful runs. */
  error: string | null;
}

export interface BranchMarkdownInput {
  /** Branch title: the tip session's title. */
  title: string;
  /** Export timestamp (epoch ms), rendered in local time. */
  exportedAt: number;
  turns: BranchMarkdownTurn[];
}

/** Compact render of a run's wall time, same semantics as the renderer's. */
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m${restSeconds.toString().padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${(minutes % 60).toString().padStart(2, "0")}m`;
}

/** Compact render of an output-token count: 830 tok / 12.4k tok. */
function formatTokens(count: number): string {
  if (count < 1000) return `${count} tok`;
  return `${(count / 1000).toFixed(1)}k tok`;
}

/** Local "YYYY-MM-DD HH:mm" — hand-built so the output is deterministic. */
function formatLocalTime(epochMs: number): string {
  const at = new Date(epochMs);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * A fence that no line of `content` can close: one backtick longer than the
 * longest backtick run inside it, 4 minimum so a lone ``` line stays inside.
 */
function fenceFor(content: string): string {
  let longest = 3;
  for (const run of content.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  return "`".repeat(longest + 1);
}

function turnSection(index: number, turn: BranchMarkdownTurn): string {
  const lines: string[] = [`## ${index}. ${turn.title || "(未命名回合)"}`, ""];
  const meta: string[] = [];
  if (turn.model) {
    meta.push(turn.variant ? `模型：${turn.model}（${turn.variant} 档）` : `模型：${turn.model}`);
  }
  const usage: string[] = [];
  if (turn.durationMs !== null) usage.push(`耗时 ${formatDuration(turn.durationMs)}`);
  if (turn.outputTokens > 0) usage.push(`输出 ${formatTokens(turn.outputTokens)}`);
  if (usage.length > 0) meta.push(usage.join(" · "));
  if (turn.toolNames.length > 0) meta.push(`工具：${turn.toolNames.join("、")}`);
  lines.push(...meta.map((entry) => `- ${entry}`));
  if (turn.error) lines.push(`- ⚠ 失败：${turn.error}`);
  if (meta.length > 0 || turn.error) lines.push("");

  const prompt = turn.prompt || turn.title;
  if (prompt) {
    const fence = fenceFor(prompt);
    lines.push("**提问**", "", fence, prompt, fence, "");
  }
  if (turn.reply) {
    lines.push("**回复**", "", turn.reply, "");
  } else if (turn.toolNames.length > 0 && !turn.error) {
    lines.push("*(无文本回复)*", "");
  }
  return lines.join("\n");
}

export function buildBranchMarkdown(input: BranchMarkdownInput): string {
  const totalTokens = input.turns.reduce((sum, turn) => sum + turn.outputTokens, 0);
  const header = [
    `# ${input.title || "awefork 分支"}`,
    "",
    `> 导出于 ${formatLocalTime(input.exportedAt)} · ${input.turns.length} 个回合 · 输出 ${formatTokens(totalTokens)}`,
    "",
  ];
  if (input.turns.length === 0) return header.join("\n");
  // trimEnd + explicit blank lines around the rule: a `---` hugging the last
  // reply line would turn that line into a setext heading.
  const body = input.turns.map((turn, i) => turnSection(i + 1, turn).trimEnd());
  return `${header.join("\n")}\n${body.join("\n\n---\n\n")}\n`;
}
