<template>
  <!--
    The floating session overview (画布会话总览). Non-modal: no backdrop, the
    canvas underneath keeps working, and a click outside simply collapses it.
    Every fact it shows is read from the store's existing run maps, ask queues
    and session lists — the panel owns no state of its own beyond where it sits.
  -->
  <Transition name="overview-float">
    <section
      v-if="store.overview.open"
      id="session-overview-float"
      ref="panelEl"
      class="overview-float"
      role="dialog"
      aria-modal="false"
      :aria-label="t('overview.label')"
      :style="[panelStyle, placed ? null : { visibility: 'hidden' }]"
      @mousedown.stop
      @wheel.stop
    >
      <header
        class="float-header"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <div>
          <span class="drag-grip" aria-hidden="true">⠿</span>
          <b>{{ t("overview.label") }}</b>
          <span class="scope-label">{{ t("overview.scope") }}</span>
        </div>
        <button type="button" :title="t('overview.close')" @click="closeOverviewPanel()">×</button>
      </header>

      <div class="float-controls">
        <div class="float-tabs" role="group" :aria-label="t('overview.filterStatus')">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            :class="{ active: store.overview.filter === tab.id }"
            @click="setOverviewFilter(tab.id)"
          >
            {{ tab.label }}<small>{{ tab.count }}</small>
          </button>
        </div>
        <div class="float-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            :aria-label="t('overview.searchLabel')"
            :placeholder="t('overview.searchPlaceholder')"
          />
          <select v-model="agent" :aria-label="t('overview.filterAgent')">
            <option value="all">{{ t("overview.allAgents") }}</option>
            <option v-for="id in agents" :key="id" :value="id">{{ BACKEND_LABELS[id] }}</option>
          </select>
        </div>
      </div>

      <div class="float-column-labels">
        <!-- Header checkbox: one click takes every listed row into the
             multi-selection, so a bulk mark can start from "everything" and
             subtract the few the user still wants to open. -->
        <button
          type="button"
          class="labels-check"
          :class="{ checked: allVisibleChecked }"
          :aria-pressed="allVisibleChecked"
          :title="t('overview.selectAllVisible')"
          @click="toggleSelectAllVisible"
        >✓</button>
        <span>{{ t("overview.colSession") }}</span>
        <span>{{ t("overview.colStatus") }}</span>
        <span>{{ t("overview.colActivity") }}</span>
      </div>

      <div class="float-session-list">
        <div
          v-for="row in visibleRows"
          :key="rowKey(row)"
          class="float-session-row"
          :class="{
            selected: store.overview.selectedKey === rowKey(row),
            current: isCurrent(row),
            checked: isChecked(row),
          }"
        >
          <!-- Multi-select checkbox. A sibling of the row's main button, never
               inside it: the row stays one hit area for the summary, and the
               checkbox is its own control for keyboard and screen readers. -->
          <button
            type="button"
            class="row-check"
            :class="{ checked: isChecked(row) }"
            :aria-pressed="isChecked(row)"
            :title="t('overview.selectRow')"
            @click.stop="toggleCheck(row, $event)"
          >✓</button>
          <button
            type="button"
            class="float-session-main"
            :aria-pressed="store.overview.selectedKey === rowKey(row)"
            @click="onRowClick(row, $event)"
            @dblclick="jump(row)"
            @keydown.enter.prevent="jump(row)"
          >
            <span class="float-session-name">
              <span class="agent-badge" :class="row.backend">{{ agentGlyph(row.backend) }}</span>
              <span class="float-session-text">
                <b>
                  {{ row.session.title }}
                  <i v-if="row.status === 'unread'" class="unread-dot" aria-hidden="true"></i>
                </b>
                <small>
                  {{ projectOf(row.session.directory) }}
                  <em aria-hidden="true">·</em>
                  {{ BACKEND_LABELS[row.backend] }}
                  <template v-if="modelLabel(row)">
                    <em aria-hidden="true">·</em>
                    <span class="float-session-model" :title="modelTitle(row)">{{
                      modelLabel(row)
                    }}</span>
                  </template>
                  <template v-if="isCurrent(row)">
                    <em aria-hidden="true">·</em> {{ t("overview.current") }}
                  </template>
                </small>
              </span>
            </span>
            <span class="status-badge" :class="row.status">{{
              t(`overview.status.${row.status}`)
            }}</span>
            <span class="float-activity">
              {{ activityOf(row) }}
              <small>{{ relTime(row.activityAt) }}</small>
            </span>
          </button>
          <!-- The row's chevron is the one-click jump: straight to the
               conversation, no summary expansion in between. -->
          <button
            type="button"
            class="jump-chevron"
            :title="t('overview.jump')"
            @click.stop="jump(row)"
          >↗</button>
        </div>

        <div v-if="visibleRows.length === 0" class="float-empty">
          {{ t("overview.empty") }}
          <button type="button" @click="clearFilters">{{ t("overview.clearFilters") }}</button>
        </div>
      </div>

      <p v-if="store.overview.error" class="float-error" role="alert">
        {{ store.overview.error }}
      </p>
      <p v-if="remoteFailure" class="float-note">{{ remoteFailure }}</p>
      <p v-if="remoteFreshness" class="float-note">{{ remoteFreshness }}</p>

      <div v-if="selectedRow" class="float-summary">
        <div class="summary-title">
          <span>{{ t("overview.summary") }}</span>
          <b :title="selectedRow.session.title">{{ selectedRow.session.title }}</b>
          <button
            type="button"
            :title="t('overview.collapseSummary')"
            @click="clearOverviewSelection()"
          >⌄</button>
        </div>
        <div class="summary-block">
          <span>{{ t("overview.lastPrompt") }}</span>
          <p>{{ summary.loading ? t("overview.loadingSummary") : summary.error ? t("overview.summaryFailed") : summary.prompt || t("overview.noPrompt") }}</p>
        </div>
        <div class="summary-block">
          <span>{{ t("overview.lastReply") }}</span>
          <p>{{ summary.loading ? t("overview.loadingSummary") : summary.error ? t("overview.summaryFailed") : summary.reply || t("overview.noReply") }}</p>
        </div>
        <button v-if="summary.error && !summary.loading" type="button" class="summary-retry" @click="retrySummary">
          {{ t("overview.retrySummary") }}
        </button>

        <!-- A pending ask is answered through the same queue the inline card and
             the modal use, routed by backend + requestId. Complex asks (forms,
             multi-question input) send the user to the session instead of
             growing a second approval surface here. -->
        <div v-if="ask" class="summary-ask">
          <b>{{ t(ask.title, ask.vars) }}</b>
          <p v-if="ask.detail">{{ t(ask.detail, ask.vars) }}</p>
          <pre v-if="ask.kind === 'command-approval'">{{ ask.command }}</pre>
          <pre v-if="ask.kind === 'opencode-permission' && ask.command">{{ ask.command }}</pre>
          <small v-if="ask.kind === 'opencode-permission' && ask.patterns.length">
            {{ t("interaction.matchedRule", { rule: ask.patterns.join(" · ") }) }}
          </small>
          <small v-if="ask.kind === 'command-approval' && ask.cwd">
            {{ t("interaction.workingDir", { cwd: ask.cwd }) }}
          </small>
          <small v-if="ask.kind === 'file-approval' && ask.grantRoot">
            {{ t("interaction.requestWrite", { root: ask.grantRoot }) }}
          </small>
          <ul v-if="ask.kind === 'permission-approval'">
            <li v-for="item in ask.requested" :key="item">{{ item }}</li>
          </ul>
          <ul v-if="ask.kind === 'user-input'">
            <li v-for="question in ask.questions" :key="question.id">
              <b>{{ question.header }}</b>
              <span>{{ question.question }}</span>
              <small v-if="question.options?.length">
                {{ question.options.map((option) => option.description ? `${option.label}: ${option.description}` : option.label).join(" · ") }}
              </small>
            </li>
          </ul>
          <div v-if="askOptions" class="summary-ask-options">
            <button
              v-for="option in askOptions"
              :key="option.label"
              type="button"
              :title="option.description"
              @click="answerWithOption(option.label)"
            >{{ option.label }}</button>
          </div>
          <ul v-else-if="ask.kind === 'opencode-form'">
            <li v-for="field in ask.fields" :key="field.key">
              {{ field.title || field.key }}<small v-if="field.description">{{ field.description }}</small>
            </li>
          </ul>
          <div v-else-if="askApproval" class="summary-ask-actions">
            <button type="button" class="interaction-deny" @click="answerAsk('deny')">
              {{ t("overview.askDeny") }}
            </button>
            <button type="button" class="interaction-allow" @click="answerAsk('allow')">
              {{ t("overview.askAllow") }}
            </button>
          </div>
          <small v-else>{{ t("overview.answerHint") }}</small>
        </div>

        <div class="summary-path">
          <span>{{ t("overview.workingDir") }}</span>
          <code :title="selectedRow.session.directory">{{ selectedRow.session.directory }}</code>
        </div>

        <div class="summary-actions">
          <button
            v-if="selectedRow.status === 'unread' || selectedRow.status === 'failed'"
            type="button"
            :disabled="summary.loading || summary.revision === null"
            @click="markSeen"
          >{{ t("overview.markSeen") }}</button>
          <button
            type="button"
            class="jump-button"
            :disabled="store.overview.jumpingKey !== null"
            @click="jump(selectedRow)"
          >{{ t("overview.jump") }} ↗</button>
        </div>
      </div>

      <footer class="float-footer">
        <span v-if="checkedRows.length === 0" class="footer-hint">{{ t("overview.footer") }}</span>
        <!-- A selection replaces the hint: the count, the bulk mark (scoped to
             the rows that actually carry an unseen result) and the way out. -->
        <span v-else class="float-bulk">
          <b>{{ t("overview.selectedCount", { n: checkedRows.length }) }}</b>
          <button
            type="button"
            class="bulk-mark"
            :disabled="checkedMarkable.length === 0"
            @click="markCheckedSeen"
          >{{ t("overview.markSeen") }}<small v-if="checkedMarkable.length > 0"> · {{ checkedMarkable.length }}</small></button>
          <button type="button" class="bulk-clear" @click="clearChecked">{{ t("overview.clearSelection") }}</button>
        </span>
        <!-- No selection: one click retires everything the current filters
             list as a new result or a lit failure. -->
        <button
          v-if="checkedRows.length === 0 && markableVisible.length > 0"
          type="button"
          class="mark-all-seen"
          @click="markVisibleSeen"
        >{{ t("overview.markAllSeen") }} · {{ markableVisible.length }}</button>
      </footer>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { BACKEND_LABELS, type BackendId } from "../../../shared/backend";
