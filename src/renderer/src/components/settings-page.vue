<template>
  <!-- The panel floats over the workbench: the backdrop is the way back, and
       a click that started inside (drag-select) must never count as one. -->
  <div
    v-if="settingsOpen"
    class="settings-backdrop"
    role="presentation"
    @mousedown="onBackdropDown"
    @click="onBackdropClick"
  >
    <section
      ref="panelEl"
      class="settings-panel"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.title')"
      @click.stop
    >
      <header class="settings-head">
        <div class="settings-title">
          <h1>{{ t("settings.title") }}</h1>
          <span class="settings-sub">{{ t("settings.subtitle") }}</span>
        </div>
        <label class="settings-search">
          <span class="settings-search-icon" aria-hidden="true">⌕</span>
          <input
            ref="searchEl"
            v-model="query"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('settings.searchPlaceholder')"
            :aria-label="t('settings.searchPlaceholder')"
            @keydown.esc.prevent="onSearchEscape"
          />
          <kbd v-if="!query" class="settings-search-key">{{ modWith("F") }}</kbd>
        </label>
        <button
          type="button"
          class="settings-close"
          :title="t('settings.close')"
          :aria-label="t('settings.close')"
          @click="close"
        >✕</button>
      </header>

      <div class="settings-body">
        <nav class="settings-nav" :aria-label="t('settings.title')">
          <div v-for="group in navGroups" :key="group.label" class="settings-nav-group">
            <p class="settings-nav-label">{{ group.label }}</p>
            <button
              v-for="entry in group.entries"
              :key="entry.id"
              type="button"
              class="settings-nav-item"
              :class="{ on: activeSection === entry.id }"
              @click="jumpTo(entry.id)"
            >
              <span class="settings-nav-icon" aria-hidden="true">{{ entry.icon }}</span>
              <span class="settings-nav-text">{{ entry.label }}</span>
              <span v-if="entry.count !== null" class="settings-nav-count">{{ entry.count }}</span>
            </button>
          </div>
        </nav>

        <div ref="contentEl" class="settings-content" @scroll.passive="onScroll">
          <div class="settings-inner">
            <section
              v-for="section in visibleSections"
              :id="`settings-sec-${section.id}`"
              :key="section.id"
              class="settings-section"
              :data-section="section.id"
            >
              <header class="settings-section-head">
                <div>
                  <h2>
                    <span class="settings-section-icon" aria-hidden="true">{{ section.icon }}</span>
                    {{ section.title }}
                  </h2>
                  <p class="settings-section-desc">{{ section.desc }}</p>
                  <p class="settings-section-meta">
                    <span class="settings-store" :class="section.storeClass">
                      ● {{ section.storeLabel }}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  class="settings-reset-section"
                  :disabled="!section.resettable"
                  :title="section.resettable ? t('settings.resetSection') : t('settings.readOnly')"
                  @click="resetSection(section.id)"
                >{{ t("settings.resetSection") }}</button>
              </header>
              <div class="settings-card">
                <div v-for="row in section.rows" :key="row.key" class="settings-row">
                  <div class="settings-row-text">
                    <p class="settings-row-title">
                      {{ row.title }}
                      <span v-if="row.proposed" class="settings-tag">{{ t("settings.proposed") }}</span>
                    </p>
                    <p class="settings-row-desc">{{ row.desc }}</p>
                  </div>
                  <div class="settings-row-control">
                    <template v-if="row.kind === 'toggle'">
                      <button
                        type="button"
                        class="settings-switch"
                        :class="{ on: row.value }"
                        role="switch"
                        :aria-checked="row.value"
                        :aria-label="row.title"
                        @click="row.apply(!row.value)"
                      ><span class="settings-switch-knob"></span></button>
                    </template>
                    <template v-else-if="row.kind === 'segment'">
                      <div class="settings-segment">
                        <button
                          v-for="option in row.options"
                          :key="option.value"
                          type="button"
                          :class="{ on: row.value === option.value }"
                          @click="row.apply(option.value)"
                        >{{ option.label }}</button>
                      </div>
                    </template>
                    <template v-else-if="row.kind === 'theme'">
                      <div class="settings-themes">
                        <button
                          v-for="option in themeOptions"
                          :key="option.value"
                          type="button"
                          class="settings-theme"
                          :class="[option.value, { on: row.value === option.value }]"
                          :aria-pressed="row.value === option.value"
                          @click="row.apply(option.value)"
                        >
                          <span class="settings-theme-preview" aria-hidden="true"></span>
                          <span class="settings-theme-name">{{ option.label }}</span>
                        </button>
                      </div>
                    </template>
                    <template v-else-if="row.kind === 'select'">
                      <label class="settings-select">
                        <select
                          :value="row.value"
                          :aria-label="row.title"
                          @change="row.apply(($event.target as HTMLSelectElement).value)"
                        >
                          <option v-for="option in row.options" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                      </label>
                    </template>
                    <template v-else-if="row.kind === 'text'">
                      <input
                        class="settings-text"
                        type="text"
                        :value="row.value"
                        :placeholder="row.placeholder"
                        :aria-label="row.title"
                        @change="row.apply(($event.target as HTMLInputElement).value)"
                      />
                    </template>
                    <template v-else-if="row.kind === 'button'">
                      <button type="button" class="settings-btn" @click="row.apply()">
                        {{ row.buttonLabel }}
                      </button>
                    </template>
                    <template v-else-if="row.kind === 'link'">
                      <button type="button" class="settings-btn" @click="row.apply()">
                        {{ row.buttonLabel }} ↗
                      </button>
                    </template>
                    <template v-else-if="row.kind === 'info'">
                      <span class="settings-info">{{ row.info }}</span>
                    </template>
                    <template v-else-if="row.kind === 'folder'">
                      <div class="settings-folder">
                        <span v-if="row.value" class="settings-folder-path" :title="row.value">{{
                          shortPath(row.value)
                        }}</span>
                        <span v-else class="settings-info">{{ t("settings.residentUnset") }}</span>
                        <button type="button" class="settings-btn" @click="row.choose()">
                          {{ t("settings.residentChoose") }}
                        </button>
                        <button
                          v-if="row.value"
                          type="button"
                          class="settings-btn"
                          @click="row.clear()"
                        >
                          {{ t("settings.residentClear") }}
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </section>

            <p v-if="visibleSections.length === 0" class="settings-empty">
              <span class="settings-empty-icon" aria-hidden="true">⌕</span>
              <b>{{ t("settings.searchEmpty") }}</b>
              <span>{{ t("settings.searchHint") }}</span>
            </p>
          </div>
        </div>
      </div>

      <footer class="settings-foot">
        <span class="settings-foot-dot" aria-hidden="true"></span>
        <span>{{ t("settings.autoSaved") }}</span>
        <span class="settings-foot-hint">{{ t("settings.closeHint") }}</span>
        <button type="button" class="settings-btn primary" @click="close">
          {{ t("settings.done") }}
        </button>
      </footer>
      <ParallelModelDialog
        v-model:open="parallelDefaultsOpen"
        :models="store.models"
        :favorite-models="store.favoriteModels"
        :recent-models="store.recentModels"
        :max="MAX_PARALLEL_TARGETS"
        :targets="settings.labs.parallel.targets"
        :summary="{
          model: settings.labs.parallel.summaryModel,
          length: settings.labs.parallel.summaryLength,
        }"
        @update:targets="applyParallelDefaults"
        @update:summary="applyParallelSummary"
        @toggle-favorite="toggleFavoriteModel"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * The settings page: a floating panel over the workbench.
 *
 * Two structural choices worth knowing before editing:
 *   - Rows are built as data (`SectionDef`), not markup. The search box filters
 *     sections and rows generically, and a new preference is one entry in the
 *     builder below rather than a new template branch.
 *   - Every control writes `settings` directly; persistence is a deep watcher
 *     in settings.ts. Nothing here calls a save function, so there is no way
 *     for a control to change a value and forget to persist it.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { BackendId } from "../../../shared/backend";
