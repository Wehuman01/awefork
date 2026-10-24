import { locale } from "./i18n";

const dictionary = {
  summaryInput: { zh: "汇总输入（含各模型原文）", en: "Summary input (original answers)" },
  summaryTab: { zh: "本轮汇总", en: "Round summary" },
  conversationTab: { zh: "分支对话", en: "Conversation" },
  title: { zh: "本轮多模型", en: "This model round" },
  completed: { zh: "{done}/{total} 完成", en: "{done}/{total} complete" },
  prompt: { zh: "本轮问题", en: "Prompt" },
  attachments: { zh: "{n} 个附件", en: "{n} attachments" },
  summary: { zh: "回答汇总", en: "Summary" },
  version: { zh: "第 {n} 版", en: "Version {n}" },
  summaryBy: { zh: "由 {model} 汇总 · 纳入 {n} 份回答", en: "By {model} · {n} answers included" },
  pendingBy: { zh: "汇总模型：{model}", en: "Summary model: {model}" },
  sources: { zh: "各模型回答", en: "Model answers" },
  preparing: { zh: "准备中", en: "Preparing" },
  running: { zh: "回答中", en: "Answering" },
  done: { zh: "已完成", en: "Complete" },
  failed: { zh: "失败", en: "Failed" },
  unknown: { zh: "状态待确认", en: "Status unknown" },
  waiting: { zh: "等待回答", en: "Waiting for answers" },
  summarizing: { zh: "汇总中", en: "Summarizing" },
  partial: { zh: "部分完成", en: "Partly complete" },
  summaryReady: { zh: "汇总已就绪", en: "Summary ready" },
  waitingSummary: { zh: "等待汇总", en: "Ready to summarize" },
  notSummarized: { zh: "未汇总", en: "Not summarized" },
  skippedHint: {
    zh: "本轮选择不汇总；可随时把已完成的回答汇总成一份。",
    en: "This round asked for no summary; summarize the completed answers whenever you like.",
  },
  waitingHint: {
    zh: "回答完成后，汇总会显示在这里。",
    en: "The summary will appear here when answers are ready.",
  },
  summaryRunning: { zh: "正在汇总已完成的回答…", en: "Summarizing completed answers…" },
  summaryFailed: {
    zh: "本次汇总失败，已完成的原文仍可查看。",
    en: "Summary failed. Completed answers are still available below.",
  },
  summaryUnknown: {
    zh: "汇总状态待确认，可打开分支检查或重新汇总。",
    en: "Summary status is unknown. Open its branch to check, or try again.",
  },
  sourceUnknown: {
    zh: "尚未确认是否完成，可打开分支检查。",
    en: "Completion is unconfirmed. Open the branch to check.",
  },
  noAnswer: { zh: "还没有可展示的回答。", en: "No answer to show yet." },
  noSummaryText: {
    zh: "汇总已结束，但未收到可展示的正文。",
    en: "Summary finished without readable text.",
  },
  noSuccess: {
    zh: "还没有完成的回答，可检查失败分支后重试。",
    en: "No completed answers yet. Check the failed branches and retry.",
  },
  earlySummary: { zh: "先汇总已完成的回答", en: "Summarize completed answers now" },
  summarize: { zh: "汇总回答", en: "Summarize answers" },
  retrySummary: { zh: "重新汇总", en: "Retry summary" },
  stale: { zh: "有新回答，可更新汇总", en: "New answers available. Update the summary." },
  updateSummary: { zh: "更新汇总", en: "Update summary" },
  partialSummary: {
    zh: "汇总仅涵盖已完成的回答。",
    en: "This summary includes completed answers only.",
  },
  openBranch: { zh: "打开分支", en: "Open branch" },
  openSummary: { zh: "打开汇总分支", en: "Open summary branch" },
  retry: { zh: "重试", en: "Retry" },
  defaultVariant: { zh: "默认参数", en: "Default settings" },
  selectCompare: { zh: "选择 {model} 以对比", en: "Select {model} for comparison" },
  compareHint: { zh: "选两份已完成的回答并排对比", en: "Select two completed answers to compare" },
  compare: { zh: "并排对比（{n}/2）", en: "Compare ({n}/2)" },
} as const;

export function pt(
  key: keyof typeof dictionary,
  values: Record<string, string | number> = {},
): string {
  return dictionary[key][locale.value].replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
}
