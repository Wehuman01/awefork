/**
 * Dictionary for the canvas session overview (画布会话总览): the trigger bar
 * above the canvas, its floating panel, and the row/summary states. Same shape
 * as the other i18n-*.ts fragments — flat `zh`/`en` entries merged into the one
 * `t()` lookup by i18n.ts.
 */
export const dict: Record<string, { zh: string; en: string }> = {
  // ── trigger bar ─────────────────────────────────────────────────────────
  "overview.label": { zh: "会话总览", en: "Session overview" },
  "overview.running": { zh: "运行中", en: "Running" },
  "overview.waiting": { zh: "等你处理", en: "Needs you" },
  "overview.unread": { zh: "新结果", en: "New results" },
  "overview.expand": { zh: "展开会话总览", en: "Expand the session overview" },
  "overview.collapse": { zh: "收起会话总览", en: "Collapse the session overview" },
  "overview.runningCount": { zh: "运行中 {n}", en: "Running {n}" },
  "overview.waitingCount": { zh: "等你处理 {n}", en: "Needs you {n}" },
  "overview.unreadCount": { zh: "新结果 {n}", en: "New results {n}" },

  // ── panel header / controls ─────────────────────────────────────────────
  "overview.scope": { zh: "全部 Agent · 全部项目", en: "All agents · all projects" },
  "overview.close": { zh: "关闭会话总览", en: "Close the session overview" },
  "overview.searchLabel": { zh: "搜索会话", en: "Search sessions" },
  "overview.searchPlaceholder": {
    zh: "搜索会话、项目或模型…",
    en: "Search sessions, projects or models…",
  },
  "overview.filterStatus": { zh: "筛选会话状态", en: "Filter by session status" },
  "overview.filterAgent": { zh: "筛选 Agent", en: "Filter by agent" },
  "overview.allAgents": { zh: "全部 Agent", en: "All agents" },
  "overview.tabAll": { zh: "全部", en: "All" },
  "overview.colSession": { zh: "会话 / 项目", en: "Session / project" },
  "overview.colStatus": { zh: "状态", en: "Status" },
  "overview.colActivity": { zh: "最近活动", en: "Recent activity" },

  // ── status labels ───────────────────────────────────────────────────────
  "overview.status.waiting": { zh: "等你处理", en: "Needs you" },
  "overview.status.unread": { zh: "新结果", en: "New result" },
  "overview.status.running": { zh: "运行中", en: "Running" },
  "overview.status.unknown": { zh: "状态未知", en: "Unknown" },
  "overview.status.failed": { zh: "失败", en: "Failed" },
  "overview.status.read": { zh: "已查看", en: "Seen" },
  "overview.status.idle": { zh: "空闲", en: "Idle" },

  // ── activity lines ──────────────────────────────────────────────────────
  "overview.activity.running": { zh: "正在运行", en: "Running now" },
  "overview.activity.waiting": { zh: "等待你的决定", en: "Waiting for your decision" },
  "overview.activity.unread": { zh: "本轮结束 · 结果未查看", en: "Run ended · result unseen" },
  "overview.activity.read": { zh: "本轮结束 · 已查看", en: "Run ended · seen" },
  "overview.activity.unknown": {
    zh: "没有可靠的运行状态",
    en: "Runtime state not confirmed",
  },
  "overview.activity.failed": { zh: "上一轮失败", en: "Last run failed" },
  "overview.activity.readFailed": { zh: "上一轮失败 · 已查看", en: "Last run failed · seen" },
  "overview.activity.idle": { zh: "空闲", en: "Idle" },
  "overview.current": { zh: "当前会话", en: "Current session" },

  // ── list ────────────────────────────────────────────────────────────────
  "overview.empty": { zh: "没有符合条件的会话", en: "No sessions match" },
  "overview.clearFilters": { zh: "清除筛选", en: "Clear filters" },
  "overview.selectRow": { zh: "选择这条会话", en: "Select this session" },
  "overview.selectAllVisible": { zh: "全选当前列表", en: "Select all listed" },
  "overview.markAllSeen": { zh: "全部标记已查看", en: "Mark all as seen" },
  "overview.selectedCount": { zh: "已选 {n} 项", en: "{n} selected" },
  "overview.clearSelection": { zh: "取消选择", en: "Clear selection" },
  "overview.remoteFailed": {
    zh: "{agents} 的会话列表暂时读不到",
    en: "Couldn't list sessions for {agents}",
  },
  "overview.remoteUpdated": {
    zh: "其他 Agent 列表更新于 {agents}",
    en: "Other agent lists updated {agents}",
  },

  // ── summary ─────────────────────────────────────────────────────────────
  "overview.summary": { zh: "会话摘要", en: "Session summary" },
  "overview.collapseSummary": { zh: "收起会话摘要", en: "Collapse the summary" },
  "overview.lastPrompt": { zh: "最近任务", en: "Last task" },
  "overview.lastReply": { zh: "最新回复", en: "Latest reply" },
  "overview.noPrompt": { zh: "这条会话还没有提问", en: "No prompt in this session yet" },
  "overview.noReply": { zh: "还没有回复", en: "No reply yet" },
  "overview.loadingSummary": { zh: "读取中…", en: "Loading…" },
  "overview.summaryFailed": { zh: "摘要读取失败", en: "Couldn't read the summary" },
  "overview.retrySummary": { zh: "重试读取", en: "Retry" },
  "overview.workingDir": { zh: "工作目录", en: "Working dir" },
  "overview.markSeen": { zh: "标记已查看", en: "Mark as seen" },
  "overview.jump": { zh: "跳转到会话", en: "Jump to session" },
  "overview.answerHint": { zh: "跳转后在会话里回答", en: "Jump to answer in the session" },
  "overview.askAllow": { zh: "允许本次", en: "Allow once" },
  "overview.askDeny": { zh: "拒绝", en: "Deny" },

  // ── footer + errors ─────────────────────────────────────────────────────
  "overview.footer": {
    zh: "单击看摘要 · ⌘点击多选 · ↑↓ 选择 · Enter 跳转 · Esc 收起",
    en: "Click for a summary · ⌘-click to multi-select · ↑↓ to move · Enter to jump · Esc closes",
  },
  "overview.jumpSwitchFailed": { zh: "无法切换到 {backend}", en: "Couldn't switch to {backend}" },
  "overview.jumpWindowFailed": {
    zh: "无法打开 {backend} 窗口：{error}",
    en: "Couldn't open the {backend} window: {error}",
  },
  "overview.jumpWindowMissing": {
    zh: "{backend} 窗口没有接手这次跳转，会话可能已关闭",
    en: "The {backend} window didn't take over the jump — its session may be gone",
  },
  "overview.jumpInterrupted": {
    zh: "会话跳转已中断，请重试",
    en: "Navigation interrupted. Try again.",
  },
  "overview.jumpRollbackFailed": {
    zh: "{error}；未能返回 {backend}：{reason}",
    en: "{error}; couldn't return to {backend}: {reason}",
  },
  "overview.jumpMissing": {
    zh: "找不到这条会话，它可能已被删除或归档",
    en: "That session is gone — deleted or archived",
  },
  "overview.jumpLoadFailed": {
    zh: "读取会话失败：{error}",
    en: "Couldn't load the session: {error}",
  },
  "overview.markSeenLabel": { zh: "标记会话结果已查看", en: "Mark session result as seen" },
};