import type { ModelChoice, ParallelSummaryLength } from "../../../shared/types";
import { shortPath } from "../format";
import { locale, setLocale, t } from "../i18n";
import { resetLayout, settingsOpen, toggleSettings } from "../layout";
import { modWith } from "../platform-key";
import {
  type Density,
  type FileOpenTarget,
  MAX_PARALLEL_TARGETS,
  resetAllSettings,
  resetSection as resetSettingsSection,
  type Settings,
  sanitizeIgnorePatterns,
  settings,
  type ThemePreference,
  type TimeStyle,
} from "../settings";
import {
  archivedDirectoryViews,
  archivedSessionViews,
  checkForUpdates,
  clearResidentFolder,
  closeOverviewPanel,
  installBackend,
  installingLabel,
  pickResidentFolder,
  refreshBackendList,
  refreshOverviewSessions,
  store,
  switchBackend,
  toggleFavoriteModel,
} from "../state";
import { theme, themePreference } from "../theme";
import ParallelModelDialog from "./parallel-model-dialog.vue";

// ── row model ───────────────────────────────────────────────────────

interface RowBase {
  key: string;
  title: string;
  desc: string;
  proposed?: boolean;
}

interface ToggleRow extends RowBase {
  kind: "toggle";
  value: boolean;
  apply: (next: boolean) => void;
}

interface SegmentRow extends RowBase {
  kind: "segment";
  value: string;
  options: { value: string; label: string }[];
  apply: (next: string) => void;
}

interface ThemeRow extends RowBase {
  kind: "theme";
  value: ThemePreference;
  apply: (next: ThemePreference) => void;
}