import type { AgentInteractionRequest, ChatMessage } from "../../../shared/types";
import { relTime } from "../format";
import { t } from "../i18n";
import {
  extendOverviewSelection,
  isOverviewMarkable,
  matchesOverviewAgent,
  matchesOverviewFilter,
  matchesOverviewQuery,
  type OverviewFilter,
  type OverviewRow,
  type OverviewSummary,
  overviewKey,
  overviewMarkableRows,
  overviewModelLabel,
  projectOf,
  summarizeMessages,
  toggleOverviewSelection,
} from "../session-overview";
import {
  clearOverviewSelection,
  closeOverviewPanel,
  ensureOverviewModels,
  jumpToOverviewSession,
  markOverviewRowsSeen,
  markOverviewSeen,
  overviewAgents,
  overviewPendingAsk,
  overviewRemoteError,
  overviewRemoteFetchedAt,
  overviewRows,
  overviewStats,
  overviewStreamTail,
  refreshOverviewSessions,
  respondInteraction,
  selectOverviewRow,
  setOverviewFilter,
  store,
} from "../state";

/**
 * Panel geometry lives in the component, not the store: the design asks for a
 * drag position that survives the window's lifetime and nothing more, and the
 * panel's size depends on the canvas it floats over.
 */
const panelEl = ref<HTMLElement | null>(null);
const position = reactive({ x: 0, y: 0 });
const placed = ref(false);
const query = ref("");
const agent = ref<"all" | BackendId>("all");
const searchInput = ref<HTMLInputElement | null>(null);

