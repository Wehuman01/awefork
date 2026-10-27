import { locale } from "./i18n";

const dictionary = {
  // ── digest dialog ─────────────────────────────────────────────────────
  title: { zh: "总结故事", en: "Digest stories" },
  hint: {
    zh: "勾选至多 4 条故事，把它们的记录汇总成一份总结。",
    en: "Pick up to 4 stories and summarize their records into one digest.",
  },
  count: { zh: "{n} / {max}", en: "{n} / {max}" },
  maxed: { zh: "最多 {max} 条故事", en: "At most {max} stories" },
  empty: {
    zh: "还没有打开的故事。先在画布上打开几条故事。",
    en: "No stories open yet. Open some stories on the canvas first.",
  },
  scopeLabel: { zh: "料源范围", en: "Source scope" },
  scopeStory: { zh: "整条故事", en: "Whole story" },
  scopeTurn: { zh: "仅当前轮", en: "Current turn only" },
  scopeStoryHint: {
    zh: "收录每条故事的全部轮次；过长时保留最近 20 轮，并在总结里注明省略。",
    en: "Every turn of each story; long stories keep the recent 20 turns, and the digest notes what was omitted.",
  },
  scopeTurnHint: {
    zh: "每条故事只收录你上次锁定的那一轮；没有锁定的取最新一轮。",
    en: "Only the turn each story had locked; stories without one contribute their latest turn.",
  },
  summaryModel: { zh: "总结模型", en: "Summary model" },
  lengthBrief: { zh: "精简", en: "Brief" },
  lengthStandard: { zh: "标准", en: "Standard" },
  lengthLabel: { zh: "总结长度", en: "Digest length" },
  start: { zh: "开始总结", en: "Start digest" },
  // ── digest reading panel ──────────────────────────────────────────────
  panelTitle: { zh: "故事总结", en: "Story digest" },
  summaryInput: { zh: "总结输入（含各故事原文）", en: "Digest input (story records)" },
  summaryTab: { zh: "总结", en: "Digest" },
  conversationTab: { zh: "总结分支对话", en: "Summary conversation" },
  version: { zh: "第 {n} 版", en: "Version {n}" },
  historical: { zh: "历史版本（只读）", en: "Earlier version (read-only)" },
  historicalLoading: {
    zh: "这一版总结的正文还没载入，打开它的分支即可查看。",
    en: "This version's text is not loaded yet — open its branch to read it.",
  },
  by: { zh: "由 {model} 总结 · 纳入 {n} 条故事", en: "By {model} · {n} stories included" },
  sources: { zh: "来源故事", en: "Source stories" },
  sourceMeta: { zh: "{turns} 轮 · {chars} 字", en: "{turns} turns · {chars} chars" },
  sourceOmitted: { zh: "省略 {n} 轮", en: "{n} turns omitted" },
  sourceScopeTurn: { zh: "仅一轮", en: "One turn" },
  openStory: { zh: "打开故事", en: "Open story" },
  running: { zh: "总结中…", en: "Summarizing…" },
  failed: {
    zh: "总结失败，来源故事仍可打开。",
    en: "Digest failed. The source stories are still available below.",
  },
  unknown: {
    zh: "总结状态待确认，可打开分支检查或重新总结。",
    en: "Digest status is unknown. Open its branch to check, or run it again.",
  },
  noText: {
    zh: "总结已结束，但未收到可展示的正文。",
    en: "Digest finished without readable text.",
  },
  resummarize: { zh: "重新总结", en: "Summarize again" },
} as const;

export function dt(
  key: keyof typeof dictionary,
  values: Record<string, string | number> = {},
): string {
  return dictionary[key][locale.value].replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
}