interface SelectRow extends RowBase {
  kind: "select";
  value: string;
  options: { value: string; label: string }[];
  apply: (next: string) => void;
}

interface TextRow extends RowBase {
  kind: "text";
  value: string;
  placeholder?: string;
  apply: (next: string) => void;
}

interface ButtonRow extends RowBase {
  kind: "button" | "link";
  buttonLabel: string;
  apply: () => void;
}

interface FolderRow extends RowBase {
  kind: "folder";
  /** The chosen path, or "" while none is set. */
  value: string;
  choose: () => void;
  clear: () => void;
}

interface InfoRow extends RowBase {
  kind: "info";
  info: string;
}

type Row =
  | ToggleRow
  | SegmentRow
  | ThemeRow
  | SelectRow
  | TextRow
  | ButtonRow
  | FolderRow
  | InfoRow;

interface SectionDef {
  id: string;
  icon: string;
  group: string;
  title: string;
  desc: string;
  storeLabel: string;
  storeClass: string;
  resettable: boolean;
  rows: Row[];
  /** Extra lowercase text the search box should match. */
  keywords: string;
}

const panelEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const query = ref("");
const activeSection = ref("appearance");
/** The labs row's multi-model defaults dialog. */
const parallelDefaultsOpen = ref(false);
let backdropDown = false;

/** Defaults are stored as concrete picks; the dialog's "agent default" row never persists. */
function applyParallelDefaults(targets: (ModelChoice | null)[]): void {
  settings.labs.parallel.targets = targets
    .filter((choice): choice is ModelChoice => choice !== null)
    .slice(0, MAX_PARALLEL_TARGETS);
}

function applyParallelSummary(summary: {
  model: ModelChoice | null;
  length: ParallelSummaryLength;
}): void {
  settings.labs.parallel.summaryModel = summary.model ? { ...summary.model } : null;
  settings.labs.parallel.summaryLength = summary.length;
}

const themeOptions = computed(() => [
  { value: "system" as const, label: t("settings.themeSystem") },
  { value: "light" as const, label: t("settings.themeLight") },
  { value: "dark" as const, label: t("settings.themeDark") },
]);

// The quit keep-alive preference is main's business (see backendSection);
// the async read fills the row in shortly after the panel first opens.
const quitKeepAlive = ref(false);
void window.awefork?.quitKeepAlive().then((value) => {
  quitKeepAlive.value = value;
});

// ── helpers ─────────────────────────────────────────────────────────

/** A settings section that is not (yet) persisted anywhere; disabled reset. */
const LOCAL_STORE = () => ({ storeLabel: t("settings.storeLocal"), storeClass: "local" });
const APP_STORE = () => ({ storeLabel: t("settings.storeApp"), storeClass: "app" });
const BACKEND_STORE = () => ({ storeLabel: t("settings.storeBackend"), storeClass: "backend" });

function toggle(
  key: string,
  title: string,
  desc: string,
  value: boolean,
  apply: (next: boolean) => void,
  proposed = false,
): ToggleRow {
  return { kind: "toggle", key, title, desc, value, apply, proposed };
}

function segment(
  key: string,
  title: string,
  desc: string,
  value: string,
  options: { value: string; label: string }[],
  apply: (next: string) => void,
  proposed = false,
): SegmentRow {
  return { kind: "segment", key, title, desc, value, options, apply, proposed };
}

function select(
  key: string,
  title: string,
  desc: string,
  value: string,
  options: { value: string; label: string }[],
  apply: (next: string) => void,
): SelectRow {
  return { kind: "select", key, title, desc, value, options, apply };
}

function button(
  key: string,
  title: string,
  desc: string,
  buttonLabel: string,
  apply: () => void,
): ButtonRow {
  return { kind: "button", key, title, desc, buttonLabel, apply };
}

function info(key: string, title: string, desc: string, text: string): InfoRow {
  return { kind: "info", key, title, desc, info: text };
}

function folder(
  key: string,
  title: string,
  desc: string,
  value: string,
  choose: () => void,
  clear: () => void,
): FolderRow {
  return { kind: "folder", key, title, desc, value, choose, clear };
}

function text(
  key: string,
  title: string,
  desc: string,
  value: string,
  apply: (next: string) => void,
  placeholder?: string,
): TextRow {
  return { kind: "text", key, title, desc, value, apply, placeholder };
}

// ── section builders ────────────────────────────────────────────────