/**
 * The multi-selection: `${backend}:${sessionId}` keys the user checked, plus
 * the last key a check gesture touched (shift-click ranges from there). Both
 * are panel-local UI state — the ledger, not this set, decides what is unread.
 */
const checked = ref<Set<string>>(new Set());
const anchorKey = ref<string | null>(null);

let drag: { startX: number; startY: number; originX: number; originY: number } | null = null;

const tabs = computed(() => {
  const counts = overviewStats.value;
  const entries: Array<{ id: OverviewFilter; label: string; count: number }> = [
    { id: "all", label: t("overview.tabAll"), count: overviewRows.value.length },
    { id: "waiting", label: t("overview.status.waiting"), count: counts.waiting },
    { id: "running", label: t("overview.status.running"), count: counts.running },
    { id: "unread", label: t("overview.status.unread"), count: counts.unread },
    { id: "unknown", label: t("overview.status.unknown"), count: counts.unknown },
    { id: "failed", label: t("overview.status.failed"), count: counts.failed },
  ];
  return entries;
});

const agents = computed(() => overviewAgents.value);

/**
 * Agents whose session list this window could not read. Shown as a note, never
 * as a silent gap: a failed agent contributes no rows, so without this the
 * panel would look like that agent simply has nothing.
 */
const remoteFailure = computed(() => {
  const failed = store.backendList
    .filter((info) => info.installed && info.id !== store.activeBackend)
    .map((info) => info.id)
    .filter((id) => overviewRemoteError(id) !== null);
  if (failed.length === 0) return "";
  return t("overview.remoteFailed", {
    agents: failed.map((id) => BACKEND_LABELS[id]).join(", "),
  });
});

