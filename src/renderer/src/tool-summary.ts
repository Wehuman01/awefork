/**
 * One-line summary of a settled turn's tool calls, following opencode's TUI:
 * the chips collapse into a single grouped count instead of a wall of
 * near-identical pills. codex labels carry a command preview after " · "
 * ("shell · rg login"), the other backends ship bare tool names ("read",
 * "edit") — grouping on the family before " · " folds a stack of shell runs
 * into "shell ×8". The full list rides along in the chip's title attribute.
 */

const SUMMARY_MAX_CHARS = 48;

export function toolSummary(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) {
    const family = name.split(" · ")[0]?.trim() || name;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  // A single call keeps its full label — there is nothing to fold, and codex's
  // command preview is the whole point of that one chip.
  if (names.length === 1) return names[0] ?? "";
  const line = [...counts]
    .map(([family, count]) => (count > 1 ? `${family} ×${count}` : family))
    .join(" · ");
  if (line.length <= SUMMARY_MAX_CHARS) return line;
  // Cut at a group boundary so the ellipsis never lands mid tool name.
  const cut = line.slice(0, SUMMARY_MAX_CHARS);
  const boundary = cut.lastIndexOf(" · ");
  return `${boundary > 0 ? cut.slice(0, boundary) : cut}…`;
}