/** Backend rows: one per probed CLI, plus the two backend-wide toggles. */
function backendSection(): SectionDef {
  const active = store.activeBackend;
  const rows: Row[] = store.backendList.map((entry) => {
    const status = !entry.installed
      ? t("settings.backendMissing")
      : entry.versionWarning
        ? t("settings.backendWarn")
        : t("settings.backendReady");
    const desc = `${entry.version ? `v${entry.version}` : "—"} · ${status}`;
    // zcode rides along with the ZCode desktop app — no one-click install, so
    // its missing row stays a plain hint; the npm-shipped CLIs get a button.
    const installable = entry.id !== "zcode";
    const installing = store.installingBackend === entry.id;
    // The active backend is a read-only row; every other installed one is a
    // switch button — same confirm-first flow the top bar uses, so a click
    // here cannot skip the reshape warning.
    if (entry.id === active) {
      return {
        kind: "info",
        key: `backend:${entry.id}`,
        title: entry.label,
        desc,
        info: t("settings.backendCurrent"),
      };
    }
    if (!entry.installed && installable) {
      return {
        kind: "button",
        key: `backend:${entry.id}`,
        title: entry.label,
        desc,
        buttonLabel: installing
          ? installingLabel(t("settings.installingBackend"))
          : t("settings.installLatest", { label: entry.label }),
        apply: () => void installBackend(entry.id as BackendId),
      };
    }
    if (!entry.installed) {
      return {
        kind: "info",
        key: `backend:${entry.id}`,
        title: entry.label,
        desc,
        info: "",
      };
    }
    return {
      kind: "button",
      key: `backend:${entry.id}`,
      title: entry.label,
      desc,
      buttonLabel: t("settings.switchBackend", { label: entry.label }),
      apply: () => void switchBackend(entry.id as BackendId),
    };
  });
  rows.push(
    toggle(
      "backend.warnRange",
      t("settings.warnRange"),
      t("settings.warnRangeDesc"),
      settings.backend.warnRange,
      (next) => {
        settings.backend.warnRange = next;
      },
    ),
    // Quit keep-alive lives in main's settings.json (the quit dialog's
    // checkbox writes it too), so this row reads and writes over IPC —
    // demo mode flips the switch but persists nowhere.
    toggle(
      "backend.quitKeepAlive",
      t("settings.quitKeepAlive"),
      t("settings.quitKeepAliveDesc"),
      quitKeepAlive.value,
      (next) => {
        quitKeepAlive.value = next;
        void window.awefork?.setQuitKeepAlive(next);
      },
    ),
  );
  return {
    id: "backend",
    icon: "🤖",
    group: t("settings.groupAgents"),
    title: t("settings.backend"),
    desc: t("settings.backendDesc"),
    ...APP_STORE(),
    resettable: true,
    rows,
    keywords:
      "backend agent opencode codex pi zcode 后端 智能体 cli 切换 退出 保留 后台 quit keep-alive",
  };
}

function modelsSection(): SectionDef {
  const favorites = store.favoriteModels;
  const rows: Row[] = [];
  if (favorites.length === 0) {
    rows.push(
      info(
        "models.empty",
        t("settings.favoriteModels"),
        t("settings.favoriteModelsDesc"),
        t("settings.favoriteModelsEmpty"),
      ),
    );
  } else {
    for (const model of favorites) {
      const label = `${model.modelId}${model.variant ? ` · ${model.variant}` : ""}`;
      rows.push({
        kind: "button",
        key: `models.fav:${model.providerId}:${model.modelId}:${model.variant ?? ""}`,
        title: label,
        desc: model.providerId,
        buttonLabel: "★",
        apply: () => toggleFavoriteModel(model),
      });
    }
  }
  rows.push(info("models.scope", t("settings.models"), t("settings.favoriteModelsScope"), ""));
  return {
    id: "models",
    icon: "★",
    group: t("settings.groupAgents"),
    title: t("settings.models"),
    desc: t("settings.modelsDesc"),
    ...BACKEND_STORE(),
    resettable: false,
    rows,
    keywords: "model favorite 模型 收藏",
  };
}