const remoteFreshness = computed(() => {
  const updated = store.backendList
    .filter((info) => info.installed && info.id !== store.activeBackend)
    .map((info) => ({ id: info.id, at: overviewRemoteFetchedAt(info.id) }))
    .filter((item): item is { id: BackendId; at: number } => item.at !== null)
    .map((item) => `${BACKEND_LABELS[item.id]} ${relTime(item.at)}`);
  return updated.length > 0 ? t("overview.remoteUpdated", { agents: updated.join(", ") }) : "";
});

const visibleRows = computed(() =>
  overviewRows.value.filter(
    (row) =>
      matchesOverviewFilter(row, store.overview.filter) &&
      matchesOverviewAgent(row, agent.value) &&
      matchesOverviewQuery(row, query.value),
  ),
);

const selectedRow = computed<OverviewRow | null>(() => {
  const key = store.overview.selectedKey;
  if (!key) return null;
  return overviewRows.value.find((row) => rowKey(row) === key) ?? null;
});

function rowKey(row: OverviewRow): string {
  return overviewKey(row.backend, row.session.id);
}

// ── multi-select + bulk mark-seen ───────────────────────────────────────

/** The listed rows that carry an unseen result or a lit failure. */
const markableVisible = computed(() => overviewMarkableRows(visibleRows.value));

/**
 * The checked rows that still exist, from the full row set rather than the
 * filtered view: a check is a decision about a session, so hiding it behind a
 * search must not silently drop it from a bulk action.
 */
const checkedRows = computed(() =>
  overviewRows.value.filter((row) => checked.value.has(rowKey(row))),
);

/** Of those, the ones a bulk mark can actually retire. */
const checkedMarkable = computed(() => checkedRows.value.filter(isOverviewMarkable));

const allVisibleChecked = computed(
  () => visibleRows.value.length > 0 && visibleRows.value.every((row) => isChecked(row)),
);

function isChecked(row: OverviewRow): boolean {
  return checked.value.has(rowKey(row));
}

function toggleCheck(row: OverviewRow, event: MouseEvent): void {
  const key = rowKey(row);
  if (event.shiftKey && anchorKey.value !== null) {
    checked.value = extendOverviewSelection(
      checked.value,
      visibleRows.value.map(rowKey),
      anchorKey.value,
      key,
    );
  } else {
    checked.value = toggleOverviewSelection(checked.value, key);
  }
  anchorKey.value = key;
}

/** Plain click expands the summary; ⌘-click (ctrl off macOS) or shift-click selects instead. */
function onRowClick(row: OverviewRow, event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    toggleCheck(row, event);
    return;
  }
  selectOverviewRow(row.backend, row.session.id);
}

function toggleSelectAllVisible(): void {
  if (allVisibleChecked.value) {
    const visible = new Set(visibleRows.value.map(rowKey));
    checked.value = new Set([...checked.value].filter((key) => !visible.has(key)));
    anchorKey.value = null;
    return;
  }
  const next = new Set(checked.value);
  for (const key of visibleRows.value.map(rowKey)) next.add(key);
  checked.value = next;
}

function markCheckedSeen(): void {
  markRowsSeen(checkedMarkable.value);
  clearChecked();
}

function markVisibleSeen(): void {
  markRowsSeen(markableVisible.value);
}

