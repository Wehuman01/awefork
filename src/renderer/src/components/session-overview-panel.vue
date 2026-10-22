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
        <span>{{ t("overview.colSession") }}</span>
        <span>{{ t("overview.colStatus") }}</span>
        <span>{{ t("overview.colActivity") }}</span>
      </div>

      <div class="float-session-list">
        <button
          v-for="row in visibleRows"
          :key="rowKey(row)"
          type="button"
          class="float-session-row"
          :class="{
            selected: store.overview.selectedKey === rowKey(row),
            current: isCurrent(row),
          }"
          :aria-pressed="store.overview.selectedKey === rowKey(row)"
          @click="selectOverviewRow(row.backend, row.session.id)"
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
          <span class="jump-chevron" aria-hidden="true">↗</span>
        </button>

        <div v-if="visibleRows.length === 0" class="float-empty">
          {{ t("overview.empty") }}
          <button type="button" @click="clearFilters">{{ t("overview.clearFilters") }}</button>
        </div>
      </div>

      <p v-if="store.overview.error" class="float-error" role="alert">
        {{ store.overview.error }}
      </p>
      <p v-else-if="remoteFailure" class="float-note">{{ remoteFailure }}</p>

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
          <p>{{ summary.loading ? t("overview.loadingSummary") : summary.prompt || t("overview.noPrompt") }}</p>
        </div>
        <div class="summary-block">
          <span>{{ t("overview.lastReply") }}</span>
          <p>{{ summary.loading ? t("overview.loadingSummary") : summary.reply || t("overview.noReply") }}</p>
        </div>

        <!-- A pending ask is answered through the same queue the inline card and
             the modal use, routed by backend + requestId. Complex asks (forms,
             multi-question input) send the user to the session instead of
             growing a second approval surface here. -->
        <div v-if="ask" class="summary-ask">
          <b>{{ t(ask.title, ask.vars) }}</b>
          <div v-if="askOptions" class="summary-ask-options">
            <button
              v-for="option in askOptions"
              :key="option"
              type="button"
              @click="answerWithOption(option)"
            >{{ option }}</button>
          </div>
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
        <span>{{ t("overview.footer") }}</span>
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
  matchesOverviewAgent,
  matchesOverviewFilter,
  matchesOverviewQuery,
  type OverviewFilter,
  type OverviewRow,
  type OverviewSummary,
  overviewKey,
  projectOf,
  summarizeMessages,
} from "../session-overview";
import {
  clearOverviewSelection,
  closeOverviewPanel,
  jumpToOverviewSession,
  markOverviewSeen,
  overviewAgents,
  overviewPendingAsk,
  overviewRemoteError,
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

function clearFilters(): void {
  query.value = "";
  agent.value = "all";
  setOverviewFilter("all");
}

// ── summary (loaded on demand, one request at a time) ───────────────────

const summary = reactive<OverviewSummary & { loading: boolean; key: string | null }>({
  prompt: "",
  reply: "",
  loading: false,
  key: null,
});
let summaryToken = 0;

watch(
  () => store.overview.selectedKey,
  async (key) => {
    summaryToken += 1;
    const token = summaryToken;
    summary.key = key;
    summary.prompt = "";
    summary.reply = "";
    if (!key) {
      summary.loading = false;
      return;
    }
    const row = overviewRows.value.find((item) => rowKey(item) === key);
    if (!row) {
      summary.loading = false;
      return;
    }
    // The visible backend's rows are usually already in the store; anything
    // else — and a stale cache — is fetched here, one session at a time.
    const cached = store.messagesBySession[row.session.id];
    if (cached) {
      const text = summarizeMessages(cached as ChatMessage[]);
      summary.prompt = text.prompt;
      summary.reply = text.reply;
      summary.loading = false;
      return;
    }
    summary.loading = true;
    try {
      const messages = await window.awefork.messages(row.backend, row.session.id);
      if (token !== summaryToken) return;
      const text = summarizeMessages(messages);
      summary.prompt = text.prompt;
      summary.reply = text.reply;
    } catch {
      // A failed read leaves the summary empty; the jump button reports the
      // real error, and an empty summary is not an error the user must clear.
    } finally {
      if (token === summaryToken) summary.loading = false;
    }
  },
);

const ask = computed<AgentInteractionRequest | null>(() => {
  const row = selectedRow.value;
  if (!row) return null;
  return overviewPendingAsk(row.backend, row.session.id);
});

/** Simple approvals answer in place; forms and multi-question asks do not. */
const askApproval = computed(
  () => ask.value !== null && ask.value.kind !== "user-input" && ask.value.kind !== "opencode-form",
);

/** One closed question with options can be answered with a single click. */
const askOptions = computed<string[] | null>(() => {
  const current = ask.value;
  if (current?.kind !== "user-input") return null;
  if (current.questions.length !== 1) return null;
  const options = current.questions[0]?.options;
  if (!options || options.length === 0) return null;
  return options.map((option) => option.label);
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
  if (row) markOverviewSeen(row.backend, row.session.id);
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
  position.x = Math.max(8, Math.round((hostWidth - width) / 2));
  position.y = 56;
  clampPosition();
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