function canvasSection(): SectionDef {
  return {
    id: "canvas",
    icon: "▦",
    group: t("settings.groupWorkbench"),
    title: t("settings.canvas"),
    desc: t("settings.canvasDesc"),
    ...LOCAL_STORE(),
    resettable: true,
    rows: [
      toggle(
        "canvas.multiWindow",
        t("settings.multiWindow"),
        t("settings.multiWindowDesc"),
        settings.canvas.multiWindow,
        (next) => {
          settings.canvas.multiWindow = next;
        },
      ),
      toggle(
        "canvas.sessionsInNewTab",
        t("settings.sessionsInNewTab"),
        t("settings.sessionsInNewTabDesc"),
        settings.canvas.sessionsInNewTab,
        (next) => {
          settings.canvas.sessionsInNewTab = next;
        },
      ),
      segment(
        "canvas.defaultView",
        t("settings.defaultView"),
        t("settings.defaultViewDesc"),
        settings.canvas.defaultView,
        [
          { value: "canvas", label: t("files.tabCanvas") },
          { value: "files", label: t("files.tabFiles") },
        ],
        (next) => {
          settings.canvas.defaultView = next as Settings["canvas"]["defaultView"];
        },
      ),
      toggle(
        "canvas.autoFit",
        t("settings.autoFit"),
        t("settings.autoFitDesc"),
        settings.canvas.autoFit,
        (next) => {
          settings.canvas.autoFit = next;
        },
      ),
      toggle(
        "canvas.minimap",
        t("settings.minimap"),
        t("settings.minimapDesc"),
        settings.canvas.minimap,
        (next) => {
          settings.canvas.minimap = next;
        },
      ),
      segment(
        "canvas.autoDeny",
        t("settings.autoDeny"),
        t("settings.autoDenyDesc"),
        String(settings.canvas.autoDenySeconds),
        [
          { value: "15", label: "15s" },
          { value: "30", label: "30s" },
          { value: "60", label: "60s" },
          { value: "0", label: t("settings.autoDenyNever") },
        ],
        (next) => {
          settings.canvas.autoDenySeconds = Number(next);
        },
      ),
      toggle(
        "canvas.confirmDelete",
        t("settings.confirmDelete"),
        t("settings.confirmDeleteDesc"),
        settings.canvas.confirmDelete,
        (next) => {
          settings.canvas.confirmDelete = next;
        },
      ),
      button(
        "canvas.resetLayout",
        t("settings.resetLayout"),
        t("settings.resetLayoutDesc"),
        t("settings.resetLayoutBtn"),
        () => resetLayout(),
      ),
    ],
    keywords: "canvas window minimap layout 画布 窗口 布局 小地图 自动拒绝",
  };
}

function filesSection(): SectionDef {
  return {
    id: "files",
    icon: "▤",
    group: t("settings.groupWorkbench"),
    title: t("settings.files"),
    desc: t("settings.filesDesc"),
    ...LOCAL_STORE(),
    resettable: true,
    rows: [
      toggle(
        "files.showHidden",
        t("settings.showHidden"),
        t("settings.showHiddenDesc"),
        settings.files.showHidden,
        (next) => {
          settings.files.showHidden = next;
        },
      ),
      segment(
        "files.view",
        t("settings.fileView"),
        t("settings.fileViewDesc"),
        settings.files.view,
        [
          { value: "list", label: t("settings.viewList") },
          { value: "grid", label: t("settings.viewGrid") },
        ],
        (next) => {
          settings.files.view = next as Settings["files"]["view"];
        },
      ),
      select(
        "files.previewCap",
        t("settings.previewCap"),
        t("settings.previewCapDesc"),
        String(settings.files.previewCapKb),
        [
          { value: "128", label: "128 KB" },
          { value: "256", label: "256 KB" },
          { value: "512", label: "512 KB" },
        ],
        (next) => {
          settings.files.previewCapKb = Number(next);
        },
      ),
      select(
        "files.imageCap",
        t("settings.imageCap"),
        t("settings.imageCapDesc"),
        String(settings.files.imageCapMb),
        [
          { value: "2", label: "2 MB" },
          { value: "4", label: "4 MB" },
          { value: "8", label: "8 MB" },
        ],
        (next) => {
          settings.files.imageCapMb = Number(next);
        },
      ),
      segment(
        "files.openOnDouble",
        t("settings.openOnDouble"),
        t("settings.openOnDoubleDesc"),
        settings.files.openOnDouble,
        [
          { value: "system", label: t("settings.openSystem") },
          { value: "preview", label: t("settings.openPreview") },
        ],
        (next) => {
          settings.files.openOnDouble = next as FileOpenTarget;
        },
        true,
      ),
      text(
        "files.ignore",
        t("settings.filesIgnore"),
        t("settings.filesIgnoreDesc"),
        settings.files.ignore.join(", "),
        (next) => {
          const list = next
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name !== "");
          settings.files.ignore = sanitizeIgnorePatterns(list);
        },
        "node_modules, dist",
      ),
      folder(
        "files.residentFolder",
        t("settings.residentFolder"),
        t("settings.residentFolderDesc"),
        settings.files.residentFolder,
        () => {
          void pickResidentFolder();
        },
        () => {
          void clearResidentFolder();
        },
      ),
    ],
    keywords: "files preview hidden grid ignore resident folder 文件 预览 隐藏 网格 忽略 常驻",
  };
}

