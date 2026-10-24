/**
 * Panel-surface dictionary for the sidebar / chat input / history / marks /
 * demo-preview feature set, kept in its own module so i18n.ts stays focused
 * on the interaction-dialog surface. Same shape as i18n.ts's DICT: flat
 * `zh`/`en` entries consumed by `t(key, vars?)` — the consumer merges this
 * dict into the lookup so unknown-key passthrough keeps working.
 */
export const dict: Record<string, { zh: string; en: string }> = {
  // ── side-bar.vue ────────────────────────────────────────────────────────
  "sidebar.searchSessions": { zh: "搜索会话", en: "Search sessions" },
  "sidebar.clearSearch": { zh: "清空搜索文本", en: "Clear search text" },
  "sidebar.collapseBoost": { zh: "收起增强搜索", en: "Collapse enhanced search" },
  "sidebar.boostTitle": {
    zh: "增强搜索：范围、标签、状态筛选",
    en: "Enhanced search: scope, tags, status filters",
  },
  "sidebar.refreshList": { zh: "刷新会话列表", en: "Refresh session list" },
  "sidebar.searchPlaceholder": { zh: "搜索{parts}…", en: "Search {parts}…" },
  "sidebar.searchScopes": { zh: "搜索范围", en: "Search scope" },
  "sidebar.scopeTitle": { zh: "标题", en: "titles" },
  "sidebar.scopeTitleCap": { zh: "标题", en: "Title" },
  "sidebar.scopeTag": { zh: "标签", en: "tags" },
  "sidebar.scopeTagCap": { zh: "标签", en: "Tag" },
  "sidebar.scopeBodyFull": { zh: "正文·全文", en: "Body · full text" },
  "sidebar.scopeBody": { zh: "正文", en: "bodies" },
  "sidebar.project": { zh: "项目", en: "Project" },
  "sidebar.limitToProject": { zh: "把搜索限定到某个项目", en: "Limit search to one project" },
  "sidebar.allProjects": { zh: "全部项目", en: "All projects" },
  "sidebar.searchLimit": { zh: "搜索上限", en: "Search cap" },
  "sidebar.all": { zh: "全部", en: "All" },
  "sidebar.syntax": { zh: "语法", en: "Syntax" },
  "sidebar.synBody": { zh: "只搜会话正文", en: "Search bodies only" },
  "sidebar.synTag": { zh: "限定标签", en: "Restrict to a tag" },
  "sidebar.synTitle": { zh: "限定标题", en: "Restrict to the title" },
  "sidebar.synDir": { zh: "限定目录", en: "Restrict to a directory" },
  "sidebar.synPhrase": { zh: "整句匹配", en: "Match the exact phrase" },
  "sidebar.synExclude": { zh: "排除含它的结果", en: "Exclude results containing it" },
  "sidebar.bodyNote": {
    zh: "勾选正文后：标题命中立即显示，正文命中扫描完成后补上。",
    en: "With body checked: title hits show at once; body hits join once the scan finishes.",
  },
  "sidebar.resetTitle": {
    zh: "范围、项目、上限全部还原成默认",
    en: "Restore scope, project and cap to defaults",
  },
  "sidebar.resetSearch": { zh: "↺ 恢复默认搜索", en: "↺ Reset search" },
  "sidebar.bodyScanning": { zh: "⟳ 正在搜索正文…", en: "⟳ Searching bodies…" },
  "sidebar.clearTagFilter": { zh: "点击取消这个筛选", en: "Click to clear this filter" },
  "sidebar.filterByTag": { zh: "只看带这个标签的会话", en: "Show only sessions with this tag" },
  "sidebar.collapseTags": { zh: "收起标签", en: "Collapse tags" },
  "sidebar.moreTags": { zh: "还有 {n} 个标签", en: "{n} more tags" },
  "sidebar.pinned": { zh: "📌 置顶", en: "📌 Pinned" },
  "sidebar.unpin": { zh: "取消置顶", en: "Unpin" },
  "sidebar.pin": { zh: "置顶", en: "Pin" },
  "sidebar.collapseProjects": { zh: "收起项目列表", en: "Collapse project list" },
  "sidebar.expandProjects": { zh: "展开项目列表", en: "Expand project list" },
  "sidebar.projects": { zh: "项目", en: "Projects" },
  "sidebar.addDirTitle": {
    zh: "选择一个项目目录加进侧栏，可在其中新建对话",
    en: "Pick a project directory to add to the sidebar; new chats can start in it",
  },
  "sidebar.collapseDir": { zh: "收起这个目录", en: "Collapse this directory" },
  "sidebar.expandDir": { zh: "展开这个目录", en: "Expand this directory" },
  "sidebar.newChatHere": { zh: "在这个项目里新建对话", en: "New chat in this project" },
  "sidebar.expandBranch": {
    zh: "展开这个分支（折叠了 {n} 个子会话）",
    en: "Expand this branch ({n} child sessions folded)",
  },
  "sidebar.collapseBranch": { zh: "收起这个分支的子会话", en: "Fold this branch's child sessions" },
  "sidebar.confirmUnpin": { zh: "确认取消置顶", en: "Confirm unpin" },
  "sidebar.confirmPin": { zh: "确认置顶", en: "Confirm pin" },
  "sidebar.confirm": { zh: "确认", en: "Confirm" },
  "sidebar.confirmArchive": { zh: "确认归档会话", en: "Confirm archive" },
  "sidebar.archiveTitle": {
    zh: "归档会话（在下方归档区可恢复）",
    en: "Archive session (recoverable in the archive section below)",
  },
  "sidebar.locateMessage": { zh: "定位到这条消息所在的回合", en: "Jump to this message's turn" },
  "sidebar.noMatches": { zh: "没有匹配的会话", en: "No matching sessions" },
  "sidebar.archive": { zh: "📦 归档", en: "📦 Archive" },
  "sidebar.hiddenSessions": { zh: "{n} 个会话被隐藏", en: "{n} sessions hidden" },
  "sidebar.restoreDir": {
    zh: "恢复这个目录（含以后新增的会话）",
    en: "Restore this directory (including sessions added later)",
  },
  "sidebar.restoreSession": { zh: "恢复这个会话", en: "Restore this session" },
  "sidebar.archiveEmpty": { zh: "归档区是空的", en: "Archive is empty" },
  "sidebar.fileDock": { zh: "📁 文件", en: "📁 Files" },
  "sidebar.fileDockNoDir": {
    zh: "还没有选中的项目目录",
    en: "No project directory selected yet",
  },
  "sidebar.fileDockLoading": { zh: "读取中…", en: "Loading…" },
  "sidebar.fileDockEmpty": { zh: "这个文件夹是空的", en: "This folder is empty" },
  "sidebar.menuUnpin": { zh: "★ 取消置顶", en: "★ Unpin" },
  "sidebar.menuPin": { zh: "☆ 置顶", en: "☆ Pin" },
  "sidebar.menuUnmark": { zh: "★ 取消关键标记", en: "★ Unmark as key" },
  "sidebar.menuMark": { zh: "☆ 标记为关键对话", en: "☆ Mark as key turn" },
  "sidebar.rename": { zh: "✏️ 重命名", en: "✏️ Rename" },
  "sidebar.openInNewTab": { zh: "🞂 在新标签打开故事", en: "🞂 Open story in new tab" },
  "sidebar.setTags": { zh: "🏷 设置标签…", en: "🏷 Set tags…" },
  "sidebar.compareTitle": {
    zh: "点画布上的一张卡片，或在侧栏点一个会话，与它并排对比",
    en: "Pick a canvas card or a sidebar session to compare side by side",
  },
  "sidebar.compare": { zh: "⇄ 与另一会话对比…", en: "⇄ Compare with another session…" },
  "sidebar.copyId": { zh: "📋 复制会话 ID", en: "📋 Copy session ID" },
  "sidebar.openTerminal": { zh: "↗ 在终端中打开", en: "↗ Open in terminal" },
  "sidebar.compressTitle": {
    zh: "把历史折叠成一份摘要：历史仍保留，之后的对话只携带摘要与最近几轮",
    en: "Fold history into a summary: history is kept, later turns carry only the summary plus the latest few rounds",
  },
  "sidebar.compress": { zh: "🗜 压缩会话…", en: "🗜 Compress session…" },
  "sidebar.exportTitleTurn": {
    zh: "把这个分支截至当前回合复制成一份独立会话，可在任何 opencode 客户端继续",
    en: "Copy this branch, cut at the current turn, into a standalone session continuable in any opencode client",
  },
  "sidebar.exportTitle": {
    zh: "把这条分支复制成一份独立会话，可在任何 opencode 客户端继续",
    en: "Copy this branch into a standalone session continuable in any opencode client",
  },
  "sidebar.export": { zh: "📤 导出为独立会话", en: "📤 Export as standalone session" },
  "sidebar.archiveSession": { zh: "📦 归档会话", en: "📦 Archive session" },
  "sidebar.deleteSession": { zh: "🗑 删除会话…", en: "🗑 Delete session…" },
  "sidebar.dirNewChat": { zh: "＋ 在此目录新建对话", en: "＋ New chat in this directory" },
  "sidebar.dirArchive": { zh: "📦 归档这个目录…", en: "📦 Archive this directory…" },
  "sidebar.dirRemove": { zh: "✕ 移除这个目录", en: "✕ Remove this directory" },
  "sidebar.dirRemoveTitle": {
    zh: "只从侧栏移除这个空目录，不动磁盘",
    en: "Drop this empty directory from the sidebar only; disk untouched",
  },
  "sidebar.tagOnSessions": {
    zh: "「{tag}」挂在 {n} 个会话上",
    en: "\u201c{tag}\u201d is on {n} sessions",
  },
  "sidebar.deleteAll": { zh: "全部删除", en: "Delete everywhere" },
  "sidebar.cancel": { zh: "取消", en: "Cancel" },
  "sidebar.deleteTagFromAll": {
    zh: "从所有会话删除这个标签（可撤销）",
    en: "Delete this tag from all sessions (undoable)",
  },
  "sidebar.removeLocal": { zh: "仅本会话移除", en: "Remove here only" },
  "sidebar.removeLocalTitle": {
    zh: "只从当前会话移除这个标签",
    en: "Remove this tag from the current session only",
  },
  "sidebar.sessionTags": { zh: "这个会话的标签", en: "Tags on this session" },
  "sidebar.searchTags": { zh: "搜索标签", en: "Search tags" },
  "sidebar.tagList": { zh: "标签列表", en: "Tag list" },
  "sidebar.changeColor": {
    zh: "换个颜色（点 ✕ 恢复默认）",
    en: "Change color (✕ resets to default)",
  },
  "sidebar.pickColor": { zh: "给这个标签选个颜色", en: "Pick a color for this tag" },
  "sidebar.editTagColor": { zh: "修改「{tag}」的颜色", en: "Change color of \u201c{tag}\u201d" },
  "sidebar.chooseTagColor": { zh: "给「{tag}」选个颜色", en: "Pick a color for \u201c{tag}\u201d" },
  "sidebar.deleteTagTitle": { zh: "删除这个标签", en: "Delete this tag" },
  "sidebar.autoColor": { zh: "按名字自动配色", en: "Auto color from the name" },
  "sidebar.hue": { zh: "色相 {hue}", en: "Hue {hue}" },
  "sidebar.customHue": { zh: "自定义色相", en: "Custom hue" },
  "sidebar.newTagHue": { zh: "新建标签的自定义色相", en: "Custom hue for the new tag" },
  "sidebar.newTagPlaceholder": { zh: "＋ 新建标签，回车添加", en: "＋ New tag, Enter to add" },
  "sidebar.noTagMatches": { zh: "没有匹配的标签", en: "No matching tags" },
  "sidebar.subtreeAsk": {
    zh: "也把「{tags}」应用到 {n} 个子会话？",
    en: "Also apply \u201c{tags}\u201d to {n} child sessions?",
  },
  "sidebar.subtreeApplyTitle": {
    zh: "把这些标签并集写入每个子孙会话（可撤销）",
    en: "Write the union of these tags into every descendant session (undoable)",
  },
  "sidebar.apply": { zh: "应用", en: "Apply" },
  "sidebar.subtreeSkipTitle": {
    zh: "这些标签只留在当前会话上",
    en: "Keep these tags on the current session only",
  },
  "sidebar.thisSession": { zh: "仅本会话", en: "This session only" },
  "sidebar.forkPrefLabel": { zh: "分叉时继承标签", en: "Inherit tags on fork" },
  "sidebar.prefAsk": { zh: "每次问", en: "Ask" },
  "sidebar.prefAskTitle": {
    zh: "每次分叉都询问是否继承",
    en: "Ask whether to inherit on every fork",
  },
  "sidebar.prefAlways": { zh: "始终", en: "Always" },
  "sidebar.prefAlwaysTitle": {
    zh: "分叉出的新会话自动带上本会话的全部标签",
    en: "Forked sessions automatically carry all of this session's tags",
  },
  "sidebar.prefNever": { zh: "从不", en: "Never" },
  "sidebar.prefNeverTitle": {
    zh: "分叉出的新会话不带标签，也不再询问",
    en: "Forked sessions carry no tags and are never asked about",
  },

  // ── chat-input.vue ──────────────────────────────────────────────────────
  "input.attachTitle": {
    zh: "添加附件（图片、文档、文本）",
    en: "Add attachments (images, documents, text)",
  },
  "input.backToEdit": { zh: "回到编辑", en: "Back to editing" },
  "input.previewTitle": {
    zh: "预览发送后的 Markdown 效果",
    en: "Preview the Markdown as it will be sent",
  },
  "input.edit": { zh: "✎ 编辑", en: "✎ Edit" },
  "input.preview": { zh: "👁 预览", en: "👁 Preview" },
  "input.remove": { zh: "移除", en: "Remove" },
  "input.placeholder": { zh: "继续这条分支…", en: "Continue this branch…" },
  "input.placeholderRunning": { zh: "Agent is running…", en: "Agent is running…" },
  "input.previewEmpty": {
    zh: "输入内容后，这里显示发送后的 Markdown 效果",
    en: "Type something — the sent Markdown renders here",
  },
  "input.modelTitle": {
    zh: "用哪个模型继续这条分支",
    en: "Pick the model to continue this branch",
  },
  "input.parallelMode": { zh: "多模型", en: "Multiple models" },
  "input.parallelTargets": { zh: "同一问题，分别发送给", en: "Send this prompt independently to" },
  "input.parallelLimit": { zh: "最多 4 个", en: "Up to 4 models" },
  "input.parallelRemoveModel": { zh: "移除这个模型", en: "Remove this model" },
  "input.parallelAddModel": { zh: "添加模型", en: "Add model" },
  "input.parallelSearchModel": { zh: "搜索模型或提供方…", en: "Search models or providers…" },
  "input.parallelNoModels": { zh: "没有可添加的模型", en: "No more models to add" },
  "input.parallelModelSettings": {
    zh: "调整这个模型的推理强度",
    en: "Adjust this model's reasoning effort",
  },
  "input.parallelDefaultVariant": { zh: "默认强度", en: "Default effort" },
  "input.parallelSummarySettings": { zh: "汇总设置", en: "Summary settings" },
  "input.parallelSummaryWith": { zh: "汇总模型", en: "Summary model" },
  "input.parallelDefaultSummaryModel": { zh: "Agent 默认模型", en: "Agent default model" },
  "input.parallelSummaryLength": { zh: "汇总长度", en: "Summary length" },
  "input.parallelBrief": { zh: "精简", en: "Brief" },
  "input.parallelStandard": { zh: "标准", en: "Standard" },
  "input.parallelNone": { zh: "不汇总", en: "No summary" },
  "input.parallelNoneHint": {
    zh: "本轮不生成汇总，回答仍可并排阅读，之后也能手动汇总。",
    en: "No summary this round — the answers stay side by side, and you can summarize later.",
  },
  "input.parallelPlaceholder": {
    zh: "同一问题，发送给 {n} 个模型…",
    en: "One prompt to {n} models…",
  },
  "input.parallelHint": {
    zh: "回答会各自保存在独立分支，完成后自动汇总。",
    en: "Each answer stays in its own branch. A summary is generated when they finish.",
  },
  "input.parallelSendCount": { zh: "{n} 个独立回答", en: "{n} independent replies" },
  "input.parallelSend": { zh: "发送给 {n} 个模型 ➤", en: "Send to {n} models ➤" },
  "input.parallelDefaultModel": { zh: "Agent 默认模型", en: "Agent default model" },
  "input.parallelNeedTwo": {
    zh: "至少选择两个模型才能同题投递",
    en: "Select at least two models for a parallel prompt",
  },
  "input.parallelNoImageSupport": {
    zh: "所选模型并非都支持图片，请移除图片附件或调整模型。",
    en: "Not all selected models support images. Remove image attachments or adjust the model list.",
  },
  "input.contextTitle": {
    zh: "上下文 {used} / {window} tokens（{pct}%）— 本会话最近一次请求后的占用",
    en: "Context {used} / {window} tokens ({pct}%) — occupancy after this session's latest request",
  },
  "input.contextTitleNoWindow": {
    zh: "上下文已用 {used} tokens · 该模型未报告窗口大小",
    en: "Context {used} tokens used · model window unknown",
  },
  "input.contextHint": {
    zh: "接近窗口上限 — 可用 🗜 先压缩这条分支",
    en: "Near the window limit — 🗜 compress this branch first",
  },
  "input.compressTitle": {
    zh: "压缩本会话上下文（摘要化历史，释放窗口）",
    en: "Compress this session's context (summarize history, free the window)",
  },
  "input.send": { zh: "发送 ➤", en: "Send ➤" },
  "input.stop": { zh: "■ 停止", en: "■ Stop" },
  "input.noAttachments": {
    zh: "当前后端不支持附件",
    en: "This backend does not support attachments",
  },
  "input.noImageSupport": {
    zh: "当前模型不支持图片附件，已跳过图片",
    en: "This model does not take image attachments; images skipped",
  },
  "input.codeFenceNotice": {
    zh: "识别到多行代码，已包成 ``` 围栏（{mod}Z 可撤销）",
    en: "Multi-line code detected and wrapped in a ``` fence ({mod}Z to undo)",
  },

  // ── history-panel.vue + history-button.vue ─────────────────────────────
  "histpanel.title": { zh: "操作历史", en: "Action history" },
  "histpanel.meta": {
    zh: "{n} 条记录 · 可撤销 {depth} 步",
    en: "{n} entries · {depth} undo steps",
  },
  "histpanel.close": { zh: "关闭", en: "Close" },
  "histpanel.empty": { zh: "本次运行还没有记录操作。", en: "No recorded actions in this run yet." },
  "histpanel.current": { zh: "当前位置", en: "You are here" },
  "histpanel.locked": { zh: "以下操作已锁定", en: "Actions below are locked" },
  "histpanel.lockedTitle": {
    zh: "——此操作不可撤销，且锁定了更早的历史",
    en: " — this action cannot be undone and locks earlier history",
  },
  "histpanel.failedTitle": {
    zh: "——上次撤销/重做失败",
    en: " — last undo/redo failed",
  },
  "histpanel.foot": {
    zh: "⌘/Ctrl+Z 撤销 · ⌘/Ctrl+⇧+Z 重做 · Esc 关闭",
    en: "⌘/Ctrl+Z undo · ⌘/Ctrl+⇧+Z redo · Esc close",
  },
  "histpanel.buttonTitle": {
    zh: "操作历史（⌘/Ctrl+Shift+H）",
    en: "Action history (⌘/Ctrl+Shift+H)",
  },
  "histpanel.buttonText": { zh: "历史", en: "History" },

  // ── marks-panel.vue ────────────────────────────────────────────────────
  "marks.countTitle": { zh: "当前画布上 {n} 条关键对话", en: "{n} key turns on this canvas" },
  "marks.label": { zh: "★ 关键节点", en: "★ Key turns" },
  "marks.listTitle": { zh: "标记过的关键对话列表", en: "List of marked key turns" },
  "marks.head": { zh: "★ 关键节点 · {n}", en: "★ Key turns · {n}" },
  "marks.collapse": { zh: "收起", en: "Collapse" },
  "marks.toolCallsOnly": {
    zh: "({n} 个工具调用，无文本回复)",
    en: "({n} tool calls, no text reply)",
  },
  "marks.noText": { zh: "(无文本回复)", en: "(no text reply)" },
  "marks.empty": {
    zh: "还没有标记 — 在卡片或右侧回合上点 ★ 标记关键对话",
    en: "No marks yet — click ★ on a card or a turn on the right to mark key turns",
  },

  // ── demo/subagent-preview.vue ──────────────────────────────────────────
  "demo.heading": { zh: "subagent 显示优化", en: "Subagent display redesign" },
  "demo.subheading": {
    zh: "设计预览 · opencode 适配 · 加速回放（约 20 秒演完一回合，未接真实后端）",
    en: "Design preview · opencode adapter · sped-up replay (one turn in ~20s; no real backend)",
  },
  "demo.newDesign": { zh: "新版设计", en: "New design" },
  "demo.oldDesign": { zh: "旧版现状", en: "Old behavior" },
  "demo.replay": { zh: "▶ 重播运行", en: "▶ Replay run" },
  "demo.userPrompt": {
    zh: "登录接口重构完了，做一次安全排查吧。三路并行：路由权限、密码哈希、session 管理。",
    en: "Login refactor is done — run a security pass. Three lanes in parallel: route permissions, password hashing, session management.",
  },
  "demo.thoughtTitle": { zh: "Thought · 拆解排查任务", en: "Thought · Breaking down the audit" },
  "demo.thoughtMeta": { zh: "· 2.1秒", en: "· 2.1s" },
  "demo.oldNoteTitle": {
    zh: "旧版现状的问题（对照本回合：并行派了 3 个子代理）",
    en: "Problems with the old behavior (this turn: 3 subagents dispatched in parallel)",
  },
  "demo.oldNote1": {
    zh: "· 3 次 task 调用，Set 去重后只剩一个 chip，看不出派了几个",
    en: "· 3 task calls dedup by Set into one chip — you can't tell how many ran",
  },
  "demo.oldNote2": {
    zh: "· 子代理一跑几分钟，父会话只有一行 running…，无状态、无进度、无当前动作",
    en: "· A subagent runs for minutes while the parent shows one running… line — no state, progress, or current action",
  },
  "demo.oldNote3": {
    zh: "· 没有结果摘要，想知道子代理做了什么只能翻日志",
    en: "· No result summary — finding out what a subagent did means digging through logs",
  },
  "demo.oldNote4": {
    zh: "· 子会话在侧边栏和画布里都被隐藏，没有任何入口能打开",
    en: "· Sub-sessions are hidden from both sidebar and canvas — no way to open one",
  },
  "demo.elapsed": { zh: "已运行 {n}秒", en: "running {n}s" },
  "demo.doneMeta": { zh: "{dur} · {n} 次工具", en: "{dur} · {n} tool calls" },
  "demo.sec": { zh: "{n}秒", en: "{n}s" },
  "demo.minSec": { zh: "{m}分{n}秒", en: "{m}m {n}s" },
  "demo.openSubTitle": {
    zh: "打开这个子代理的会话（只读）",
    en: "Open this subagent's session (read-only)",
  },
  "demo.openSub": { zh: "打开子会话 ↗", en: "Open sub-session ↗" },
  "demo.dispatchLabel": { zh: "派发指令", en: "Dispatched prompt" },
  "demo.resultLabel": { zh: "执行结果", en: "Result" },
  "demo.hint": {
    zh: "卡片点击展开指令与结果摘要 ·「打开子会话」进入只读子会话视图（试试）",
    en: "Click a card to expand its prompt and result · \u201cOpen sub-session\u201d enters the read-only sub-session view (try it)",
  },
  "demo.canvasTitle": {
    zh: "画布：父节点挂子任务徽标",
    en: "Canvas: parent node carries a sub-task badge",
  },
  "demo.parentNode": { zh: "登录接口重构", en: "Login API refactor" },
  "demo.canvasNote": {
    zh: "不把子会话铺进图里；徽标点开就地展开子节点",
    en: "Sub-sessions stay off the graph; the badge expands child nodes in place",
  },
  "demo.sideTitle": {
    zh: "侧边栏：子会话折叠在父会话下",
    en: "Sidebar: sub-sessions fold under their parent",
  },
  "demo.sideNote": {
    zh: "默认折叠、样式弱化，不再一刀切隐藏",
    en: "Folded by default, visually muted — no more blanket hiding",
  },
  "demo.drillClose": { zh: "返回父会话（Esc）", en: "Back to parent session (Esc)" },
  "demo.drillMeta": {
    zh: "子会话 · 只读 · {n} 次工具调用 · glm-5.3-flash · 由父会话 task 工具派生",
    en: "Sub-session · read-only · {n} tool calls · glm-5.3-flash · spawned by the parent's task tool",
  },
  "demo.drillThought": { zh: "Thought · 制定排查计划", en: "Thought · Planning the audit" },
  "demo.t1Title": { zh: "排查路由权限", en: "Audit route permissions" },
  "demo.t1Prompt": {
    zh: "扫描 auth 相关的所有路由注册，找出没有权限中间件保护的端点。只读不改，回报路径和风险等级。",
    en: "Scan all auth-related route registrations and find endpoints without permission middleware. Read-only; report paths and risk levels.",
  },
  "demo.t1Result": {
    zh: "发现 3 个 /api/admin/* 路由未挂 requireRole 中间件，其中 /api/admin/users 普通用户可直接访问（高危），另 2 个为中危。",
    en: "Found 3 /api/admin/* routes without the requireRole middleware; /api/admin/users is directly reachable by regular users (high risk), the other 2 are medium.",
  },
  "demo.t1Thought": {
    zh: "先从路由注册处入手，逐一核对每个端点的中间件链，再交叉比对 permissions.ts 里的角色声明。",
    en: "Start from route registration, check each endpoint's middleware chain, then cross-check role declarations in permissions.ts.",
  },
  "demo.t1Intro": {
    zh: "扫描了 auth/router.go 注册的全部 12 个路由，逐条核对中间件链：",
    en: "Scanned all 12 routes registered in auth/router.go, checking each middleware chain:",
  },
  "demo.t1Item1": {
    zh: "/api/admin/users — 未挂 requireRole，普通用户可直接访问，高危",
    en: "/api/admin/users — no requireRole; directly reachable by regular users, high risk",
  },
  "demo.t1Item2": {
    zh: "/api/admin/stats、/api/admin/audit — 同样缺失，但仅泄露统计信息，中危",
    en: "/api/admin/stats, /api/admin/audit — also missing, but only stats leak, medium risk",
  },
  "demo.t1Item3": {
    zh: "其余 9 个端点中间件齐全",
    en: "The other 9 endpoints have full middleware",
  },
  "demo.t1Outro": {
    zh: '修复建议：在路由组上统一注册 requireRole("admin")，一行改动覆盖全部缺口。',
    en: 'Fix: register requireRole("admin") once on the route group — a one-line change closes every gap.',
  },
  "demo.t1Feed4": {
    zh: "已扫描 12 个路由，3 个缺少权限中间件",
    en: "scanned 12 routes, 3 missing permission middleware",
  },
  "demo.t2Title": { zh: "审查密码哈希迁移", en: "Review password-hash migration" },
  "demo.t2Prompt": {
    zh: "Review migration_007_argon2 和登录成功后的哈希回填逻辑，重点看事务边界和并发场景。只审不改。",
    en: "Review migration_007_argon2 and the post-login hash backfill, focusing on transaction boundaries and concurrency. Review only, no edits.",
  },
  "demo.t2Result": {
    zh: "迁移脚本本身正确；但登录成功后的 argon2 回填没有事务保护，进程崩溃会留下半迁移用户，建议补成单事务 UPSERT。",
    en: "The migration script itself is correct; but the post-login argon2 backfill has no transaction guard — a crash leaves half-migrated users. Recommend a single-transaction UPSERT.",
  },
  "demo.t2Thought": {
    zh: "先读迁移脚本确认双写窗口设计，再顺着登录成功路径看回填发生在哪个事务里。",
    en: "Read the migration to confirm the dual-write window design, then follow the login-success path to see which transaction the backfill lands in.",
  },
  "demo.t2Intro": {
    zh: "migration_007 的双写窗口设计正确，没有发现问题。风险在回填路径：",
    en: "migration_007's dual-write window is correctly designed — no issues found. The risk is in the backfill path:",
  },
  "demo.t2Item1": {
    zh: "登录验证成功后回填 argon2_hash 的 UPDATE 与会话签发不在同一事务",
    en: "The UPDATE backfilling argon2_hash after successful login is not in the same transaction as session issuance",
  },
  "demo.t2Item2": {
    zh: "崩溃窗口内会出现「已验证明文、未写入新哈希」的半迁移用户，下次登录会重复迁移（幂等，但浪费）",
    en: "Inside the crash window a half-migrated user (plaintext verified, new hash not written) appears; next login re-migrates (idempotent, but wasteful)",
  },
  "demo.t2Outro": {
    zh: "建议：回填改成单事务 UPSERT，失败时整单回滚，登录照常走旧哈希兜底。",
    en: "Recommend: make the backfill a single-transaction UPSERT that rolls back wholly on failure; login still falls back to the old hash.",
  },
  "demo.t2Feed4": {
    zh: "比对双写窗口与回填事务边界",
    en: "comparing dual-write window vs backfill transaction boundary",
  },
  "demo.t3Title": { zh: "session 管理补测试", en: "Backfill session-management tests" },
  "demo.t3Prompt": {
    zh: "给 session 管理补单测，覆盖：滑动过期、登出清缓存、记住我三条路径。跑绿为止。",
    en: "Add unit tests for session management covering sliding expiry, logout cache clearing, and remember-me. Until green.",
  },
  "demo.t3Result": {
    zh: "新增 session_test.go，3 个用例全绿。顺带发现登出没有清 redis 黑名单缓存（已在报告中标注，未改代码）。",
    en: "Added session_test.go, 3 cases all green. Also found logout does not clear the redis blacklist cache (noted in the report; no code changed).",
  },
  "demo.t3Thought": {
    zh: "先看 session/store.go 的三条路径，按行为逐条写用例，最后 go test 收口。",
    en: "Look at the three paths in session/store.go, write a case per behavior, then wrap up with go test.",
  },
  "demo.t3Intro": { zh: "新增 auth/session_test.go：", en: "Added auth/session_test.go:" },
  "demo.t3Item1": {
    zh: "滑动过期 — 过期前访问续期 30 分钟 ✓",
    en: "Sliding expiry — access before expiry extends 30 minutes ✓",
  },
  "demo.t3Item2": {
    zh: "登出 — session 键立即删除 ✓",
    en: "Logout — session key deleted at once ✓",
  },
  "demo.t3Item3": {
    zh: "记住我 — 持久 cookie + 30 天 TTL ✓",
    en: "Remember me — persistent cookie + 30-day TTL ✓",
  },
  "demo.t3Outro": {
    zh: "go test ./auth/... 全绿。顺带发现：登出未清 redis 黑名单缓存，留存到下个 TTL 窗口，已标注未改。",
    en: "go test ./auth/... all green. Side finding: logout leaves the redis blacklist cache until the next TTL window — noted, not changed.",
  },
  "demo.t3Feed4": { zh: "3 个用例全部通过", en: "3 cases all passing" },
  "demo.thinkingText": {
    zh: "用户要三路并行排查。拆成三个独立子任务：路由权限交给 explore（只读扫描），密码哈希交给 review（只审不改），session 管理交给 test-writer（补测试）。三个互不依赖，可以同时派发。",
    en: "The user wants a three-lane parallel audit. Split into three independent subtasks: route permissions to explore (read-only scan), password hashing to review (review only), session management to test-writer (add tests). The three have no dependencies and can be dispatched together.",
  },
  "demo.finalText": {
    zh: `三路排查都完成了，汇总：

· 路由权限（explore）：3 个 /api/admin/* 路由未挂 requireRole，其中 /api/admin/users 普通用户可直接访问 —— 高危
· 密码哈希（review）：迁移脚本正确，但登录后的回填没有事务保护，崩溃会留下半迁移用户
· session 管理（test-writer）：3 个用例全绿；顺带发现登出没清 redis 黑名单缓存

建议先修第 1 项，路由组统一注册中间件，一行改动覆盖全部缺口。`,
    en: `All three lanes finished — summary:

· Route permissions (explore): 3 /api/admin/* routes without requireRole; /api/admin/users is directly reachable by regular users — high risk
· Password hashing (review): the migration is correct, but the post-login backfill has no transaction guard; a crash leaves half-migrated users
· Session management (test-writer): 3 cases green; side finding — logout doesn't clear the redis blacklist cache

Fix item 1 first: register the middleware once on the route group; one line closes every gap.`,
  },

  // ── demo/mock-adapter.ts (generated/operational strings) ──────────────
  "demo.providerLocal": { zh: "Ollama 本地", en: "Ollama local" },
  "demo.newSessionTitle": { zh: "新对话", en: "New chat" },
  "demo.forkTitle": { zh: "{title} 的分支", en: "Fork of {title}" },
  "demo.forkFallback": { zh: "会话", en: "session" },
  "demo.exportTitle": { zh: "{title}（导出）", en: "{title} (exported)" },
  "demo.reply": {
    zh: "演示模式：这是一条模拟回复（真实环境里会走你的 opencode 后端）。你问的是「{text}」——切到真的 npm run dev 就能拿到流式真回复。",
    en: "Demo mode: this is a simulated reply (a real run would go through your opencode backend). You asked \u201c{text}\u201d — switch to a real npm run dev for streaming replies.",
  },
  "demo.thinking": {
    zh: "**组织回答**\n我先梳理用户的问题，再组织一段清晰、可执行的回答。",
    en: "**Organizing the answer**\nFirst I outline the user's question, then compose a clear, actionable answer.",
  },
  "demo.summary": {
    zh: "（演示摘要）这条会话先梳理了登录接口的三个问题（明文 MD5、无限流、双查库），随后把密码哈希迁移到 argon2 并给出三步上线计划；对比了 JWT 与 session 两种方案并按 JWT 落地（HS256、access token 15 分钟过期）；压测 500 并发 P95 312ms，修复了限流器的内存泄漏，补齐忘记密码 e2e。历史消息完整保留，后续对话只携带本摘要与最近几轮。",
    en: "(Demo summary) This session first mapped three problems with the login API (plaintext MD5, no rate limit, double DB reads), migrated password hashing to argon2 with a three-step rollout, compared JWT vs session and landed on JWT (HS256, 15-minute access tokens); load-tested 500 concurrent users at P95 312ms, fixed a rate-limiter memory leak, and added forgot-password e2e. History is fully kept; later turns carry only this summary plus the latest few rounds.",
  },
  "demo.openPathError": {
    zh: "demo 无法打开本地路径：{target}",
    en: "demo cannot open local paths: {target}",
  },
  "demo.terminalError": { zh: "demo 无法打开系统终端", en: "demo cannot open a system terminal" },
  "demo.convertStub": {
    zh: "（demo：{filename} 提取出的文本内容）",
    en: "(demo: text extracted from {filename})",
  },
  "demo.updateError": {
    zh: "demo 不支持应用内更新",
    en: "In-app updates are not supported in the demo",
  },

  // ── file browser: app.vue tabs, side-bar.vue tab, file-browser.vue,
  //    file-tree.vue, file-tree-node.vue, file-menu.vue, file-preview.vue ──
  "files.mainViewLabel": { zh: "中间栏视图", en: "Main view" },
  "files.sidebarViewLabel": { zh: "侧栏视图", en: "Sidebar view" },
  "files.tabCanvas": { zh: "分支画布", en: "Canvas" },
  "files.tabFiles": { zh: "文件浏览", en: "Files" },
  "files.tabSessions": { zh: "会话", en: "Sessions" },
  "files.back": { zh: "后退", en: "Back" },
  "files.forward": { zh: "前进", en: "Forward" },
  "files.up": { zh: "上一级目录", en: "Parent directory" },
  "files.refresh": { zh: "刷新当前目录", en: "Reload this directory" },
  "files.breadcrumb": { zh: "路径面包屑", en: "Path breadcrumb" },
  "files.pathPlaceholder": { zh: "输入路径或 ~/… 跳转", en: "Type a path or ~/… to jump" },
  "files.pathNotAbsolute": {
    zh: "请输入绝对路径，或以 ~ 开头的路径",
    en: "Enter an absolute path, or one starting with ~",
  },
  "files.pathLabel": { zh: "路径输入", en: "Path input" },
  "files.filterPlaceholder": { zh: "过滤当前目录…", en: "Filter this directory…" },
  "files.filterHere": { zh: "只过滤当前目录", en: "Filter this directory only" },
  "files.showHidden": { zh: "显示隐藏文件", en: "Show hidden files" },
  "files.toggleView": { zh: "列表 / 图标视图", en: "List / grid view" },
  "files.loading": { zh: "正在读取目录…", en: "Reading directory…" },
  "files.dirEmpty": { zh: "这个目录是空的", en: "This directory is empty" },
  "files.noMatch": { zh: "当前目录没有匹配的条目", en: "No matching entries in this directory" },
  "files.colName": { zh: "名称", en: "Name" },
  "files.colSize": { zh: "大小", en: "Size" },
  "files.colModified": { zh: "修改时间", en: "Modified" },
  "files.dirSizeDash": { zh: "—", en: "—" },
  "files.capped": {
    zh: "目录过大，仅显示前 {n} 条",
    en: "Directory too large; showing the first {n} entries",
  },
  "files.errNotFound": { zh: "路径不存在或已被删除", en: "Path does not exist or was deleted" },
  "files.errPermission": { zh: "没有读取权限", en: "No permission to read this" },
  "files.errTooLarge": { zh: "文件过大，无法预览", en: "File too large to preview" },
  "files.errNotADirectory": { zh: "这不是一个目录", en: "Not a directory" },
  "files.errBinary": { zh: "二进制文件，无法作为文本预览", en: "Binary file; no text preview" },
  "files.errUnknown": { zh: "读取失败", en: "Could not read this" },
  "files.previewEmpty": { zh: "选择文件即可预览", en: "Select a file to preview it" },
  "files.previewLoading": { zh: "正在预览…", en: "Loading preview…" },
  "files.truncated": { zh: "已截断", en: "truncated" },
  "files.truncatedTitle": {
    zh: "文件过大，只预览了开头部分",
    en: "The file is large; only its head is previewed",
  },
  "files.openSystem": { zh: "用系统应用打开", en: "Open with the system app" },
  "files.zoom": { zh: "放大预览（空格）", en: "Enlarge the preview (Space)" },
  "files.unzoom": { zh: "收起放大（Esc）", en: "Shrink the preview (Esc)" },
  "files.openFailed": { zh: "系统无法打开这个文件", en: "The system could not open this file" },
  "files.quickOpen": { zh: "在当前项目里快速查找文件", en: "Quick-find a file in this project" },
  "files.quickPlaceholder": {
    zh: "快速打开：项目内的文件名 / 路径…",
    en: "Quick open: file name / path in this project…",
  },
  "files.quickNoProject": { zh: "先选择一个项目", en: "Pick a project first" },
  "files.quickIncludeHidden": { zh: "搜索结果包含隐藏文件", en: "Include hidden files in results" },
  "files.quickHiddenShort": { zh: "隐藏", en: "hidden" },
  "files.quickCount": { zh: "{n} 个结果", en: "{n} results" },
  "files.quickFailed": { zh: "搜索失败", en: "Search failed" },
  "files.searching": { zh: "搜索中…", en: "Searching…" },
  "files.commonPlaces": { zh: "常用位置", en: "Common places" },
  "files.placeHome": { zh: "个人目录", en: "Home" },
  "files.placeDesktop": { zh: "桌面", en: "Desktop" },
  "files.placeDownloads": { zh: "下载", en: "Downloads" },
  "files.placeDocuments": { zh: "文稿", en: "Documents" },
  "files.pickFolder": { zh: "选择其他文件夹…", en: "Choose another folder…" },
  "files.projects": { zh: "项目", en: "Projects" },
  "files.toggleTree": { zh: "展开 / 收起", en: "Expand / collapse" },
  "files.menuOpenFolder": { zh: "打开文件夹", en: "Open folder" },
  "files.menuPreview": { zh: "快速预览", en: "Quick preview" },
  "files.menuReveal": { zh: "在文件列表中定位", en: "Reveal in file list" },
  "files.menuCopyAbsolute": { zh: "复制绝对路径", en: "Copy absolute path" },
  "files.menuCopyRelative": { zh: "复制项目相对路径", en: "Copy project-relative path" },
  "files.menuCopyRelativeTitle": {
    zh: "相对当前项目根目录：{base}",
    en: "Relative to the project root: {base}",
  },
  "files.menuCopyName": { zh: "复制名称", en: "Copy name" },
  "files.menuInsertDraft": { zh: "插入当前画布对话", en: "Insert into the current canvas draft" },
  "files.menuShowInFolder": { zh: "在文件管理器中显示", en: "Show in file manager" },
  "files.menuInfo": { zh: "查看信息", en: "Get info" },
  "files.copiedAbsolute": { zh: "已复制绝对路径", en: "Absolute path copied" },
  "files.copiedRelative": { zh: "已复制项目相对路径", en: "Project-relative path copied" },
  "files.copiedName": { zh: "已复制名称", en: "Name copied" },
  "files.copyFailed": { zh: "复制失败，请手动复制", en: "Copy failed — please copy manually" },
  "files.insertedDraft": { zh: "路径已插入画布草稿", en: "Path inserted into the canvas draft" },
  "files.draftSending": {
    zh: "正在提交，稍后再插入",
    en: "A send is in flight; try again shortly",
  },
  "files.noDraftTarget": {
    zh: "先选中一个回合或打开草稿",
    en: "Select a turn or open a draft first",
  },
  "files.showInFolderFailed": {
    zh: "无法在文件管理器中显示",
    en: "Could not show in the file manager",
  },
  "files.relativeBaseNote": {
    zh: "相对路径基准：当前项目根目录 ",
    en: "Relative base: project root ",
  },
  "files.relativeUnsupported": {
    zh: "跨盘符无法计算相对路径，请复制绝对路径",
    en: "No relative path across drives — copy the absolute path",
  },
  "files.close": { zh: "关闭", en: "Close" },
  "files.noProject": { zh: "未选择项目", en: "No project selected" },
  "files.infoKind": { zh: "种类", en: "Kind" },
  "files.infoSize": { zh: "大小", en: "Size" },
  "files.infoModified": { zh: "修改时间", en: "Modified" },
  "files.infoChildren": { zh: "直接子项", en: "Direct children" },
  "files.infoAbsolute": { zh: "绝对路径", en: "Absolute path" },
  "files.infoRelative": { zh: "项目相对路径", en: "Project-relative path" },
  "files.infoRelativeBase": { zh: "相对路径基准", en: "Relative base" },
  "files.infoDeleted": { zh: "已删除", en: "Deleted" },
  "files.infoDirSize": { zh: "文件夹（不计算大小）", en: "Folder (size not computed)" },
  "files.infoUnknown": { zh: "未知", en: "Unknown" },
  "files.kindDir": { zh: "文件夹", en: "Folder" },
  "files.kindFile": { zh: "文件", en: "File" },
  "files.kindSymlinkDir": { zh: "符号链接（文件夹）", en: "Symbolic link (folder)" },
  "files.kindSymlinkFile": { zh: "符号链接（文件）", en: "Symbolic link (file)" },
  "files.dropNoPath": {
    zh: "拿不到这些文件的真实路径，没有插入任何内容",
    en: "Could not resolve these files' real paths; nothing was inserted",
  },
  "files.dropNoTarget": {
    zh: "请把文件放到具体的对话草稿或回合卡片上",
    en: "Drop onto a specific draft or turn card",
  },
};
