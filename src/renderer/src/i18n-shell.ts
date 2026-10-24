/**
 * Shell-surface dictionary (app.vue, history.ts, attachments.ts, format.ts,
 * top-bar.vue), kept in its own module so the i18n layer in i18n.ts stays
 * focused on the interaction/opencode feature surface. Keys here use the
 * app./history./attachments./format./topbar. prefixes and are merged into
 * the `t()` lookup; zh strings are byte-identical to the originals they
 * replaced.
 */
export const dict: Record<string, { zh: string; en: string }> = {
  // ── app.vue (panel handles, undo toasts) ──────────────────────────────
  "app.dragHandle": {
    zh: "拖拽调宽 · 双击折叠/展开",
    en: "Drag to resize · double-click to collapse/expand",
  },
  "app.expandSidebar": { zh: "展开侧栏", en: "Expand sidebar" },
  "app.collapseSidebar": { zh: "折叠侧栏", en: "Collapse sidebar" },
  "app.expandContext": { zh: "展开右栏", en: "Expand right panel" },
  "app.collapseContext": { zh: "折叠右栏", en: "Collapse right panel" },
  "app.sessionDeleted": {
    zh: "已删除「{title}」（⌘/Ctrl+Z 或历史面板可撤销）",
    en: 'Deleted "{title}" (⌘/Ctrl+Z or the history panel can undo)',
  },
  "app.undoDeleteSession": { zh: "把会话放回来", en: "Put the session back" },
  "app.undo": { zh: "撤销", en: "Undo" },
  "app.tagDeleted": { zh: "已删除标签「{tag}」", en: 'Deleted tag "{tag}"' },
  "app.undoTagDelete": { zh: "把标签加回所有会话", en: "Add the tag back to all sessions" },

  // ── history.ts (undo/redo walk notices) ───────────────────────────────
  "history.locked": {
    zh: "「{label}」不可撤销，更早的操作已被锁定",
    en: '"{label}" is irreversible; earlier operations are locked',
  },
  "history.undoFailed": { zh: "撤销失败：{message}", en: "Undo failed: {message}" },
  "history.undone": { zh: "已撤销：{label}", en: "Undone: {label}" },
  "history.redoFailed": { zh: "重做失败：{message}", en: "Redo failed: {message}" },
  "history.redone": { zh: "已重做：{label}", en: "Redone: {label}" },

  // ── attachments.ts (staging notes + fallback names) ──────────────────
  "attachments.unsupported": {
    zh: "暂不支持 {name} 的格式",
    en: "{name} has an unsupported format",
  },
  "attachments.imageTooLarge": {
    zh: "{name} 超过 20 MB，未添加",
    en: "{name} exceeds 20 MB; not added",
  },
  "attachments.imageBatchTotal": {
    zh: "这批图片总量超过 40 MB，{name} 未添加",
    en: "This batch of images exceeds 40 MB total; {name} not added",
  },
  "attachments.extractFailed": {
    zh: "无法从 {name} 提取文本",
    en: "Could not extract text from {name}",
  },
  "attachments.noText": { zh: "{name} 中没有可提取的文本", en: "No extractable text in {name}" },
  "attachments.truncated": { zh: "{name} 超过 1 MB，已截断", en: "{name} exceeds 1 MB; truncated" },
  "attachments.imageName": { zh: "图片", en: "image" },
  "attachments.thisImage": { zh: "这张图片", en: "this image" },
  "attachments.docName": { zh: "文档", en: "document" },
  "attachments.thisFile": { zh: "该文件", en: "this file" },

  // ── format.ts (relative time) ────────────────────────────────────────
  "format.justNow": { zh: "刚刚", en: "just now" },
  "format.minutesAgo": { zh: "{n}分钟前", en: "{n} min ago" },
  "format.hoursAgo": { zh: "{n}小时前", en: "{n} h ago" },
  "format.daysAgo": { zh: "{n}天前", en: "{n} d ago" },
  "format.monthsAgo": { zh: "{n}个月前", en: "{n} mo ago" },

  // ── top-bar.vue ───────────────────────────────────────────────────────
  "topbar.brandSub": { zh: "分支工作台", en: "Branch Workbench" },
  "topbar.backends": { zh: "Agent 后端", en: "Agent backends" },
  "topbar.switchBackend": {
    zh: "切换 Agent 后端（当前 {label}）",
    en: "Switch agent backend (current {label})",
  },
  "topbar.connected": { zh: "{label} 已连接", en: "{label} connected" },
  "topbar.disconnected": { zh: "{label} 未连接", en: "{label} not connected" },
  "topbar.themeOn": { zh: "切换到深色模式", en: "Switch to dark mode" },
  "topbar.themeOff": { zh: "切换到明亮模式", en: "Switch to light mode" },

  // ── top-bar.vue (backend switch confirmation) ─────────────────────────
  "topbar.confirmKicker": { zh: "切换 Agent 后端", en: "Switch agent backend" },
  "topbar.confirmSwitchTitle": { zh: "切换到 {label}？", en: "Switch to {label}?" },
  "topbar.confirmSwitchPoint1": {
    zh: "当前会话属于 {current}，切换后将新建会话",
    en: "The open session belongs to {current}; switching starts a fresh one",
  },
  "topbar.confirmSwitchPoint2": {
    zh: "现有会话仍保留在历史记录中",
    en: "Existing sessions stay in the history",
  },
  "topbar.confirmOpenTitle": { zh: "打开 {label} 独立窗口？", en: "Open the {label} window?" },
  "topbar.confirmOpenPoint1": {
    zh: "将打开（或聚焦）{label} 的专属窗口",
    en: "Opens (or focuses) {label}'s dedicated window",
  },
  "topbar.confirmOpenPoint2": {
    zh: "当前窗口的会话不受影响",
    en: "This window's session is unaffected",
  },
  "topbar.confirmSwitch": { zh: "切换", en: "Switch" },
  "topbar.confirmOpen": { zh: "打开窗口", en: "Open window" },
  "topbar.confirmCancel": { zh: "取消", en: "Cancel" },
  "topbar.confirmEsc": { zh: "Esc 取消", en: "Esc to cancel" },
};
