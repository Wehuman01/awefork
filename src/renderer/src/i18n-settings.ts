/**
 * Settings-page dictionary. Kept in its own module — like i18n-panels for the
 * side surfaces — so the shell dictionary in i18n-shell stays about the top
 * bar and toasts. Keys use the `settings.` prefix and are merged into the
 * shared `t()` lookup.
 *
 * Every string here is UI chrome for the settings page itself; values that
 * belong to a backend (permission titles, tool names) are never translated.
 */
export const dict: Record<string, { zh: string; en: string }> = {
  // ── page chrome ──────────────────────────────────────────────────────
  "settings.title": { zh: "设置", en: "Settings" },
  "settings.prototype": { zh: "设计原型", en: "Prototype" },
  "settings.subtitle": {
    zh: "所有更改即时生效并自动保存。",
    en: "Every change applies immediately and saves itself.",
  },
  "settings.searchPlaceholder": { zh: "搜索设置…", en: "Search settings…" },
  "settings.searchEmpty": { zh: "没有匹配的设置", en: "No matching settings" },
  "settings.searchHint": {
    zh: "试试「主题」「端口」「预览」「压缩」",
    en: "Try “theme”, “port”, “preview”, “compress”",
  },
  "settings.close": { zh: "关闭设置", en: "Close settings" },
  "settings.closeHint": {
    zh: "点击面板外面或按 Esc 返回工作台",
    en: "Click outside or press Esc to return",
  },
  "settings.done": { zh: "完成", en: "Done" },
  "settings.autoSaved": { zh: "所有更改自动保存", en: "All changes saved automatically" },
  "settings.resetSection": { zh: "恢复本节默认", en: "Reset section" },
  "settings.proposed": { zh: "建议新增", en: "Proposed" },
  "settings.readOnly": { zh: "只读", en: "Read only" },

  // ── storage scope badges ─────────────────────────────────────────────
  "settings.storeLocal": { zh: "本机", en: "This machine" },
  "settings.storeApp": { zh: "应用设置", en: "App settings" },
  "settings.storeBackend": { zh: "按后端", en: "Per backend" },

  // ── nav groups ───────────────────────────────────────────────────────
  "settings.groupGeneral": { zh: "通用", en: "General" },
  "settings.groupAgents": { zh: "智能体", en: "Agents" },
  "settings.groupWorkbench": { zh: "工作台", en: "Workbench" },
  "settings.groupSystem": { zh: "系统", en: "System" },
  "settings.groupLabs": { zh: "实验室", en: "Labs" },

  // ── section titles / descriptions ────────────────────────────────────
  "settings.appearance": { zh: "外观", en: "Appearance" },
  "settings.appearanceDesc": {
    zh: "主题、密度与画布的观感。",
    en: "Theme, density and how the canvas looks.",
  },
  "settings.language": { zh: "语言与区域", en: "Language & region" },
  "settings.languageDesc": {
    zh: "界面语言和时间显示方式。",
    en: "Interface language and how times read.",
  },
  "settings.backend": { zh: "Agent 后端", en: "Agent backend" },
  "settings.backendDesc": {
    zh: "选择由哪个 CLI 驱动会话。切换后，新窗口和新会话使用它，已有会话原样保留。",
    en: "Pick the CLI that drives sessions. New windows and sessions use it; existing ones stay put.",
  },
  "settings.models": { zh: "模型", en: "Models" },
  "settings.modelsDesc": {
    zh: "模型目录来自各后端；收藏和最近使用按后端分别保存。",
    en: "The catalog comes from each backend; favorites and recents are stored per backend.",
  },
  "settings.canvas": { zh: "会话与画布", en: "Sessions & canvas" },
  "settings.canvasDesc": {
    zh: "窗口行为、默认视图、画布视角和等待确认的处理方式。",
    en: "Window behavior, default view, canvas framing and pending decisions.",
  },
  "settings.files": { zh: "文件与预览", en: "Files & preview" },
  "settings.filesDesc": {
    zh: "文件浏览器的默认行为和预览上限。",
    en: "File browser defaults and preview limits.",
  },
  "settings.search": { zh: "搜索", en: "Search" },
  "settings.searchDesc": {
    zh: "侧栏增强搜索的默认范围与上限；搜索框里的语法仍然优先。",
    en: "Defaults for the sidebar's enhanced search; in-box syntax always wins.",
  },
  "settings.shortcuts": { zh: "快捷键", en: "Keyboard shortcuts" },
  "settings.shortcutsDesc": {
    zh: "这些组合固定，暂不可改。",
    en: "Fixed for now — not rebindable yet.",
  },
  "settings.storage": { zh: "存储与数据", en: "Storage & data" },
  "settings.storageDesc": {
    zh: "会话覆盖层（标签、置顶、回收站）按后端存放；设置本身在应用目录。",
    en: "Session overlays (tags, pins, trash) are stored per backend; settings live in the app folder.",
  },
  "settings.updates": { zh: "更新与关于", en: "Updates & about" },
  "settings.updatesDesc": {
    zh: "版本、更新检查和项目链接。",
    en: "Version, update checks and project links.",
  },

  // ── appearance ───────────────────────────────────────────────────────
  "settings.theme": { zh: "主题", en: "Theme" },
  "settings.themeDesc": {
    zh: "跟随系统会随 macOS 的外观切换；深色使用「night soda」配色。",
    en: "Follow system tracks the macOS appearance; dark uses the night-soda palette.",
  },
  "settings.themeSystem": { zh: "跟随系统", en: "System" },
  "settings.themeLight": { zh: "明亮", en: "Light" },
  "settings.themeDark": { zh: "深色", en: "Dark" },
  "settings.density": { zh: "界面密度", en: "Interface density" },
  "settings.densityDesc": {
    zh: "紧凑模式收窄行高与内边距，一屏能看到更多会话。",
    en: "Compact narrows row height and padding to fit more sessions on screen.",
  },
  "settings.densityComfortable": { zh: "舒适", en: "Comfortable" },
  "settings.densityCompact": { zh: "紧凑", en: "Compact" },
  "settings.motion": { zh: "界面动效", en: "Motion" },
  "settings.motionDesc": {
    zh: "关闭后卡片、浮层和画布都不再做过渡动画。",
    en: "Turns off transitions on cards, popovers and the canvas.",
  },
  "settings.dotGrid": { zh: "画布点阵背景", en: "Canvas dot grid" },
  "settings.dotGridDesc": {
    zh: "分支画布背后的点阵底纹。",
    en: "The dotted backdrop behind the branch canvas.",
  },

  // ── language ─────────────────────────────────────────────────────────
  "settings.locale": { zh: "界面语言", en: "Interface language" },
  "settings.localeDesc": {
    zh: "切换后立即生效；会话内容不会被翻译。",
    en: "Applies immediately; session content is never translated.",
  },
  "settings.timeStyle": { zh: "时间显示", en: "Time format" },
  "settings.timeStyleDesc": {
    zh: "相对时间指「3 分钟前」；绝对时间显示具体时刻。",
    en: "Relative shows “3 min ago”; absolute shows the clock time.",
  },
  "settings.timeRelative": { zh: "相对", en: "Relative" },
  "settings.timeAbsolute": { zh: "绝对", en: "Absolute" },

  // ── backend ──────────────────────────────────────────────────────────
  "settings.warnRange": { zh: "CLI 版本兼容提示", en: "CLI version warnings" },
  "settings.warnRangeDesc": {
    zh: "CLI 版本超出已测试区间时，在后端名旁显示 ⚠（不拦截使用）。",
    en: "Shows a ⚠ next to the backend when its CLI leaves the tested range (never blocks).",
  },
  "settings.quitKeepAlive": { zh: "退出保留后台", en: "Keep on quit" },
  "settings.quitKeepAliveDesc": {
    zh: "开启后，退出 awefork 时保留可后台运行的后端；Pi 依赖本应用内的 RPC 子进程，会随退出停止。",
    en: "With this on, quitting keeps backends that can run detached; Pi uses app-owned RPC children and stops on quit.",
  },
  "settings.backendReady": { zh: "可用", en: "Ready" },
  "settings.backendMissing": { zh: "未安装", en: "Not installed" },
  "settings.backendWarn": { zh: "版本警告", en: "Version warning" },
  "settings.backendCurrent": { zh: "当前", en: "Active" },
  "settings.switchBackend": { zh: "切换到 {label}", en: "Switch to {label}" },
  "settings.installLatest": { zh: "安装最新版 {label}", en: "Install latest {label}" },
  "settings.installingBackend": { zh: "安装中…", en: "Installing…" },

  // ── first-run agent guide ────────────────────────────────────────────
  "onboard.kicker": { zh: "👋 欢迎使用 awefork", en: "👋 Welcome to awefork" },
  "onboard.title": { zh: "先装一个编码智能体", en: "Install a coding agent first" },
  "onboard.lede": {
    zh: "awefork 需要本机装有至少一个 agent CLI。推荐 opencode —— 开箱即用、功能支持最全。",
    en: "awefork drives local agent CLIs. opencode is recommended — ready out of the box with the fullest feature support.",
  },
  "onboard.recommended": { zh: "推荐", en: "Recommended" },
  "onboard.desc.opencode": {
    zh: "开源编码智能体，awefork 的默认后端，功能支持最全。",
    en: "Open-source coding agent; awefork's default backend with the fullest support.",
  },
  "onboard.desc.codex": {
    zh: "OpenAI 的 Codex CLI。",
    en: "OpenAI's Codex CLI.",
  },
  "onboard.desc.pi": {
    zh: "轻量的 pi 编码智能体。",
    en: "The lightweight pi coding agent.",
  },
  "onboard.install": { zh: "安装最新版", en: "Install latest" },
  "onboard.installing": { zh: "安装中…", en: "Installing…" },
  "onboard.skip": { zh: "稍后再说", en: "Later" },
  "onboard.esc": {
    zh: "点击「稍后再说」或按 Esc 跳过；之后可在设置 → 智能体里随时安装。",
    en: "Skip with “Later” or Esc; install anytime later in Settings → Agents.",
  },

  // ── models ───────────────────────────────────────────────────────────
  "settings.favoriteModels": { zh: "收藏的模型", en: "Favorite models" },
  "settings.favoriteModelsDesc": {
    zh: "收藏的模型排在模型选择器最上面。",
    en: "Favorites sit at the top of the model picker.",
  },
  "settings.favoriteModelsEmpty": {
    zh: "还没有收藏；在模型选择器里点 ☆ 即可。",
    en: "Nothing starred yet — tap ☆ in the model picker.",
  },
  "settings.favoriteModelsScope": {
    zh: "收藏按后端分开保存；切换后端会看到各自的一份。",
    en: "Favorites are stored per backend; switching shows that backend's set.",
  },

  // ── canvas ───────────────────────────────────────────────────────────
  "settings.multiWindow": { zh: "多窗口模式", en: "Multi-window mode" },
  "settings.multiWindowDesc": {
    zh: "开启后，切换后端会打开（或聚焦）该 Agent 的专属窗口，而不是就地切换。",
    en: "With this on, switching backend opens or focuses that agent's own window instead of switching in place.",
  },
  "settings.defaultView": { zh: "默认打开的视图", en: "Default view" },
  "settings.defaultViewDesc": {
    zh: "启动时，中间栏显示画布还是文件浏览器。",
    en: "Whether the middle column opens on the canvas or the file browser.",
  },
  "settings.autoFit": { zh: "打开时自动适配视图", en: "Fit view on open" },
  "settings.sessionsInNewTab": { zh: "在新标签打开会话", en: "Open sessions in new tabs" },
  "settings.sessionsInNewTabDesc": {
    zh: "开启后，新建会话或在列表里点击其他会话，都会打开一个新的标签页，而不是替换当前标签里的内容。",
    en: "With this on, creating a session or clicking another one in a list opens it in a fresh tab instead of replacing the active tab.",
  },
  "settings.autoFitDesc": {
    zh: "选中会话或切换故事标签时，把整棵分支树缩放进视口。",
    en: "Zooms the whole branch tree into view when a session or story tab opens.",
  },
  "settings.minimap": { zh: "显示小地图", en: "Show minimap" },
  "settings.minimapDesc": {
    zh: "画布角落的缩略图；点击或拖动可跳转。",
    en: "The thumbnail in the canvas corner; click or drag to jump.",
  },
  "settings.autoDeny": { zh: "等待确认的自动拒绝", en: "Auto-deny pending decisions" },
  "settings.autoDenyDesc": {
    zh: "Agent 请求确认后，超过这个时间没有回应就自动拒绝。",
    en: "When the agent asks for approval, deny automatically after this long.",
  },
  "settings.autoDenyNever": { zh: "不自动", en: "Never" },
  "settings.confirmDelete": { zh: "删除回合前二次确认", en: "Confirm before deleting a turn" },
  "settings.confirmDeleteDesc": {
    zh: "删除回合不可撤销，因此默认确认；关闭后删除立即生效。会话删除仍可从历史面板撤销。",
    en: "Turn deletes have no undo, so they confirm by default; turning this off deletes at once. Session deletes stay undoable either way.",
  },
  "settings.resetLayout": { zh: "恢复默认布局", en: "Reset layout" },
  "settings.resetLayoutDesc": {
    zh: "把侧栏与右栏的宽度、折叠状态和文件停靠区恢复为默认。",
    en: "Restores the sidebar and context panel widths, folded states and the file dock.",
  },
  "settings.resetLayoutBtn": { zh: "重置布局", en: "Reset" },
  "settings.layoutReset": { zh: "侧栏与右栏已恢复默认", en: "Panel layout restored" },

  // ── files ────────────────────────────────────────────────────────────
  "settings.showHidden": { zh: "默认显示隐藏文件", en: "Show hidden files by default" },
  "settings.showHiddenDesc": {
    zh: "以点开头的文件与目录。",
    en: "Files and folders whose names start with a dot.",
  },
  "settings.fileView": { zh: "默认视图", en: "Default view" },
  "settings.fileViewDesc": {
    zh: "文件浏览器打开时的列表形态。",
    en: "How the file browser lists entries.",
  },
  "settings.viewList": { zh: "列表", en: "List" },
  "settings.viewGrid": { zh: "网格", en: "Grid" },
  "settings.previewCap": { zh: "文本预览上限", en: "Text preview limit" },
  "settings.previewCapDesc": {
    zh: "超过上限的文本会被截断，并标出「已截断」。",
    en: "Text past the limit is truncated and marked as such.",
  },
  "settings.imageCap": { zh: "图片预览上限", en: "Image preview limit" },
  "settings.imageCapDesc": {
    zh: "更大的图片只显示占位信息，不载入内存。",
    en: "Larger images show metadata only.",
  },
  "settings.openOnDouble": { zh: "双击文件", en: "Double-click a file" },
  "settings.openOnDoubleDesc": {
    zh: "默认在应用内预览；也可以交给系统默认应用打开（右键始终有这一项）。",
    en: "Previews inside the app by default; hand it to the system default app instead (the right-click always offers that).",
  },
  "settings.openSystem": { zh: "系统打开", en: "System app" },
  "settings.openPreview": { zh: "应用内预览", en: "In-app preview" },
  "settings.filesIgnore": { zh: "忽略的目录与文件", en: "Ignored names" },
  "settings.filesIgnoreDesc": {
    zh: "文件浏览器和侧栏文件树里隐藏这些名称；支持 * 通配符，用逗号分隔。",
    en: "Hidden from the file browser and the sidebar tree. Supports * wildcards; separate with commas.",
  },

  // ── search ───────────────────────────────────────────────────────────
  "settings.searchScopes": { zh: "默认搜索范围", en: "Default search scope" },
  "settings.searchScopesDesc": {
    zh: "正文·全文最慢；关闭后仍可在搜索框里用 body: 临时打开。",
    en: "Body search is the slowest; body: in the search box still enables it per query.",
  },
  "settings.searchCap": { zh: "默认结果上限", en: "Default result cap" },
  "settings.searchCapDesc": {
    zh: "会话很多时，上限越小搜索越快。",
    en: "A lower cap keeps search fast in large libraries.",
  },
  "settings.searchAll": { zh: "全部", en: "All" },
  "settings.searchSyntax": { zh: "搜索语法", en: "Search syntax" },
  "settings.searchSyntaxDesc": {
    zh: "语法写在搜索框里，优先级高于上面的默认范围。",
    en: "Written in the search box; it wins over the default scope above.",
  },

  // ── shortcuts ────────────────────────────────────────────────────────
  "settings.scOpenSettings": { zh: "打开设置", en: "Open settings" },
  "settings.scCloseSettings": { zh: "关闭设置", en: "Close settings" },
  "settings.scPalette": { zh: "命令面板", en: "Command palette" },
  "settings.scPaletteDesc": { zh: "搜索会话或执行动作", en: "Search sessions or run actions" },
  "settings.scSearchCanvas": { zh: "搜索画布节点", en: "Search canvas" },
  "settings.scSearchCanvasDesc": { zh: "提问 / 回复 / 工具", en: "Prompt / reply / tools" },
  "settings.scHistory": { zh: "历史面板", en: "History panel" },
  "settings.scHistoryDesc": { zh: "撤销与重做", en: "Undo and redo" },
  "settings.scUndo": { zh: "撤销 / 重做", en: "Undo / redo" },
  "settings.scUndoDesc": { zh: "输入框内保持文本撤销", en: "Stays text undo while typing" },

  // ── storage ──────────────────────────────────────────────────────────
  "settings.dataDir": { zh: "应用数据目录", en: "App data folder" },
  "settings.dataDirDesc": {
    zh: "settings.json、update.json、各后端的会话覆盖层与更新缓存都放在这里。",
    en: "settings.json, update.json, per-backend session overlays and update caches live here.",
  },
  "settings.openFolder": { zh: "打开", en: "Open" },
  "settings.overlay": { zh: "覆盖存储", en: "Overlay stores" },
  "settings.overlayDesc": {
    zh: "纯叠加，永不改写 Agent 自己的存储；除 opencode 的旧版裸文件外，文件名都带后端后缀。",
    en: "Pure overlay — never rewrites agent storage. Every file carries a backend suffix except opencode's legacy bare ones.",
  },
  "settings.archive": { zh: "归档", en: "Archive" },
  "settings.archiveDesc": {
    zh: "归档项从所有视图隐藏，可在侧栏底部的归档区恢复或彻底删除。",
    en: "Archived items hide from every view; restore or delete them in the sidebar's archive section.",
  },
  "settings.archiveCount": {
    zh: "{sessions} 个会话 · {dirs} 个项目",
    en: "{sessions} sessions · {dirs} projects",
  },
  "settings.trash": { zh: "回收站", en: "Trash" },
  "settings.trashDesc": {
    zh: "已删除的会话先放进回收站，可随时放回；当前有 {count} 个。",
    en: "Deleted sessions land here and can be restored; {count} right now.",
  },
  "settings.emptyTrash": { zh: "清空回收站", en: "Empty trash" },
  "settings.trashEmpty": { zh: "回收站已空", en: "Trash is empty" },
  "settings.export": { zh: "导出", en: "Export" },
  "settings.import": { zh: "导入", en: "Import" },
  "settings.exportImport": { zh: "导出 / 导入设置", en: "Export / import settings" },
  "settings.exportImportDesc": {
    zh: "导出当前偏好的 JSON；导入时只覆盖文件里出现的键。",
    en: "Export the current preferences as JSON; importing only overwrites the keys the file contains.",
  },
  "settings.exported": { zh: "已导出设置", en: "Settings exported" },
  "settings.imported": { zh: "已导入设置", en: "Settings imported" },
  "settings.importInvalid": { zh: "不是有效的设置文件", en: "Not a valid settings file" },
  "settings.resetAll": { zh: "重置全部设置", en: "Reset all settings" },
  "settings.resetAllDesc": {
    zh: "恢复到出厂默认。会话、标签、置顶和回收站不受影响。",
    en: "Back to factory defaults. Sessions, tags, pins and trash are untouched.",
  },
  "settings.resetAllBtn": { zh: "重置…", en: "Reset…" },
  "settings.resetAllConfirm": {
    zh: "把全部设置恢复为默认？会话、标签与置顶不受影响。",
    en: "Reset every setting to its default? Sessions, tags and pins are untouched.",
  },
  "settings.resetDone": { zh: "已恢复全部默认", en: "All settings reset" },

  // ── labs ─────────────────────────────────────────────────────────────
  "settings.labs": { zh: "实验室", en: "Labs" },
  "settings.labsDesc": {
    zh: "还在打磨的新功能。默认关闭，随时可能调整或下线。",
    en: "New features still taking shape. Off by default; may change or be pulled back.",
  },
  "settings.labsFileBrowser": { zh: "文件浏览", en: "File browsing" },
  "settings.labsFileBrowserDesc": {
    zh: "中列文件浏览器、侧栏文件树和文件坞跳转。关闭时回到会话视图。",
    en: "Middle-column browser, sidebar file tree and dock jumps. Off falls back to session views.",
  },
  "settings.labsParallelModels": { zh: "多模型发送", en: "Multi-model prompts" },
  "settings.labsParallelModelsDesc": {
    zh: "把同一个问题同时发给多个模型，分支并排阅读，并生成汇总。关闭后回到单模型发送。",
    en: "Send one prompt to several models at once, read the branches side by side, and get a summary. Off falls back to a single model.",
  },
  "settings.parallelDefaults": { zh: "默认模型与汇总", en: "Default models & summary" },
  "settings.parallelDefaultsDesc": {
    zh: "打开多模型模式时预选这些模型（含各自强度）；汇总模型与长度决定每轮结束后的汇总方式，可以选「不汇总」。",
    en: "Pre-selected when multi-model mode opens, each with its effort; the summary model and length shape every round — pick “No summary” to skip it.",
  },
  "settings.parallelDefaultsCount": { zh: "{n} 个模型", en: "{n} models" },
  "settings.parallelDefaultsEmpty": { zh: "未设置", en: "Not set" },
  "settings.labsNote": { zh: "关于实验室", en: "About Labs" },
  "settings.labsNoteDesc": {
    zh: "功能稳定后会从实验室毕业，进入正式分区；关闭开关不会丢失相关偏好。",
    en: "Features graduate into the regular sections once stable; turning a switch off keeps its preferences.",
  },
  "settings.sectionReset": { zh: "已恢复本节默认", en: "Section reset" },
  "settings.saved": { zh: "已保存", en: "Saved" },

  // ── updates ──────────────────────────────────────────────────────────
  "settings.currentVersion": { zh: "当前版本", en: "Current version" },
  "settings.checkNow": { zh: "检查更新", en: "Check for updates" },
  "settings.checking": { zh: "检查中…", en: "Checking…" },
  "settings.upToDate": { zh: "已是最新", en: "Up to date" },
  "settings.checkOnLaunch": { zh: "启动时检查更新", en: "Check for updates at startup" },
  "settings.checkOnLaunchDesc": {
    zh: "通过 GitHub Releases 查询；检查失败保持静默，不打断启动。",
    en: "Queries GitHub Releases; failures stay silent and never block startup.",
  },
  "settings.links": { zh: "链接", en: "Links" },
  "settings.linksDesc": { zh: "都在系统浏览器里打开。", en: "All open in your system browser." },
  "settings.releaseNotes": { zh: "发布说明", en: "Release notes" },
  "settings.projectHome": { zh: "项目主页", en: "Project home" },
  "settings.reportIssue": { zh: "报告问题", en: "Report an issue" },
  "settings.license": { zh: "许可证 MPL-2.0", en: "License MPL-2.0" },

  // ── top bar ──────────────────────────────────────────────────────────
  "topbar.settings": { zh: "设置（{mod},）", en: "Settings ({mod},)" },
  "topbar.themeSystem": {
    zh: "跟随系统（点击切换到明亮）",
    en: "Following the system (click for light)",
  },
};
