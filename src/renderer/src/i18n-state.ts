/**
 * State-surface dictionary: zh/en entries for every user-visible string
 * state.ts produces — history entry labels, actionError toasts, confirm()
 * messages, delete/archive guards and update-download notices.
 *
 * Merged into i18n.ts's DICT at module load, so lookups go through that
 * file's single `t()` (same `{name}` interpolation and unknown-key
 * passthrough semantics). History labels are
 * computed at action time through `t()`, so entries persist in the locale
 * that was active when the action happened (zh by default).
 */
type Entry = { zh: string; en: string };

export const dict: Record<string, Entry> = {
  // ── archive view fallback / status text ────────────────────────────────
  "state.deletedSessionTitle": { zh: "(已删除)", en: "(deleted)" },

  // ── compression (🗜 toast + errors) ────────────────────────────────────
  "state.compressedToast": {
    zh: "🗜 已压缩「{title}」— 历史仍完整保留，后续对话只携带摘要与最近几轮",
    en: '🗜 Compressed "{title}" — history is kept intact; later prompts carry the summary plus the most recent turns',
  },
  "state.sessionRunningCompress": {
    zh: "会话正在运行，等它结束后再压缩",
    en: "Session is running — wait for it to finish before compressing",
  },
  "state.noModelsForCompress": {
    zh: "暂时拿不到模型列表，无法压缩",
    en: "Model list unavailable right now; can't compress",
  },
  "state.compressFailed": { zh: "压缩失败：{error}", en: "Compress failed: {error}" },

  // ── history labels: pins / marks / tags ────────────────────────────────
  "state.pinLabel": { zh: "置顶「{title}」", en: 'Pinned "{title}"' },
  "state.unpinLabel": { zh: "取消置顶「{title}」", en: 'Unpinned "{title}"' },
  "state.markLabel": { zh: "标记关键对话「{title}」", en: 'Marked key turn "{title}"' },
  "state.unmarkLabel": { zh: "取消关键标记「{title}」", en: 'Unmarked key turn "{title}"' },
  "state.tagsAddLabel": {
    zh: "添加标签「{tags}」到「{title}」",
    en: 'Added tags "{tags}" to "{title}"',
  },
  "state.tagsRemoveLabel": {
    zh: "从「{title}」移除标签「{tags}」",
    en: 'Removed tags "{tags}" from "{title}"',
  },
  "state.tagsModifyLabel": { zh: "修改「{title}」的标签", en: 'Changed tags of "{title}"' },
  "state.tagColorReset": {
    zh: "恢复标签「{tag}」默认色",
    en: 'Reset tag "{tag}" to its default color',
  },
  "state.tagColorSet": { zh: "设置标签「{tag}」颜色", en: 'Set tag "{tag}" color' },
  "state.tagDeleteLabel": { zh: "删除标签「{tag}」", en: 'Deleted tag "{tag}"' },

  // ── history labels: fork tag inheritance / subtree ─────────────────────
  "state.forkPrefAlways": { zh: "始终继承", en: "Always inherit" },
  "state.forkPrefNever": { zh: "从不继承", en: "Never inherit" },
  "state.forkPrefAsk": { zh: "每次询问", en: "Ask every time" },
  "state.forkPrefLabel": {
    zh: "「{title}」分叉时继承标签：{mode}",
    en: 'Fork tag inheritance for "{title}": {mode}',
  },
  "state.subtreeTagsLabel": {
    zh: "标签「{tags}」应用到「{title}」的 {n} 个子会话",
    en: 'Applied tags "{tags}" to {n} child sessions of "{title}"',
  },
  "state.forkInheritTagsFailed": {
    zh: "分叉已创建，但标签继承失败：{error}",
    en: "Fork created, but tag inheritance failed: {error}",
  },

  // ── session delete (guards, confirm, label) ────────────────────────────
  "state.sessionRunningDelete": {
    zh: "会话正在运行，先停止再删除。",
    en: "Session is running — stop it before deleting.",
  },
  "state.redoSessionGone": {
    zh: "会话已不存在，无法重做删除。",
    en: "Session no longer exists; cannot redo the delete.",
  },
  "state.confirmRedelete": { zh: "再删除会话「{title}」？", en: 'Delete session "{title}" again?' },
  "state.confirmDeleteSession": {
    zh: "删除会话「{title}」？\n将删除这条会话的全部回合（不只是这张卡片），分出去的子分支保留。\n删除后可随时按 ⌘/Ctrl+Z 撤销，或在右下角历史面板回退。",
    en: 'Delete session "{title}"?\nThis removes every turn of the session (not just this card); forked branches are kept.\nYou can undo anytime with ⌘/Ctrl+Z, or step back in the history panel at the bottom right.',
  },
  "state.deleteSessionLabel": { zh: "删除会话「{title}」", en: 'Deleted session "{title}"' },
  "state.deleteTurnLabel": { zh: "删除回合「{title}」", en: 'Deleted turn "{title}"' },

  // ── history labels: archive / restore / create / dirs / rename ─────────
  "state.archiveSessionLabel": { zh: "归档会话「{title}」", en: 'Archived session "{title}"' },
  "state.archiveDirectoryLabel": {
    zh: "归档目录「{path}」",
    en: 'Archived directory "{path}"',
  },
  "state.restoreSessionLabel": { zh: "恢复会话「{title}」", en: 'Restored session "{title}"' },
  "state.restoreDirectoryLabel": {
    zh: "恢复目录「{path}」",
    en: 'Restored directory "{path}"',
  },
  "state.createSessionLabel": { zh: "新建会话「{title}」", en: 'Created session "{title}"' },
  "state.addDirectoryLabel": { zh: "添加目录「{path}」", en: 'Added directory "{path}"' },
  "state.removeDirectoryLabel": { zh: "移除目录「{path}」", en: 'Removed directory "{path}"' },
  "state.renameLabel": { zh: "重命名「{from}」→「{to}」", en: 'Renamed "{from}" → "{to}"' },

  // ── prompts / abort / export ───────────────────────────────────────────
  "state.sendPromptLabel": { zh: "发送消息「{text}」", en: 'Sent message "{text}"' },
  "state.abortRunLabel": { zh: "停止运行「{title}」", en: 'Stopped run "{title}"' },
  "state.exportSessionLabel": {
    zh: "导出独立会话「{title}」",
    en: 'Exported standalone session "{title}"',
  },
  "state.exportFailed": { zh: "导出失败：{error}", en: "Export failed: {error}" },
  "state.branchExportFallbackTitle": { zh: "awefork 分支", en: "awefork branch" },
  "state.terminalOpenFailed": {
    zh: "无法在终端中打开会话",
    en: "Couldn't open the session in a terminal",
  },

  // ── backend switch / update download ──────────────────────────────────
  "state.switchBackendFailed": {
    zh: "无法切换到 {backend}。",
    en: "Couldn't switch to {backend}.",
  },
  "state.updaterLaunched": {
    zh: "更新安装器已启动，按提示完成安装",
    en: "Update installer launched — follow the prompts to finish",
  },
  "state.downloadFailed": { zh: "下载失败", en: "Download failed" },
  "state.downloadFailedRetry": {
    zh: "下载失败，可重试或手动下载",
    en: "Download failed — retry or download manually",
  },
};