function searchSection(): SectionDef {
  return {
    id: "search",
    icon: "⌕",
    group: t("settings.groupWorkbench"),
    title: t("settings.search"),
    desc: t("settings.searchDesc"),
    ...LOCAL_STORE(),
    resettable: true,
    rows: [
      toggle(
        "search.title",
        t("sidebar.scopeTitleCap"),
        t("settings.searchScopesDesc"),
        settings.search.scopes.title,
        (next) => {
          settings.search.scopes.title = next;
        },
      ),
      toggle("search.tag", t("sidebar.scopeTagCap"), "", settings.search.scopes.tag, (next) => {
        settings.search.scopes.tag = next;
      }),
      toggle("search.body", t("sidebar.scopeBodyFull"), "", settings.search.scopes.body, (next) => {
        settings.search.scopes.body = next;
      }),
      segment(
        "search.cap",
        t("settings.searchCap"),
        t("settings.searchCapDesc"),
        String(settings.search.cap),
        [
          { value: "100", label: "100" },
          { value: "300", label: "300" },
          { value: "1000", label: "1000" },
          { value: "0", label: t("settings.searchAll") },
        ],
        (next) => {
          settings.search.cap = Number(next);
        },
      ),
      info(
        "search.syntax",
        t("settings.searchSyntax"),
        t("settings.searchSyntaxDesc"),
        'body: · title: · tag: · #tag · dir: · is:pinned · is:fork · is:running · "短语" · -排除',
      ),
    ],
    keywords: "search scope body title tag cap 搜索 范围 正文 标题 标签 上限 语法",
  };
}

function shortcutsSection(): SectionDef {
  return {
    id: "shortcuts",
    icon: "⌘",
    group: t("settings.groupWorkbench"),
    title: t("settings.shortcuts"),
    desc: t("settings.shortcutsDesc"),
    ...LOCAL_STORE(),
    resettable: false,
    rows: [
      info("sc.open", t("settings.scOpenSettings"), "", modWith(",")),
      info("sc.close", t("settings.scCloseSettings"), "", "Esc"),
      info("sc.palette", t("settings.scPalette"), t("settings.scPaletteDesc"), modWith("K")),
      info(
        "sc.canvas",
        t("settings.scSearchCanvas"),
        t("settings.scSearchCanvasDesc"),
        modWith("F"),
      ),
      info("sc.history", t("settings.scHistory"), t("settings.scHistoryDesc"), modWith("⇧H")),
      info(
        "sc.undo",
        t("settings.scUndo"),
        t("settings.scUndoDesc"),
        `${modWith("Z")} / ${modWith("⇧Z")}`,
      ),
    ],
    keywords: "shortcut keyboard 快捷键",
  };
}

function storageSection(): SectionDef {
  const sessions = archivedSessionViews.value.length;
  const dirs = archivedDirectoryViews.value.length;
  return {
    id: "storage",
    icon: "🗄",
    group: t("settings.groupSystem"),
    title: t("settings.storage"),
    desc: t("settings.storageDesc"),
    ...APP_STORE(),
    resettable: false,
    rows: [
      button(
        "storage.dataDir",
        t("settings.dataDir"),
        t("settings.dataDirDesc"),
        t("settings.openFolder"),
        () => {
          // The folder is main's business: the renderer only knows it exists.
          void window.awefork?.openAppData().catch(() => null);
        },
      ),
      info(
        "storage.overlay",
        t("settings.overlay"),
        t("settings.overlayDesc"),
        "lineage · pins · marks · tags · trash · archive · composer",
      ),
      info(
        "storage.archive",
        t("settings.archive"),
        t("settings.archiveDesc"),
        t("settings.archiveCount", { sessions, dirs }),
      ),
      info(
        "storage.trash",
        t("settings.trash"),
        t("settings.trashDesc", { count: store.trash.length }),
        String(store.trash.length),
      ),
      button(
        "storage.export",
        t("settings.exportImport"),
        t("settings.exportImportDesc"),
        t("settings.export"),
        () => exportSettings(),
      ),
      button(
        "storage.resetAll",
        t("settings.resetAll"),
        t("settings.resetAllDesc"),
        t("settings.resetAllBtn"),
        () => resetAll(),
      ),
    ],
    keywords: "storage data folder archive trash export 存储 数据 目录 归档 回收站 导出",
  };
}

function updatesSection(): SectionDef {
  return {
    id: "updates",
    icon: "⬆",
    group: t("settings.groupSystem"),
    title: t("settings.updates"),
    desc: t("settings.updatesDesc"),
    ...APP_STORE(),
    resettable: true,
    rows: [
      info(
        "updates.version",
        t("settings.currentVersion"),
        `awefork v${store.currentVersion ?? "—"} · MPL-2.0`,
        "",
      ),
      toggle(
        "updates.checkOnLaunch",
        t("settings.checkOnLaunch"),
        t("settings.checkOnLaunchDesc"),
        settings.updates.checkOnLaunch,
        (next) => {
          settings.updates.checkOnLaunch = next;
        },
      ),
      button(
        "updates.checkNow",
        t("settings.updates"),
        t("settings.updatesDesc"),
        t("settings.checkNow"),
        () => void checkForUpdates("manual"),
      ),
      {
        kind: "link",
        key: "updates.links",
        title: t("settings.links"),
        desc: t("settings.linksDesc"),
        buttonLabel: t("settings.releaseNotes"),
        apply: () => openExternal("https://github.com/wehuman01/awefork/releases"),
      },
      {
        kind: "link",
        key: "updates.home",
        title: t("settings.projectHome"),
        desc: "",
        buttonLabel: t("settings.projectHome"),
        apply: () => openExternal("https://github.com/wehuman01/awefork"),
      },
      {
        kind: "link",
        key: "updates.issue",
        title: t("settings.reportIssue"),
        desc: "",
        buttonLabel: t("settings.reportIssue"),
        apply: () => openExternal("https://github.com/wehuman01/awefork/issues"),
      },
    ],
    keywords: "update version release link 更新 版本 发布 链接",
  };
}