/** Rows → the ledger write's minimal shape; one call per row, fired together. */
function markRowsSeen(rows: readonly OverviewRow[]): void {
  if (rows.length === 0) return;
  void markOverviewRowsSeen(
    rows.map((row) => ({ backend: row.backend, sessionId: row.session.id })),
  );
}

function clearChecked(): void {
  checked.value = new Set();
  anchorKey.value = null;
}

/** The session the canvas is showing right now — labelled, never re-ordered. */
function isCurrent(row: OverviewRow): boolean {
  return row.backend === store.activeBackend && row.session.id === store.selectedId;
}

function agentGlyph(backend: BackendId): string {
  if (backend === "opencode") return "oc";
  if (backend === "codex") return "cx";
  if (backend === "zcode") return "zc";
  return "pi";
}

/** One honest line of activity per row: the tail of a live run, else the status. */
function activityOf(row: OverviewRow): string {
  if (row.status === "waiting") {
    const ask = overviewPendingAsk(row.backend, row.session.id);
    return ask ? t(ask.title, ask.vars) : t("overview.activity.waiting");
  }
  if (row.status === "running") {
    return overviewStreamTail(row.backend, row.session.id) ?? t("overview.activity.running");
  }
  if (row.status === "read" && lastRunFailed(row)) return t("overview.activity.readFailed");
  return t(`overview.activity.${row.status}`);
}

/** True when the last observed run for this session ended in an error. */
function lastRunFailed(row: OverviewRow): boolean {
  return store.overviewRead[overviewKey(row.backend, row.session.id)]?.failed === true;
}

/**
 * The row's model chip: the last turn's model plus its effort variant. Rows
 * whose backend reports no model simply omit the chip — no placeholder, since
 * "the listing cannot say" is not the same fact as "no model".
 */
function modelLabel(row: OverviewRow): string | null {
  return overviewModelLabel(row.model);
}

/** The full model id, since the chip is ellipsized by the meta line. */
function modelTitle(row: OverviewRow): string | undefined {
  return row.model?.modelId ?? undefined;
}

function clearFilters(): void {
  query.value = "";
  agent.value = "all";
  setOverviewFilter("all");
}

// ── summary (loaded on demand, one request at a time) ───────────────────

const summary = reactive<
  OverviewSummary & {
    loading: boolean;
    error: boolean;
    key: string | null;
    revision: number | null;
  }
>({
  prompt: "",
  reply: "",
  loading: false,
  error: false,
  key: null,
  revision: null,
});
let summaryToken = 0;
const summaryRetry = ref(0);
let summaryReadQueue = Promise.resolve();
const summaryCache = new Map<
  string,
  { updatedAt: number; revision: number | null; summary: OverviewSummary }
>();

const summarySource = computed(() => {
  const row = selectedRow.value;
  if (!row) return { key: null, updatedAt: 0, revision: null, retry: summaryRetry.value };
  return {
    key: rowKey(row),
    updatedAt: row.session.updatedAt,
    revision: store.overviewRead[overviewKey(row.backend, row.session.id)]?.revision ?? null,
    retry: summaryRetry.value,
  };
});

watch(summarySource, async ({ key, updatedAt, revision }) => {
  summaryToken += 1;
  const token = summaryToken;
  summary.key = key;
  summary.prompt = "";
  summary.reply = "";
  summary.error = false;
  summary.revision = null;
  if (!key) {
    summary.loading = false;
    return;
  }
  const row = overviewRows.value.find((item) => rowKey(item) === key);
  if (!row) {
    summary.loading = false;
    return;
  }
  // The summary cache is keyed by backend and session, so same native ids in
  // separate agents never share text. A newer list timestamp or result
  // revision forces a fresh read.
  const cached = summaryCache.get(key);
  if (cached && cached.updatedAt === updatedAt && cached.revision === revision) {
    summary.prompt = cached.summary.prompt;
    summary.reply = cached.summary.reply;
    summary.revision = revision;
    summary.loading = false;
    return;
  }
  summary.loading = true;
  let release: () => void = () => {};
  const previousRead = summaryReadQueue;
  summaryReadQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousRead;
  try {
    if (token !== summaryToken) return;
    const messages = await window.awefork.messages(row.backend, row.session.id);
    if (token !== summaryToken) return;
    const text = summarizeMessages(messages);
    summaryCache.delete(key);
    summaryCache.set(key, { updatedAt, revision, summary: text });
    if (summaryCache.size > 50) {
      const oldestKey = summaryCache.keys().next().value;
      if (oldestKey) summaryCache.delete(oldestKey);
    }
    summary.prompt = text.prompt;
    summary.reply = text.reply;
    summary.revision = revision;
  } catch {
    summary.error = true;
  } finally {
    release();
    if (token === summaryToken) summary.loading = false;
  }
});

