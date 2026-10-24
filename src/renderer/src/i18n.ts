/**
 * A deliberately small i18n layer: one `locale` ref, a flat `zh`/`en`
 * dictionary, and a `t(key, vars?)` that interpolates `{name}` placeholders.
 *
 * Why no vue-i18n: the strings this covers are the recent opencode-ask +
 * per-agent-window feature surface, not the whole app. A flat dictionary
 * matches the codebase's no-dependency style, and `t()` returns the key
 * verbatim when it is unknown — so strings the backend still ships as prose
 * (codex permission titles, opencode field titles) render unchanged without
 * every call site needing a guard.
 *
 * `locale` is read from and written to `localStorage` under `awefork:locale`,
 * mirroring the `awefork:multiWindow` preference in top-bar.vue: the value
 * survives restarts and is visible to every window at its own boot. Default
 * is `"zh"` so the UI stays Chinese unless the user picks EN.
 */
import { computed, ref, watch } from "vue";
import { dict as dictDialogs } from "./i18n-dialogs";
import { dict as dictMessages } from "./i18n-messages";
import { dict as dictPanels } from "./i18n-panels";
import { dict as dictSettings } from "./i18n-settings";
import { dict as dictShell } from "./i18n-shell";
import { dict as dictState } from "./i18n-state";
import { modKey } from "./platform-key";
import { settings } from "./settings";

export type Locale = "zh" | "en";

export const locale = ref<Locale>(settings.language.locale);

/** List separator matching the locale's typographic convention (、 vs ", "). */
export const listSep = computed(() => (locale.value === "zh" ? "、" : ", "));

/**
 * Mirror the locale onto <html lang>. Screen readers, spellcheck and the
 * browser's own CJK font fallback all key off it, and the settings page is
 * the first place a user can change the language without a restart.
 */
function stampLang(next: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = next;
}
stampLang(locale.value);

export function setLocale(next: Locale): void {
  locale.value = next;
  settings.language.locale = next;
  stampLang(next);
}

// Resetting the language section (or all settings) writes the blob directly
// without going through setLocale; follow it so the UI language flips too.
watch(
  () => settings.language.locale,
  (next) => {
    if (next !== locale.value) {
      locale.value = next;
      stampLang(next);
    }
  },
);

type Entry = { zh: string; en: string };
type Dict = Record<string, Entry>;