function appearanceSection(): SectionDef {
  return {
    id: "appearance",
    icon: "◐",
    group: t("settings.groupGeneral"),
    title: t("settings.appearance"),
    desc: t("settings.appearanceDesc"),
    ...LOCAL_STORE(),
    resettable: true,
    rows: [
      {
        kind: "theme",
        key: "appearance.theme",
        title: t("settings.theme"),
        desc: t("settings.themeDesc"),
        value: settings.appearance.theme,
        apply: (next: ThemePreference) => {
          settings.appearance.theme = next;
        },
      },
      segment(
        "appearance.density",
        t("settings.density"),
        t("settings.densityDesc"),
        settings.appearance.density,
        [
          { value: "comfortable", label: t("settings.densityComfortable") },
          { value: "compact", label: t("settings.densityCompact") },
        ],
        (next) => {
          settings.appearance.density = next as Density;
        },
        true,
      ),
      toggle(
        "appearance.motion",
        t("settings.motion"),
        t("settings.motionDesc"),
        settings.appearance.motion,
        (next) => {
          settings.appearance.motion = next;
        },
        true,
      ),
      toggle(
        "appearance.dotGrid",
        t("settings.dotGrid"),
        t("settings.dotGridDesc"),
        settings.appearance.dotGrid,
        (next) => {
          settings.appearance.dotGrid = next;
        },
        true,
      ),
    ],
    keywords: "theme appearance density motion 主题 外观 密度 动效 点阵",
  };
}

function languageSection(): SectionDef {
  return {
    id: "language",
    icon: "文",
    group: t("settings.groupGeneral"),
    title: t("settings.language"),
    desc: t("settings.languageDesc"),
    ...LOCAL_STORE(),
    resettable: true,
    rows: [
      segment(
        "language.locale",
        t("settings.locale"),
        t("settings.localeDesc"),
        locale.value,
        [
          { value: "zh", label: "中文" },
          { value: "en", label: "English" },
        ],
        (next) => {
          setLocale(next as "zh" | "en");
        },
      ),
      segment(
        "language.timeStyle",
        t("settings.timeStyle"),
        t("settings.timeStyleDesc"),
        settings.language.timeStyle,
        [
          { value: "relative", label: t("settings.timeRelative") },
          { value: "absolute", label: t("settings.timeAbsolute") },
        ],
        (next) => {
          settings.language.timeStyle = next as TimeStyle;
        },
        true,
      ),
    ],
    keywords: "language locale time 语言 时间 区域",
  };
}

function labsSection(): SectionDef {
  const rows: Row[] = [
    toggle(
      "labs.fileBrowser",
      t("settings.labsFileBrowser"),
      t("settings.labsFileBrowserDesc"),
      settings.labs.fileBrowser,
      (next) => {
        settings.labs.fileBrowser = next;
      },
    ),
    toggle(
      "labs.parallelModels",
      t("settings.labsParallelModels"),
      t("settings.labsParallelModelsDesc"),
      settings.labs.parallelModels,
      (next) => {
        settings.labs.parallelModels = next;
      },
    ),
    toggle(
      "labs.sessionOverview",
      t("settings.labsSessionOverview"),
      t("settings.labsSessionOverviewDesc"),
      settings.labs.sessionOverview,
      (next) => {
        settings.labs.sessionOverview = next;
        if (next) void refreshOverviewSessions();
        // The pill and panel unmount with the switch; a panel left "open"
        // in the store would pop back up when the switch returns on.
        if (!next) closeOverviewPanel();
      },
    ),
  ];
  // The multi-model defaults only matter once the feature is on; hiding them
  // keeps the section about switches, not about a disabled feature's knobs.
  if (settings.labs.parallelModels) {
    rows.push(
      button(
        "labs.parallelDefaults",
        t("settings.parallelDefaults"),
        t("settings.parallelDefaultsDesc"),
        settings.labs.parallel.targets.length > 0
          ? t("settings.parallelDefaultsCount", { n: settings.labs.parallel.targets.length })
          : t("settings.parallelDefaultsEmpty"),
        () => {
          parallelDefaultsOpen.value = true;
        },
      ),
    );
  }
  rows.push(info("labs.note", t("settings.labsNote"), t("settings.labsNoteDesc"), ""));
  return {
    id: "labs",
    icon: "⚗",
    group: t("settings.groupLabs"),
    title: t("settings.labs"),
    desc: t("settings.labsDesc"),
    ...LOCAL_STORE(),
    resettable: true,
    rows,
    keywords:
      "labs experiment 实验室 实验 experimental beta parallel 并行 多模型 overview 总览 面板",
  };
}

