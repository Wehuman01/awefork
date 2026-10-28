/**
 * Status-panel dictionary: zh/en entries for every user-visible string the
 * diagnostics panel and its top-bar badge produce.
 *
 * Merged into i18n.ts's DICT at module load, so lookups go through that
 * file's single `t()` (same `{name}` interpolation and unknown-key
 * passthrough semantics).
 */
type Entry = { zh: string; en: string };

export const dict: Record<string, Entry> = {
  // ── top-bar status entry ─────────────────────────────────────────────
  "status.open": { zh: "查看后台日志", en: "Open background log" },
  "status.unseenErrors": {
    zh: "{n} 条未读的后台报错",
    en: "{n} unread background error(s)",
  },

  // ── panel chrome ─────────────────────────────────────────────────────
  "status.head": { zh: "后台日志 · {n} 条", en: "Background log · {n}" },
  "status.subtitle": {
    zh: "主进程后台命令的输出——非终端启动时，这里的报错是唯一能看到它们的地方。",
    en: "Output of the main process's background commands — without a terminal launch, this panel is the only place these errors surface.",
  },
  "status.empty": {
    zh: "暂无记录。出现后台报错时会显示在这里。",
    en: "Nothing yet. Background errors show up here.",
  },
  "status.close": { zh: "关闭", en: "Close" },

  // ── panel actions ────────────────────────────────────────────────────
  "status.copy": { zh: "复制全部", en: "Copy all" },
  "status.copied": { zh: "已复制", en: "Copied" },
  "status.save": { zh: "保存到文件", en: "Save to file" },
  "status.clear": { zh: "清空", en: "Clear" },

  // ── row rendering ────────────────────────────────────────────────────
  "status.levelError": { zh: "错误", en: "error" },
  "status.levelWarn": { zh: "警告", en: "warning" },
  "status.expand": { zh: "展开全文", en: "Expand full text" },
};