function retrySummary(): void {
  if (summary.key) summaryCache.delete(summary.key);
  summaryRetry.value += 1;
}

const ask = computed<AgentInteractionRequest | null>(() => {
  const row = selectedRow.value;
  if (!row) return null;
  return overviewPendingAsk(row.backend, row.session.id);
});

/** Only requests with a direct allow/deny response are answered in place. */
const askApproval = computed(() => {
  const current = ask.value;
  if (!current) return false;
  if (current.kind === "opencode-permission") {
    return current.patterns.length > 0 || Boolean(current.command);
  }
  if (current.kind === "file-approval") return Boolean(current.grantRoot);
  if (current.kind === "permission-approval") return current.requested.length > 0;
  return current.kind === "command-approval";
});

/** One closed question with options can be answered with a single click. */
const askOptions = computed<Array<{ label: string; description: string }> | null>(() => {
  const current = ask.value;
  if (current?.kind !== "user-input") return null;
  if (current.questions.length !== 1) return null;
  const options = current.questions[0]?.options;
  if (!options || options.length === 0) return null;
  return options;
});

function answerAsk(decision: "allow" | "deny"): void {
  const row = selectedRow.value;
  const current = ask.value;
  if (!row || !current) return;
  respondInteraction(current, { decision }, row.backend);
}

function answerWithOption(label: string): void {
  const row = selectedRow.value;
  const current = ask.value;
  if (!row || !current || current.kind !== "user-input") return;
  const question = current.questions[0];
  if (!question) return;
  respondInteraction(
    current,
    { decision: "answers", answers: { [question.id]: label } },
    row.backend,
  );
}

function markSeen(): void {
  const row = selectedRow.value;
  if (row && summary.revision !== null) {
    markOverviewSeen(row.backend, row.session.id, summary.revision);
  }
}

/**
 * Jump: the row's backend, session and latest turn. The panel closes only once
 * the navigation really landed — a failed switch or a vanished session keeps
 * the panel (and the unread badge) exactly where it was.
 */
async function jump(row: OverviewRow): Promise<void> {
  await jumpToOverviewSession(row.backend, row.session.id);
}

// ── placement, dragging, dismissal ──────────────────────────────────────

/** The canvas viewport this panel floats over (its offset parent). */
function viewportRect(): DOMRect | null {
  return panelEl.value?.offsetParent?.getBoundingClientRect() ?? null;
}

function panelSize(): { width: number; height: number } {
  const rect = panelEl.value?.getBoundingClientRect();
  const host = viewportRect();
  const width = rect?.width || Math.min(620, (host?.width ?? window.innerWidth) - 20);
  const height = rect?.height || 320;
  return { width, height };
}

function clampPosition(): void {
  const host = viewportRect();
  const { width, height } = panelSize();
  const maxX = Math.max(8, (host?.width ?? window.innerWidth) - width - 8);
  const maxY = Math.max(8, (host?.height ?? window.innerHeight) - height - 8);
  position.x = Math.min(Math.max(8, position.x), maxX);
  position.y = Math.min(Math.max(8, position.y), maxY);
}