// ── assembled view ──────────────────────────────────────────────────

const sections = computed<SectionDef[]>(() => {
  // Reading these refs keeps the whole page reactive: a backend probe, a
  // starred model or a trashed session re-renders its row in place.
  void store.backendList;
  void store.favoriteModels;
  void store.trash;
  void store.currentVersion;
  void archivedSessionViews.value;
  void archivedDirectoryViews.value;
  void locale.value;
  void theme.value;
  void themePreference.value;
  void quitKeepAlive.value;
  return [
    appearanceSection(),
    languageSection(),
    backendSection(),
    modelsSection(),
    canvasSection(),
    filesSection(),
    searchSection(),
    shortcutsSection(),
    storageSection(),
    updatesSection(),
    labsSection(),
  ];
});

/** Sections matching the current query, with their rows filtered too. */
const visibleSections = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return sections.value;
  const hit = (text: string) => text.toLowerCase().includes(needle);
  return sections.value
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => hit(row.title) || hit(row.desc) || hit(section.keywords)),
    }))
    .filter(
      (section) =>
        section.rows.length > 0 || hit(section.title) || hit(section.desc) || hit(section.keywords),
    );
});

const navGroups = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const order = [
    t("settings.groupGeneral"),
    t("settings.groupAgents"),
    t("settings.groupWorkbench"),
    t("settings.groupSystem"),
    t("settings.groupLabs"),
  ];
  const counts = new Map<string, number>();
  for (const section of sections.value) {
    const shown = visibleSections.value.find((entry) => entry.id === section.id);
    if (shown) counts.set(section.id, shown.rows.length);
  }
  return order
    .map((label) => ({
      label,
      entries: sections.value
        .filter((section) => section.group === label)
        .filter((section) => !needle || counts.has(section.id))
        .map((section) => ({
          id: section.id,
          icon: section.icon,
          label: section.title,
          count: needle ? (counts.get(section.id) ?? 0) : null,
        })),
    }))
    .filter((group) => group.entries.length > 0);
});

// ── actions ─────────────────────────────────────────────────────────

function close(): void {
  toggleSettings(false);
}

function onBackdropDown(event: MouseEvent): void {
  // Only a press that started on the dimmed area counts; a drag-select that
  // began inside the panel and ended outside must not close it.
  backdropDown = event.target === event.currentTarget;
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget && backdropDown) close();
  backdropDown = false;
}

function onSearchEscape(event: KeyboardEvent): void {
  if (query.value) {
    query.value = "";
    // The window-level handler would otherwise see the query already empty
    // and close the panel on the same keystroke that only cleared the text.
    event.stopPropagation();
    return;
  }
  close();
}

function jumpTo(id: string): void {
  activeSection.value = id;
  const target = contentEl.value?.querySelector<HTMLElement>(`#settings-sec-${id}`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function onScroll(): void {
  const host = contentEl.value;
  if (!host) return;
  let current = visibleSections.value[0]?.id;
  for (const section of visibleSections.value) {
    const el = host.querySelector<HTMLElement>(`#settings-sec-${section.id}`);
    if (el && el.offsetTop - host.scrollTop < 80) current = section.id;
  }
  if (current) activeSection.value = current;
}

function resetSection(id: string): void {
  const key = id as keyof Settings;
  if (!(key in settings)) return;
  resetSettingsSection(key);
}

function resetAll(): void {
  if (!window.confirm(t("settings.resetAllConfirm"))) return;
  resetAllSettings();
}

function exportSettings(): void {
  const blob = new Blob([`${JSON.stringify(settings, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "awefork-settings.json";
  link.click();
  URL.revokeObjectURL(url);
}

function openExternal(url: string): void {
  void window.awefork?.openExternal(url).catch(() => null);
}

// ── lifecycle ───────────────────────────────────────────────────────

function onKeydown(event: KeyboardEvent): void {
  if (!settingsOpen.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (query.value) query.value = "";
    else close();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchEl.value?.focus();
    searchEl.value?.select();
  }
}

watch(settingsOpen, (open) => {
  if (!open) return;
  query.value = "";
  void nextTick(() => {
    contentEl.value?.scrollTo({ top: 0 });
    activeSection.value = visibleSections.value[0]?.id ?? "appearance";
    searchEl.value?.focus();
  });
});

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  // The page mounts fresh on every open (v-if on settingsOpen): a CLI
  // installed in a terminal since the last look shows its version here.
  void refreshBackendList();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>