const DICT: Dict = {
  // ── interaction dialog (modal) ────────────────────────────────────────
  "interaction.waitingDecision": {
    zh: "{backend} 正在等待你的决定",
    en: "{backend} is waiting for your decision",
  },
  "interaction.workingDir": { zh: "运行目录：{cwd}", en: "Working dir: {cwd}" },
  "interaction.requestWrite": { zh: "请求写入：{root}", en: "Requests write: {root}" },
  "interaction.server": { zh: "服务：{name}", en: "Server: {name}" },
  "interaction.matchedRule": { zh: "匹配规则：{rule}", en: "Matched rule: {rule}" },
  "interaction.selectPlaceholder": { zh: "请选择", en: "Please select" },
  "interaction.cancel": { zh: "取消", en: "Cancel" },
  "interaction.deny": { zh: "拒绝", en: "Deny" },
  "interaction.submit": { zh: "提交", en: "Submit" },
  "interaction.allowOnce": { zh: "允许本次", en: "Allow once" },
  "interaction.allowAlways": { zh: "总是允许", en: "Always allow" },
  "interaction.allowAlwaysWith": { zh: "总是允许 {rule}", en: "Always allow {rule}" },
  "interaction.autoDeny": {
    zh: "{seconds} 秒内未响应将自动拒绝",
    en: "Auto-denies in {seconds}s without a response",
  },
  "interaction.queueDepth": { zh: "还有 {n} 个待确认", en: "{n} more pending" },
  "interaction.inlineQueueDepth": {
    zh: "同会话还有 {n} 个待确认",
    en: "{n} more pending in this session",
  },
  "interaction.inlineWaitConfirm": {
    zh: "⏸ 等待你的确认 · {perm}",
    en: "⏸ Awaiting your confirmation · {perm}",
  },
  "interaction.inlineWaitInput": { zh: "⏸ 等待你的输入", en: "⏸ Awaiting your input" },
  "interaction.inlineWaitDecision": {
    zh: "⏸ 等待你的决定",
    en: "⏸ Awaiting your decision",
  },

  // ── interaction form (validation + placeholders) ──────────────────────
  "form.selectAtLeastOne": {
    zh: "{label}：请至少选择一项",
    en: "{label}: select at least one",
  },
  "form.selectAtLeastN": { zh: "{label}：请至少选择 {n} 项", en: "{label}: select at least {n}" },
  "form.selectAtMostN": { zh: "{label}：最多选择 {n} 项", en: "{label}: select at most {n}" },
  "form.required": { zh: "{label}：必填", en: "{label}: required" },
  "form.enterInteger": { zh: "{label}：请输入整数", en: "{label}: enter an integer" },
  "form.enterNumber": { zh: "{label}：请输入数字", en: "{label}: enter a number" },
  "form.minError": { zh: "{label}：不能小于 {min}", en: "{label}: must not be less than {min}" },
  "form.maxError": { zh: "{label}：不能大于 {max}", en: "{label}: must not be greater than {max}" },
  "form.pleaseSelect": { zh: "请选择", en: "Please select" },
  "form.other": { zh: "其他…", en: "Other…" },
  "form.pleaseEnter": { zh: "请输入", en: "Enter a value" },

  // ── opencode adapter interaction titles/details/errors ──────────────────
  "opencode.permissionTitle": { zh: "允许这次操作？", en: "Allow this action?" },
  "opencode.permissionDetail": {
    zh: `一条 {perm} 操作匹配了你的"需确认"权限规则，等待你决定。`,
    en: `A {perm} action matched your "ask" permission rule; awaiting your decision.`,
  },
  "opencode.formDetail": {
    zh: "opencode 需要你填写一份表单后才能继续。",
    en: "opencode needs you to fill in a form to continue.",
  },
  "opencode.formTitleFallback": { zh: "需要你的输入", en: "Your input is needed" },

  // ── demo (mock-adapter) form + permission asks ─────────────────────────
  "mock.githubMcpTitle": { zh: "连接 GitHub MCP", en: "Connect GitHub MCP" },
  "mock.githubMcpDetail": {
    zh: "opencode 需要完成一次 OAuth 授权才能继续本次运行。",
    en: "opencode needs to complete an OAuth authorization to continue this run.",
  },
  "mock.permTitle": { zh: "opencode 请求执行命令", en: "opencode requests to run a command" },
  "mock.permDetail": {
    zh: "运行 rm -rf node_modules 需要你的确认。",
    en: "Running rm -rf node_modules needs your confirmation.",
  },
  "mock.fieldAccount": { zh: "账号", en: "Account" },
  "mock.fieldScope": { zh: "授权范围", en: "Scopes" },
  "mock.fieldTtl": { zh: "有效期（天）", en: "TTL (days)" },
  "mock.fieldTeams": { zh: "同步的团队", en: "Teams to sync" },
  "mock.fieldRemember": { zh: "记住此授权", en: "Remember this authorization" },
  "mock.fieldDocs": { zh: "授权说明", en: "Authorization docs" },
  "mock.scopeRepo": { zh: "仓库读写", en: "Repo read/write" },
  "mock.scopeRead": { zh: "只读", en: "Read-only" },

  // ── top-bar (per-agent window feature + language switch) ───────────────
  "topbar.switchToWithWindow": {
    zh: "切换到 {label}（右键：在新窗口打开）",
    en: "Switch to {label} (right-click: open in new window)",
  },
  "topbar.notOnPath": { zh: "未在 PATH 上找到 {label} CLI", en: "{label} CLI not found on PATH" },
  "topbar.multiWindowOn": {
    zh: "多窗口已开：点 Agent 会在独立窗口打开（同一 Agent 只聚焦已有窗口）",
    en: "Multi-window on: clicking an agent opens it in its own window (same agent just focuses the existing one)",
  },
  "topbar.multiWindowOff": {
    zh: "多窗口已关：点 Agent 在当前窗口内切换；打开后点击将新开独立窗口",
    en: "Multi-window off: clicking an agent switches in place; turn on to open each in its own window",
  },
  "topbar.multiWindowLabel": { zh: "独立窗口", en: "Separate windows" },

  // ── top-bar quit keep-alive toggle ──────────────────────────────────────
  "topbar.quitKeepAliveLabel": { zh: "退出保留后台", en: "Keep on quit" },
  "topbar.quitKeepAliveOn": {
    zh: "已开：退出 awefork 后后端继续在后台运行，进行中的任务会完成并写入会话记录",
    en: "On: quitting leaves the backends running so in-flight turns finish and land in their session files",
  },
  "topbar.quitKeepAliveOff": {
    zh: "已关：退出 awefork 会停止所有后端并中断进行中的任务（有任务在跑时会先弹确认）",
    en: "Off: quitting stops every backend and interrupts in-flight runs (a confirmation asks first when runs are going)",
  },
  "topbar.quitKeepAlivePromptKicker": {
    zh: "退出保留后台",
    en: "Keep on quit",
  },
  "topbar.quitKeepAlivePromptTitle": {
    zh: "有 {count} 个任务正在后台运行",
    en: "{count} task(s) running in the background",
  },
  "topbar.quitKeepAlivePromptPoint1": {
    zh: "开启后退出 awefork 不会关闭这些任务，它们会继续跑完并写入各自的会话记录",
    en: "With this on, quitting will not close them — they finish and land in their session files",
  },
  "topbar.quitKeepAlivePromptPoint2": {
    zh: "关闭此开关（默认）则退出即停止全部后端并中断这些任务",
    en: "Leaving it off (the default) stops every backend and interrupts them on quit",
  },
  "topbar.quitKeepAlivePromptConfirm": { zh: "开启保留", en: "Turn on keep-alive" },

  // ── state.ts visible strings ───────────────────────────────────────────
  "error.openWindowFailed": {
    zh: "无法打开 {backend} 窗口。",
    en: "Failed to open the {backend} window.",
  },
  "interaction.respondAllow": { zh: "允许交互请求", en: "Allow interaction request" },
  "interaction.respondAlways": { zh: "总是允许交互请求", en: "Always allow interaction request" },
  "interaction.respondDeny": { zh: "拒绝交互请求", en: "Deny interaction request" },
  "interaction.respondCancel": { zh: "取消交互请求", en: "Cancel interaction request" },
  "interaction.respondAnswers": { zh: "回答交互问题", en: "Answer interaction question" },

  // ── app-level (actionError toast) ──────────────────────────────────────
  "app.clickToClose": { zh: "（点击关闭）", en: " (click to close)" },
};

// Per-surface dictionaries (state/shell/dialogs/messages/panels) live in
// sibling i18n-*.ts modules and are merged in here so every call site uses
// the single `t()` below. The fragments import nothing from this file, so
// the merge stays cycle-free.
Object.assign(DICT, dictState, dictShell, dictDialogs, dictMessages, dictPanels, dictSettings);

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Look up `key` in the current locale's dictionary and interpolate `{name}`
 * placeholders from `vars`. An unknown key is returned verbatim — this is the
 * escape hatch for strings the backend still ships as prose (a codex
 * permission title, an opencode field title): they pass through `t()` and
 * render unchanged, so bilingualizing this feature's surface never regresses
 * the surfaces that are still Chinese by origin.
 *
 * `{mod}` always resolves to the platform's primary modifier ("⌘" on macOS,
 * "Ctrl+" elsewhere) — a hint that says "⌘Z" on Windows names a key the
 * user's keyboard does not have. The placeholder is available in every
 * string, so no call site has to know about the platform.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  const template = entry ? entry[locale.value] : key;
  const values: Record<string, string | number> = { mod: modKey, ...vars };
  return template.replace(PLACEHOLDER, (_, name: string) =>
    values[name] !== undefined ? String(values[name]) : `{${name}}`,
  );
}