/** First open: centered under the trigger, clamped to the canvas. */
async function placeInitial(): Promise<void> {
  await nextTick();
  const host = viewportRect();
  const { width } = panelSize();
  const hostWidth = host?.width ?? window.innerWidth;
  const hostHeight = host?.height ?? window.innerHeight;
  position.x = Math.max(8, Math.round((hostWidth - width) / 2));
  // Start below whatever already owns the canvas's top strip — the trigger
  // pill (two rows tall once a narrow canvas wraps it), the pick-mode
  // banner, and the story search's input box — instead of at a guessed
  // offset that parked the panel on top of them. The search *results* and
  // the digest/marks lists are read-only surfaces a floating panel may
  // cover, the way it covers canvas cards; the input is the one control
  // that has to stay reachable.
  const top = host?.top ?? 0;
  let below = 56;
  const occupants = [".overview-trigger", ".pick-banner", ".ss-box"];
  for (const selector of occupants) {
    const occupant = document.querySelector(selector);
    if (!occupant) continue;
    const bottom = occupant.getBoundingClientRect().bottom - top;
    if (bottom + 8 > below) below = Math.round(bottom + 8);
  }
  // The floor keeps max-height (a function of y) a valid, positive value
  // even on a canvas shorter than the top strip.
  position.y = Math.min(below, Math.max(56, hostHeight - 20));
  // Clamp x only. The panel's own max-height shrinks with y, so its bottom
  // edge is inside the canvas by construction; clamping y against the
  // panel's natural height here would double-count that cap and pull a
  // too-tall panel back up over the strip it was just placed below.
  const maxX = Math.max(8, hostWidth - width - 8);
  position.x = Math.min(position.x, maxX);
  placed.value = true;
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  // Buttons in the header (the close ×) keep their click.
  if ((event.target as HTMLElement).closest("button")) return;
  drag = {
    startX: event.clientX,
    startY: event.clientY,
    originX: position.x,
    originY: position.y,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent): void {
  if (!drag) return;
  position.x = drag.originX + (event.clientX - drag.startX);
  position.y = drag.originY + (event.clientY - drag.startY);
  clampPosition();
}

function endDrag(event: PointerEvent): void {
  if (!drag) return;
  drag = null;
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
}

const panelStyle = computed(() => ({
  left: `${position.x}px`,
  top: `${position.y}px`,
  maxHeight: `calc(100% - ${position.y + 12}px)`,
}));

/**
 * Outside click and Esc collapse the panel. The outside click is a plain
 * pointerdown listener — it never calls preventDefault, so the canvas click it
 * lands on still pans, selects or focuses exactly as before.
 */
function onDocPointerDown(event: PointerEvent): void {
  if (!store.overview.open) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".overview-float, .overview-trigger")) return;
  closeOverviewPanel();
}

function onDocKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && store.overview.open) {
    event.preventDefault();
    event.stopPropagation();
    closeOverviewPanel();
    return;
  }
  // "/" focuses the panel's search, but never steals a keystroke from an input.
  if (!store.overview.open || event.key !== "/") return;
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (target?.isContentEditable) return;
  event.preventDefault();
  searchInput.value?.focus();
}

function onWindowResize(): void {
  if (store.overview.open && placed.value) clampPosition();
}

watch(
  () => store.overview.open,
  (open) => {
    if (!open) {
      query.value = "";
      clearChecked();
      return;
    }
    // First open centers under the trigger; later opens keep the position the
    // user dragged to, clamped in case the window shrank meanwhile.
    if (placed.value) void nextTick().then(clampPosition);
    else void placeInitial();
  },
);

// A jump switches backends, which rebuilds the rows under the cursor; keep the
// panel's position clamped to the new layout rather than off screen.
watch(
  () => store.activeBackend,
  () => {
    if (store.overview.open && placed.value) clampPosition();
  },
);

/**
 * While the panel is open, re-list the other agents on a slow tick. Their
 * events only refresh the *active* backend's index, so a session started in a
 * TUI would otherwise stay invisible until the panel was reopened. One sweep
 * per tick, throttled inside `refreshOverviewSessions` — never a per-row poll.
 */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function stopSweep(): void {
  if (sweepTimer === null) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

watch(
  () => store.overview.open,
  (open) => {
    stopSweep();
    if (!open) return;
    sweepTimer = setInterval(() => void refreshOverviewSessions(), 20_000);
  },
);

/**
 * Fill in the model chips the listings cannot answer, for the rows this panel
 * is showing. Runs when the visible set changes (open, tab switch, search, a
 * refresh landing) and at most reads OVERVIEW_MODEL_BATCH of them per pass.
 * `ensureOverviewModels` is a no-op once every visible row is answered, so a
 * plain re-render costs nothing.
 */
watch(
  () => (store.overview.open ? visibleRows.value : []),
  (rows) => {
    if (rows.length > 0) void ensureOverviewModels(rows);
  },
  { immediate: true, flush: "post" },
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
  window.addEventListener("resize", onWindowResize);
});

onUnmounted(() => {
  stopSweep();
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
  window.removeEventListener("resize", onWindowResize);
});
</script>
