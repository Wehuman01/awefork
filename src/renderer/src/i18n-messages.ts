/**
 * String dictionary for the chat/compare/canvas component surface, split out
 * of i18n.ts so that file keeps its interaction-dialog core stable; merged
 * into i18n.ts's DICT at load, so call sites use its single
 * `t("prefix.key", vars)` and the unknown-key passthrough for
 * backend-shipped prose keeps working.
 */
export const dict: Record<string, { zh: string; en: string }> = {
  // ── message-list.vue ───────────────────────────────────────────────────
  "msg.compactionBanner": {
    zh: "以上对话已压缩为摘要 — 历史仍保留，后续对话只携带摘要与最近几轮",
    en: "Earlier conversation was compacted into a summary — history is kept, later turns carry only the summary plus the most recent turns",
  },
  "msg.copied": { zh: "已复制", en: "Copied" },
  "msg.copyReply": { zh: "复制这条回复", en: "Copy this reply" },
  "msg.runFailed": { zh: "⚠ 运行失败：{error}", en: "⚠ Run failed: {error}" },
  "msg.retryTitle": {
    zh: "重跑这个回合（预填原文，可先换模型/档位）",
    en: "Rerun this turn (original prompt pre-filled; you can switch model/effort first)",
  },
  "msg.retryButton": { zh: "↻ 换模型重跑", en: "↻ Rerun with another model" },
  "msg.jumpToBottom": { zh: "回到最新", en: "Jump to the newest" },
  "msg.openPathFailed": { zh: "路径打不开", en: "Could not open the path" },

  // ── code-block.vue ─────────────────────────────────────────────────────
  "code.copied": { zh: "✓ 已复制", en: "✓ Copied" },
  "code.copy": { zh: "⧉ 复制", en: "⧉ Copy" },

  // ── cmp-cell.vue ───────────────────────────────────────────────────────
  "cmp.flagUp": { zh: "上游", en: "Upstream" },
  "cmp.flagInherited": { zh: "继承", en: "Inherited" },
  "cmp.inheritedTitle": {
    zh: "母本复制来的回合 — 这条分支的起点上下文",
    en: "Turn copied from the parent branch — this branch's starting context",
  },
  "cmp.upstreamTitle": {
    zh: "上游分支的回合 — 通往这条分支的路上经过的岔路",
    en: "A turn from an upstream branch — a fork passed on the way to this one",
  },
  "cmp.failed": { zh: "⚠ 失败", en: "⚠ Failed" },
  "cmp.leftEnd": { zh: "左栏已到尾", en: "Left column has no more turns" },
  "cmp.rightEnd": { zh: "右栏已到尾", en: "Right column has no more turns" },
  "cmp.toolOnly": { zh: "(工具调用，无文本回复)", en: "(tool calls, no text reply)" },
  "cmp.noText": { zh: "(无文本回复)", en: "(no text reply)" },

  // ── session-canvas.vue ─────────────────────────────────────────────────
  "canvas.tabsLabel": { zh: "画板故事标签", en: "Canvas story tabs" },
  "canvas.tabClose": { zh: "关闭标签", en: "Close tab" },
  "canvas.tabNewSession": { zh: "在当前文件夹新建会话", en: "New session in this folder" },
  "canvas.tabBlank": { zh: "新画板", en: "New canvas" },
  "canvas.deleteTurnTitle": {
    zh: "删除这个回合（更早的对话保留）",
    en: "Delete this turn (earlier conversation stays)",
  },
  "canvas.deleteSessionTitle": {
    zh: "删除这个会话（整条分支故事）",
    en: "Delete this session (the whole branch story)",
  },
  "canvas.markTitle": { zh: "标记为关键对话", en: "Mark as key turn" },
  "canvas.unmarkTitle": { zh: "取消关键标记", en: "Unmark key turn" },
  "canvas.continueBranchHint": { zh: "继续这个分支", en: "Continue this branch" },
  "canvas.newBranchHint": { zh: "从这里长出新分支", en: "Grow a new branch from here" },
  "canvas.turnForks": {
    zh: "这个回合分出了 {n} 条子分支 — 点击看整个子树",
    en: "{n} branches forked from this turn — click to view the whole subtree",
  },
  "canvas.parallelSummary": { zh: "回答汇总", en: "Answer summary" },
  "canvas.parallelSources": { zh: "汇入", en: "From" },
  "canvas.parallelOpenSource": {
    zh: "查看 {model} 的原始回答",
    en: "Open {model}'s original answer",
  },
  "canvas.parallelContinueHint": {
    zh: "从这份汇总继续对话",
    en: "Continue from this summary",
  },
  "canvas.parallelSource": {
    zh: "第 {round} 轮 · {index}/{total}",
    en: "Round {round} · {index}/{total}",
  },
  "canvas.parallelSourceHint": {
    zh: "第 {round} 轮多模型提问的第 {index}/{total} 个回答（{model}）— 点击打开整轮阅读视图",
    en: "Answer {index}/{total} of multi-model round {round} ({model}) — click to open the round",
  },
  "canvas.stubForks": {
    zh: "这条空分支分出了 {n} 条子分支 — 点击看整个子树",
    en: "{n} branches forked from this empty branch — click to view the whole subtree",
  },
  "canvas.running": { zh: "○ 运行中…", en: "○ Running…" },
  "canvas.waiting": { zh: "◐ 等你处理", en: "◐ Needs you" },
  "canvas.stubHint": {
    zh: "新分支还没有自己的回合 — 点「＋」写下第一步，或者直接在右侧回复。",
    en: "This new branch has no turns yet — click “＋” to write the first step, or just reply in the pane on the right.",
  },
  "canvas.draft": { zh: "🌱 草稿", en: "🌱 Draft" },
  "canvas.continueBranch": { zh: "继续分支", en: "continue branch" },
  "canvas.newBranch": { zh: "新分支", en: "new branch" },
  "canvas.ctxNoneTitle": {
    zh: "空上下文：新分支不带这条分支的任何历史，只在谱系上挂在分叉点",
    en: "Empty context: the new branch carries none of this branch's history; it only hangs on the fork point in the lineage",
  },
  "canvas.ctxInheritTitle": {
    zh: "当前会复制切点前的全部对话到新分支；点击切换为空上下文",
    en: "Currently copies everything before the cut into the new branch; click to switch to empty context",
  },
  // Glyphs live in the templates, not here — a label is text in either language.
  "canvas.ctxNoneLabel": { zh: "空上下文", en: "Empty context" },
  "canvas.ctxNoneOriginLabel": { zh: "未继承上文", en: "No inherited history" },
  "canvas.ctxInheritLabel": { zh: "带历史", en: "With history" },
  // The static ✂ marker (sidebar / digest / compare column):
  // it must never read as the draft's clickable toggle, hence its own strings.
  "cut.markerTitle": {
    zh: "空上下文分支：不带母本历史，从自己的第一句话开始",
    en: "Empty-context branch: carries no parent history, starts from its own first turn",
  },
  "cut.digestChip": {
    zh: "空上下文 · 从自己的第一句话开始",
    en: "Empty context · starts from its own first turn",
  },
  // The pane is where the user actually reads, so the marker becomes a
  // sentence that states the consequence rather than a symbol to decode.
  "cut.paneNote": {
    zh: "这条分支不带母本历史，从自己的第一句话开始。",
    en: "This branch carries no parent history; it starts from its own first turn.",
  },
  // Above a story path, "上下文里没有" replaces the old "上文链路" heading —
  // those ancestor turns are lineage, not this branch's context.
  "cut.chainLabel": { zh: "故事路径", en: "Story path" },
  "cut.splitFrom": { zh: "从「{title}」分出", en: "Split off from “{title}”" },
  "cut.splitFromFallback": { zh: "母本分支", en: "the parent branch" },
  "cut.chainGhost": {
    zh: "母本的对话没有带过来",
    en: "The parent's turns did not come along",
  },
  "cut.compareNote": {
    zh: "✂ 不带母本历史",
    en: "✂ Carries no parent history",
  },
  "canvas.remove": { zh: "移除", en: "Remove" },
  "canvas.phContinue": {
    zh: "描述下一步…（发送后继续这个分支）",
    en: "Describe the next step… (sends to this branch)",
  },
  "canvas.phNew": {
    zh: "描述下一步…（发送后从这里长出新分支）",
    en: "Describe the next step… (forks a new branch from here)",
  },
  "canvas.branchModelTitle": { zh: "用哪个模型跑这条分支", en: "Model to run this branch" },
  "canvas.draftHint": { zh: "⌘/Ctrl ⏎ 发送 · Esc 收起", en: "⌘/Ctrl ⏎ Send · Esc Collapse" },
  "canvas.offlineTitle": { zh: "{backend} 未连接", en: "{backend} not connected" },
  "canvas.offlineSub": {
    zh: "连接恢复后，点左侧「↻ 刷新」重新加载会话",
    en: "Once the connection is back, click “↻ Refresh” in the sidebar to reload sessions",
  },
  "canvas.connecting": { zh: "正在连接 {backend}…", en: "Connecting to {backend}…" },
  "canvas.emptyConvTitle": { zh: "这场对话还是空的", en: "This conversation is still empty" },
  "canvas.emptyConvSub": {
    zh: "在右侧写下第一条消息，发出后它会作为第一个节点出现在这里",
    en: "Write the first message in the pane on the right; once sent it appears here as the first node",
  },
  "canvas.noSessionsTitle": { zh: "这个项目还没有会话", en: "No sessions in this project yet" },
  "canvas.noSessionsSub": {
    zh: "在终端里用 {backend} 开一场对话，它就会作为第一个节点出现在这里",
    en: "Start a conversation with {backend} in your terminal and it will appear here as the first node",
  },
  "canvas.layingOut": { zh: "正在铺开分支图…", en: "Laying out the branch graph…" },
  "canvas.status": {
    zh: "{nodes} 个节点 · {sessions} 段对话 · {forks} 条分支",
    en: "{nodes} nodes · {sessions} conversations · {forks} branches",
  },
  "canvas.pickBanner": {
    zh: "⇄ 点一张卡片，或在侧栏点一个会话，与「{title}」对比",
    en: "⇄ Pick a card, or a session in the sidebar, to compare with “{title}”",
  },
  "canvas.cancelEsc": { zh: "取消（Esc）", en: "Cancel (Esc)" },
  "canvas.fitView": { zh: "适配视图", en: "Fit view" },
  "canvas.mmHint": {
    zh: "滚轮缩放画布 · {mod}滚轮缩放地图",
    en: "Wheel zooms the canvas · {mod}wheel zooms the map",
  },
  "canvas.confirmDeleteTurn": {
    zh: "删除回合「{title}」？\n只删除这一问一答，更早的对话保留。此操作不可撤销。",
    en: "Delete turn “{title}”?\nOnly this question-and-answer pair is deleted; earlier conversation stays. This cannot be undone.",
  },
  "canvas.toolCount": { zh: "{n} 个工具", en: "{n} tools" },
  "canvas.noTools": { zh: "无工具调用", en: "no tool calls" },
  "canvas.thinking": { zh: "正在思考…", en: "Thinking…" },
  "canvas.justNow": { zh: "刚刚", en: "just now" },
  "canvas.minutesAgo": { zh: "{n} 分钟前", en: "{n} min ago" },
  "canvas.hoursAgo": { zh: "{n} 小时前", en: "{n} h ago" },
  "canvas.daysAgo": { zh: "{n} 天前", en: "{n} d ago" },

  // ── compare-composer.vue ───────────────────────────────────────────────
  "compare.title": { zh: "⇄ 同题投递", en: "⇄ Same prompt to both" },
  "compare.addAttachment": {
    zh: "添加附件（图片、文档、文本）",
    en: "Add attachments (images, documents, text)",
  },
  "compare.backToEdit": { zh: "回到编辑", en: "Back to editing" },
  "compare.previewTitle": { zh: "预览发送后的 Markdown 效果", en: "Preview the rendered Markdown" },
  "compare.edit": { zh: "✎ 编辑", en: "✎ Edit" },
  "compare.preview": { zh: "👁 预览", en: "👁 Preview" },
  "compare.running": { zh: "○ 运行中", en: "○ Running" },
  "compare.stop": { zh: "■ 停止", en: "■ Stop" },
  "compare.pickModel": { zh: "选择「{title}」的模型", en: "Pick the model for “{title}”" },
  "compare.pickVariant": {
    zh: "选择「{title}」的思考档位",
    en: "Pick the effort level for “{title}”",
  },
  "compare.remove": { zh: "移除", en: "Remove" },
  "compare.noImageSupport": {
    zh: "所选模型不支持图片：{list}",
    en: "Selected models do not support images: {list}",
  },
  "compare.placeholder": {
    zh: "向选中的会话发送同一条消息…",
    en: "Send the same message to the selected sessions…",
  },
  "compare.previewEmpty": {
    zh: "输入内容后，这里显示发送后的 Markdown 效果",
    en: "Type something and the rendered Markdown will show here",
  },
  "compare.hint": {
    zh: "{mod}↵ 发送 · 两侧模型可独立选择",
    en: "{mod}↵ Send · each side can pick its own model",
  },
  "compare.sendBoth": { zh: "发送到两边 ➤", en: "Send to both ➤" },
  "compare.sendSide": { zh: "发送到{side} ➤", en: "Send to {side} ➤" },
  "compare.sideLeft": { zh: "左侧", en: "the left" },
  "compare.sideRight": { zh: "右侧", en: "the right" },
  "compare.noTargets": { zh: "选择可发送会话", en: "Pick a sendable session" },
  "compare.attachUnsupported": {
    zh: "当前后端不支持附件",
    en: "The current backend does not support attachments",
  },

  // ── file-changes-card.vue ──────────────────────────────────────────────
  "filechg.title": { zh: "文件改动", en: "File changes" },
  "filechg.expandDiff": { zh: "展开保存的 diff", en: "Expand the saved diff" },
  "filechg.modified": { zh: "修改", en: "Modified" },
  "filechg.created": { zh: "新增", en: "Created" },
  "filechg.deleted": { zh: "删除", en: "Deleted" },
  "filechg.unknown": { zh: "未知", en: "Unknown" },
  "filechg.openInSystem": { zh: "在系统中打开这个文件", en: "Open this file in the system" },
  "filechg.open": { zh: "打开", en: "Open" },
  "filechg.noDiff": {
    zh: "这个改动没有可展示的 diff（未知状态）。",
    en: "No diff to show for this change (unknown status).",
  },
  "filechg.unrecorded": {
    zh: "文件改动未记录 —— 这个回合在 awefork 之外执行（分叉继承或离线期间的编辑）。",
    en: "File changes were not recorded — this turn ran outside awefork (fork inheritance or edits made while offline).",
  },

  // ── branch-context.vue + branch-digest.vue ─────────────────────────────
  "branch.compareTitle": { zh: "⇄ 分支对比", en: "⇄ Branch compare" },
  "branch.freeTitle": { zh: "⇄ 自由并排", en: "⇄ Free side-by-side" },
  "branch.exitCompare": { zh: "退出对比（Esc）", en: "Exit compare (Esc)" },
  "branch.current": { zh: "当前", en: "Current" },
  "branch.commonPrefix": { zh: "共同前缀 · {n} 个回合", en: "Common prefix · {n} turns" },
  "branch.forkAt": { zh: "此后分叉 · 『{title}』", en: "Forked after · “{title}”" },
  "branch.samePrompt": { zh: "同题", en: "Same prompt" },
  "branch.sameRetryTitle": {
    zh: "两条分支分叉后的第一个提示词相同 — 看起来是同一步的重试",
    en: "The first prompts after the fork are identical — looks like a retry of the same step",
  },
  "branch.sameApproachTitle": {
    zh: "两个会话的第一个提示词相同 — 可能是同一件事的两种做法",
    en: "The two sessions start with the same prompt — possibly two takes on the same task",
  },
  "branch.emptyAfterFork": {
    zh: "分叉点之后两条分支都还没有自己的回合。",
    en: "Neither branch has any turns of its own after the fork point.",
  },
  "branch.unrelated": {
    zh: "两个会话不同源 · 各自按时间线并排",
    en: "The two sessions are unrelated · shown as independent timelines",
  },
  "branch.selectColumn": {
    zh: "选中「{title}」并退出对比",
    en: "Select “{title}” and exit compare",
  },
  "branch.syncScrollTitle": {
    zh: "同步滚动：滚轮滚动时两栏一起下滑",
    en: "Sync scroll: the wheel carries both columns down together",
  },
  "branch.expandAllTitle": {
    zh: "展开全部卡片（再点一次全部折叠）",
    en: "Expand every card (click again to fold them all)",
  },
  "branch.collapseAllTitle": {
    zh: "折叠全部卡片",
    en: "Fold every card shut",
  },
  "branch.newTurns": {
    zh: "↓ {n} 个新回合",
    en: "↓ {n} new turns",
  },
  "branch.select": { zh: "选中", en: "Select" },
  "branch.jumpLatest": { zh: "跳到这个会话的最新回合", en: "Jump to this session's latest turn" },
  "branch.latest": { zh: "⤓ 最新", en: "⤓ Latest" },
  "branch.emptySession": { zh: "这个会话还没有回合。", en: "This session has no turns yet." },
  "branch.contextTitle": { zh: "分支上下文", en: "Branch context" },
  "branch.pickNode": { zh: "在画布上选一个节点", en: "Pick a node on the canvas" },
  "branch.compareParent": {
    zh: "与母本分支「{title}」并排对比",
    en: "Compare side-by-side with parent branch “{title}”",
  },
  "branch.compareParentBtn": { zh: "⇄ 对比母本", en: "⇄ Compare parent" },
  "branch.exportTitle": {
    zh: "导出这条分支为 Markdown（含模型/耗时/token）",
    en: "Export this branch as Markdown (with model/duration/tokens)",
  },
  "branch.compressTitle": {
    zh: "压缩会话：把历史折叠成摘要（历史仍保留，之后的对话只携带摘要与最近几轮）",
    en: "Compress session: fold history into a summary (history is kept; later turns carry only the summary plus the most recent turns)",
  },
  "branch.prevTurn": { zh: "上一回合（←）", en: "Previous turn (←)" },
  "branch.nextTurn": { zh: "下一回合（→）", en: "Next turn (→)" },
  "branch.running": { zh: "○ 运行中", en: "○ Running" },
  "branch.chainLabel": { zh: "上文链路", en: "Context chain" },
  "branch.chainOmitted": { zh: "…更早 {n} 个回合", en: "…{n} earlier turns" },
  "branch.jumpToTurn": { zh: "跳到这个回合", en: "Jump to this turn" },
  "branch.fromUpstream": { zh: "来自上游分支", en: "From an upstream branch" },
  "branch.toolOnlyPreview": {
    zh: "({n} 个工具调用，无文本回复)",
    en: "({n} tool calls, no text reply)",
  },
  "branch.emptyHint": {
    zh: "左侧选会话，或在画布上点一张卡片。",
    en: "Pick a session on the left, or click a card on the canvas.",
  },
  "branch.turnsMeta": { zh: "{n} 个回合 · 含 {m} 继承", en: "{n} turns · {m} inherited" },
  "branch.turnsCount": { zh: "{n} 个回合", en: "{n} turns" },
  "branch.turnPos": { zh: "回合 {index}/{total}", en: "Turn {index}/{total}" },
  "branch.digestPillTitle": {
    zh: "这个故事里每条分支的摘要",
    en: "A digest of every branch in this story",
  },
  "branch.digestTitle": { zh: "⑂ 分支摘要", en: "⑂ Branch digest" },
  "branch.digestCount": { zh: "⑂ 分支摘要 · {n} 条", en: "⑂ Branch digest · {n}" },
  "branch.collapse": { zh: "收起", en: "Collapse" },
  "branch.compareWith": { zh: "与「{title}」并排对比", en: "Compare side-by-side with “{title}”" },
  "branch.forkedFrom": {
    zh: "从「{session}」的『{turn}』分出",
    en: "Forked from “{turn}” in “{session}”",
  },
  "branch.attemptTitle": {
    zh: "同一回合的重试分支，按创建先后编号",
    en: "Retry branches of the same turn, numbered by creation order",
  },
  "branch.attempt": { zh: "第 {n} 次", en: "Try {n}" },
  "branch.rowMeta": {
    zh: "{n} 个回合 · {tokens} · 最近：{last}",
    en: "{n} turns · {tokens} · latest: {last}",
  },
  "branch.noTurns": { zh: "还没有回合", en: "no turns yet" },
};
