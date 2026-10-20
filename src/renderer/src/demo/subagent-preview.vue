<template>
  <div class="pv-shell">
    <header class="pv-top">
      <div class="pv-heading">
        <strong>{{ t("demo.heading") }}</strong>
        <span>{{ t("demo.subheading") }}</span>
      </div>
      <div class="pv-actions">
        <div class="pv-seg">
          <button type="button" :class="{ on: mode === 'new' }" @click="mode = 'new'">{{
            t("demo.newDesign")
          }}</button>
          <button type="button" :class="{ on: mode === 'old' }" @click="mode = 'old'">{{
            t("demo.oldDesign")
          }}</button>
        </div>
        <button type="button" class="pv-replay" @click="replay">{{ t("demo.replay") }}</button>
      </div>
    </header>

    <main ref="paneEl" class="pv-pane">
      <div class="pv-col">
        <article class="message">
          <div class="message-row user-row">
            <div class="user-body">
              {{ t("demo.userPrompt") }}
            </div>
            <span class="avatar user">🍑</span>
          </div>
        </article>

        <article class="message">
          <div class="message-row">
            <span class="avatar bot">✨</span>
            <div class="message-body">
              <!-- 思考块：回放开头流式出现，结束后折叠成一行摘要 -->
              <details v-if="thinkingDone || phase === 'thinking'" class="thought" :open="phase === 'thinking'">
                <summary class="thought-toggle">
                  <span v-if="phase === 'thinking'" class="spinner" aria-hidden="true"></span>
                  <span>{{ t("demo.thoughtTitle") }}</span>
                  <span v-if="thinkingDone" class="thought-meta">{{ t("demo.thoughtMeta") }}</span>
                </summary>
                <div class="thought-body pre-wrap">{{ thinkingText }}</div>
              </details>

              <!-- 旧版：去重后的工具名 chip + running 行 -->
              <template v-if="mode === 'old'">
                <p v-if="running" class="tool-row">
                  <span class="tool-chip running-chip">running…</span>
                </p>
                <p v-else-if="oldChips.length > 0" class="tool-row">
                  <span v-for="name in oldChips" :key="name" class="tool-chip lav">{{ name }}</span>
                </p>
                <div class="pv-note">
                  <p><strong>{{ t("demo.oldNoteTitle") }}</strong></p>
                  <p>{{ t("demo.oldNote1") }}</p>
                  <p>{{ t("demo.oldNote2") }}</p>
                  <p>{{ t("demo.oldNote3") }}</p>
                  <p>{{ t("demo.oldNote4") }}</p>
                </div>
              </template>

              <!-- 新版：每个 task 一张卡片 -->
              <template v-else>
                <div
                  v-for="task in visibleTasks"
                  :key="task.id"
                  class="pv-task"
                  :class="{ running: task.status === 'running', open: expanded[task.id] }"
                >
                  <div
                    role="button"
                    tabindex="0"
                    class="pv-task-head"
                    @click="toggleExpand(task.id)"
                    @keydown.enter.prevent="toggleExpand(task.id)"
                  >
                    <span class="pv-dot" :class="task.status"></span>
                    <span class="pv-agent">{{ task.icon }} {{ task.agent }}</span>
                    <span class="pv-task-title">{{ t(task.title) }}</span>
                    <span v-if="task.status === 'running'" class="pv-meta">
                      {{ t("demo.elapsed", { n: task.elapsed }) }}
                    </span>
                    <span v-else-if="task.status === 'done'" class="pv-meta">
                      {{
                        t("demo.doneMeta", {
                          dur: formatDuration(task.duration),
                          n: task.tools.length,
                        })
                      }}
                    </span>
                    <button
                      v-if="task.status === 'done'"
                      type="button"
                      class="pv-open"
                      :title="t('demo.openSubTitle')"
                      @click.stop="openDrill(task.id)"
                      >{{ t("demo.openSub") }}</button
                    >
                  </div>

                  <!-- 运行中：当前动作 + 字数 + 不确定进度条 -->
                  <template v-if="task.status === 'running'">
                    <p class="pv-feed">
                      <span class="spinner" aria-hidden="true"></span>
                      <span class="pre-wrap">{{ t(task.feed[task.feedIndex % task.feed.length] ?? "") }}</span>
                    </p>
                    <div class="pv-bar" aria-hidden="true"></div>
                  </template>

                  <div v-if="expanded[task.id] && task.status === 'done'" class="pv-task-body">
                    <p class="pv-k">{{ t("demo.dispatchLabel") }}</p>
                    <p class="pv-prompt pre-wrap">{{ t(task.prompt) }}</p>
                    <p class="pv-k">{{ t("demo.resultLabel") }}</p>
                    <p class="pv-result pre-wrap">{{ t(task.result) }}</p>
                  </div>
                </div>
                <p class="pv-hint">{{ t("demo.hint") }}</p>
              </template>

              <!-- 最终汇总回复 -->
              <div v-if="phase === 'synthesis' || phase === 'done'" class="message-text pre-wrap">
                {{ finalText }}<span v-if="phase === 'synthesis'" class="stream-caret"></span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </main>

    <!-- 画布 / 侧边栏配套改动（静态示意） -->
    <section class="pv-strip">
      <div class="pv-mock">
        <p class="pv-mock-title">{{ t("demo.canvasTitle") }}</p>
        <div class="pv-node">
          <span class="pv-node-title">{{ t("demo.parentNode") }}</span>
          <span class="pv-badge">🤖 3</span>
        </div>
        <p class="pv-mock-note">{{ t("demo.canvasNote") }}</p>
      </div>
      <div class="pv-mock">
        <p class="pv-mock-title">{{ t("demo.sideTitle") }}</p>
        <div class="pv-side">
          <p class="pv-side-row"
            >▾ <span>{{ t("demo.parentNode") }}</span> <span class="pv-badge">3</span></p
          >
          <p class="pv-side-child">🔍 {{ t("demo.t1Title") }}</p>
          <p class="pv-side-child">🧐 {{ t("demo.t2Title") }}</p>
          <p class="pv-side-child">🧪 {{ t("demo.t3Title") }}</p>
        </div>
        <p class="pv-mock-note">{{ t("demo.sideNote") }}</p>
      </div>
    </section>

    <!-- 子会话抽屉：只读 transcript -->
    <template v-if="drillTask">
      <div class="pv-backdrop" @click="closeDrill"></div>
      <aside class="pv-drill">
        <header class="pv-drill-head">
          <div class="pv-drill-title">
            <span class="pv-agent">{{ drillTask.icon }} {{ drillTask.agent }}</span>
            <strong>{{ t(drillTask.title) }}</strong>
          </div>
          <button
            type="button"
            class="pv-drill-close"
            :title="t('demo.drillClose')"
            @click="closeDrill"
          >
            ✕
          </button>
        </header>
        <p class="pv-drill-meta">
          {{ t("demo.drillMeta", { n: drillTask.tools.length }) }}
        </p>
        <div class="pv-drill-body">
          <article class="message">
            <div class="message-row user-row">
              <div class="user-body pre-wrap">{{ t(drillTask.prompt) }}</div>
              <span class="avatar user">🍑</span>
            </div>
          </article>
          <article class="message">
            <div class="message-row">
              <span class="avatar bot">✨</span>
              <div class="message-body">
                <details class="thought">
                  <summary class="thought-toggle">{{ t("demo.drillThought") }}</summary>
                  <div class="thought-body pre-wrap">{{ t(drillTask.thought) }}</div>
                </details>
                <p class="tool-row">
                  <span
                    v-for="name in [...new Set(drillTask.tools)]"
                    :key="name"
                    class="tool-chip lav"
                    >{{ name }}</span
                  >
                </p>
                <div class="md pv-report">
                  <p>{{ t(drillTask.report.intro) }}</p>
                  <ul>
                    <li v-for="(item, index) in drillTask.report.items" :key="index">
                      {{ t(item) }}
                    </li>
                  </ul>
                  <p>{{ t(drillTask.report.outro) }}</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </aside>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { t } from "../i18n";

/** 一张卡片的静态定义 + 回放运行态。 */
interface TaskView {
  id: string;
  agent: string;
  icon: string;
  title: string;
  prompt: string;
  result: string;
  thought: string;
  /** 抽屉里的只读回报：三段式静态文案，模板循环渲染，不走 v-html。 */
  report: { intro: string; items: string[]; outro: string };
  tools: string[];
  feed: string[];
  /** 回放里这一段跑多少毫秒。 */
  runMs: number;
  /** 落定后展示的时长（秒）；回放中按真实秒数计时。 */
  settledDuration: number;
  /** 展示用时长（秒）：落定态用 settledDuration，回放完成用实际秒数。 */
  duration: number;
  status: "pending" | "running" | "done";
  elapsed: number;
  feedIndex: number;
}

const TASKS: TaskView[] = [
  {
    id: "t1",
    agent: "explore",
    icon: "🔍",
    title: "demo.t1Title",
    prompt: "demo.t1Prompt",
    result: "demo.t1Result",
    thought: "demo.t1Thought",
    report: {
      intro: "demo.t1Intro",
      items: ["demo.t1Item1", "demo.t1Item2", "demo.t1Item3"],
      outro: "demo.t1Outro",
    },
    tools: ["read", "grep", "read", "grep", "read", "read"],
    feed: [
      "read auth/router.go",
      "grep 'middleware'",
      "read auth/permissions.ts",
      "demo.t1Feed4",
      "read middleware/role.go",
    ],
    runMs: 4800,
    settledDuration: 42,
    status: "pending",
    duration: 0,
    elapsed: 0,
    feedIndex: 0,
  },
  {
    id: "t2",
    agent: "review",
    icon: "🧐",
    title: "demo.t2Title",
    prompt: "demo.t2Prompt",
    result: "demo.t2Result",
    thought: "demo.t2Thought",
    report: {
      intro: "demo.t2Intro",
      items: ["demo.t2Item1", "demo.t2Item2"],
      outro: "demo.t2Outro",
    },
    tools: ["read", "read", "grep", "read"],
    feed: [
      "read migration_007_argon2.sql",
      "read auth/login.go",
      "grep 'argon2_hash'",
      "demo.t2Feed4",
    ],
    runMs: 5200,
    settledDuration: 58,
    status: "pending",
    duration: 0,
    elapsed: 0,
    feedIndex: 0,
  },
  {
    id: "t3",
    agent: "test-writer",
    icon: "🧪",
    title: "demo.t3Title",
    prompt: "demo.t3Prompt",
    result: "demo.t3Result",
    thought: "demo.t3Thought",
    report: {
      intro: "demo.t3Intro",
      items: ["demo.t3Item1", "demo.t3Item2", "demo.t3Item3"],
      outro: "demo.t3Outro",
    },
    tools: ["read", "write", "bash"],
    feed: [
      "read session/store.go",
      "write session_test.go",
      "bash go test ./auth/...",
      "demo.t3Feed4",
    ],
    runMs: 4200,
    settledDuration: 31,
    status: "pending",
    duration: 0,
    elapsed: 0,
    feedIndex: 0,
  },
];

const THINKING_TEXT = computed(() => t("demo.thinkingText"));
const FINAL_TEXT = computed(() => t("demo.finalText"));

/** 旧版 chip 行：按现网逻辑对工具名 Set 去重。 */
const OLD_CHIPS = ["task", "read", "grep", "write", "bash"];

const mode = ref<"new" | "old">("new");
const phase = ref<"settled" | "thinking" | "tasks" | "synthesis" | "done">("settled");
const tasks = ref<TaskView[]>(TASKS.map((task) => ({ ...task })));
const expanded = reactive<Record<string, boolean>>({});
const thinkingText = ref("");
const thinkingDone = ref(false);
const finalText = ref("");
const drillId = ref<string | null>(null);
const paneEl = ref<HTMLElement | null>(null);

const running = computed(() => phase.value !== "settled" && phase.value !== "done");
/** 新版只渲染已出现（非 pending）的卡片，回放时逐个冒出来。 */
const visibleTasks = computed(() => tasks.value.filter((t) => t.status !== "pending"));
const drillTask = computed(() => tasks.value.find((t) => t.id === drillId.value) ?? null);
const oldChips = computed(() => (phase.value === "done" ? OLD_CHIPS : []));

let timers: ReturnType<typeof setTimeout>[] = [];
let tickTimer: ReturnType<typeof setInterval> | null = null;
let feedTimer: ReturnType<typeof setInterval> | null = null;

function clearTimers(): void {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (feedTimer) clearInterval(feedTimer);
  feedTimer = null;
}

function at(ms: number, fn: () => void): void {
  timers.push(setTimeout(fn, ms));
}

/** 打字机：把 text 逐段追加到 target，完成后回调。 */
function typewriter(
  text: string,
  chunkMs: number,
  target: (v: string) => void,
  done: () => void,
): void {
  const chars = [...text];
  let i = 0;
  const step = (): void => {
    i = Math.min(chars.length, i + 2 + Math.floor(Math.random() * 3));
    target(chars.slice(0, i).join(""));
    if (i < chars.length) timers.push(setTimeout(step, chunkMs));
    else done();
  };
  timers.push(setTimeout(step, chunkMs));
}

function settle(): void {
  phase.value = "done";
  for (const task of tasks.value) {
    task.status = "done";
    task.elapsed = 0;
  }
  clearTimers();
}

/** 回到全空的回合，从思考流开始把整个 run 演一遍。 */
function replay(): void {
  clearTimers();
  closeDrill();
  for (const key of Object.keys(expanded)) expanded[key] = false;
  tasks.value = TASKS.map((task) => ({ ...task }));
  thinkingText.value = "";
  thinkingDone.value = false;
  finalText.value = "";
  phase.value = "thinking";

  typewriter(
    THINKING_TEXT.value,
    38,
    (v) => {
      thinkingText.value = v;
    },
    () => {
      thinkingDone.value = true;
    },
  );

  // 逐个派发：前一个完成后下一个开始（演示串行冒泡；并行同理）
  let cursor = 1700;
  for (const def of TASKS) {
    const defRun = def.runMs;
    at(cursor, () => {
      phase.value = "tasks";
      const task = tasks.value.find((t) => t.id === def.id);
      if (task) task.status = "running";
    });
    at(cursor + defRun, () => {
      const task = tasks.value.find((t) => t.id === def.id);
      if (!task) return;
      task.status = "done";
      task.duration = Math.round(defRun / 1000);
    });
    cursor += defRun;
  }

  // 计时与动作轮播
  tickTimer = setInterval(() => {
    const task = tasks.value.find((t) => t.status === "running");
    if (task) task.elapsed += 1;
  }, 1000);
  feedTimer = setInterval(() => {
    const task = tasks.value.find((t) => t.status === "running");
    if (task) task.feedIndex += 1;
  }, 1400);

  // 汇总回复
  at(cursor + 400, () => {
    phase.value = "synthesis";
    typewriter(
      FINAL_TEXT.value,
      26,
      (v) => (finalText.value = v),
      () => settle(),
    );
  });
}

function toggleExpand(id: string): void {
  expanded[id] = !expanded[id];
}

function openDrill(id: string): void {
  drillId.value = id;
}

function closeDrill(): void {
  drillId.value = null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return t("demo.sec", { n: seconds });
  return t("demo.minSec", { m: Math.floor(seconds / 60), n: seconds % 60 });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeDrill();
}

onMounted(() => {
  // 先摆出落定态，让打开页面的人先看到终点，再自动重播讲一遍过程
  phase.value = "done";
  thinkingDone.value = true;
  thinkingText.value = THINKING_TEXT.value;
  finalText.value = FINAL_TEXT.value;
  for (const task of tasks.value) {
    task.status = "done";
    task.duration = task.settledDuration;
  }
  window.addEventListener("keydown", onKeydown);
  at(1200, () => replay());
});

onUnmounted(() => {
  clearTimers();
  window.removeEventListener("keydown", onKeydown);
});
</script>

<style scoped>
.pv-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ── 顶栏 ─────────────────────────────────────────────── */

.pv-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
}

.pv-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pv-heading strong {
  font-size: 14px;
}

.pv-heading span {
  font-size: 11px;
  color: var(--ink-soft);
}

.pv-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.pv-seg {
  display: flex;
  background: var(--primary-soft);
  border-radius: 999px;
  padding: 3px;
}

.pv-seg button {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-soft);
  padding: 4px 14px;
  border-radius: 999px;
  transition:
    color 0.15s,
    background 0.15s;
}

.pv-seg button.on {
  background: var(--card);
  color: var(--primary-deep);
  box-shadow: var(--shadow-card);
}

.pv-replay {
  font-size: 12px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, var(--primary), #ffa26b);
  border-radius: 999px;
  padding: 6px 16px;
  box-shadow: var(--shadow-pop);
}

.pv-replay:hover {
  filter: brightness(1.05);
}

/* ── 消息区 ───────────────────────────────────────────── */

.pv-pane {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 18px 20px;
}

.pv-col {
  max-width: 780px;
  margin: 0 auto;
}

.running-chip {
  background: var(--primary-soft);
  color: var(--primary-deep);
}

/* 演示注解框：虚线边 + 奶油底，明确不属于应用 UI 本身 */
.pv-note {
  border: 1.5px dashed var(--butter);
  background: #fffaf0;
  border-radius: 10px;
  padding: 8px 12px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-soft);
}

.pv-note p {
  margin: 0;
}

.pv-note strong {
  color: var(--ink);
}

.pv-note code {
  background: var(--primary-soft);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
}

/* ── 子任务卡片 ───────────────────────────────────────── */

.pv-task {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  padding: 8px 10px;
  margin-bottom: 7px;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.pv-task.running {
  border-color: var(--butter);
  background: #fffdf7;
}

.pv-task.open {
  box-shadow: var(--shadow-card);
}

.pv-task-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.pv-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ink-faint);
}

.pv-dot.running {
  background: var(--butter);
  animation: pv-pulse 1.2s ease-in-out infinite;
}

.pv-dot.done {
  background: var(--mint);
}

@keyframes pv-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}

.pv-agent {
  font-size: 10.5px;
  font-weight: 800;
  padding: 2.5px 9px;
  border-radius: 999px;
  background: var(--lavender-soft);
  color: #7a66d6;
  flex-shrink: 0;
}

.pv-task-title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-meta {
  font-size: 11px;
  color: var(--ink-soft);
  white-space: nowrap;
  flex-shrink: 0;
}

.pv-open {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary-deep);
  background: var(--primary-soft);
  border-radius: 999px;
  padding: 2px 9px;
  flex-shrink: 0;
}

.pv-open:hover {
  filter: brightness(0.96);
}

.pv-feed {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 7px 0 0;
  font-size: 11.5px;
  color: var(--ink-soft);
}

/* 运行中的不确定进度条：一段奶油色光带来回扫 */
.pv-bar {
  height: 3px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--primary-soft);
  margin-top: 7px;
  position: relative;
}

.pv-bar::after {
  content: "";
  position: absolute;
  left: -40%;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--butter), transparent);
  animation: pv-slide 1.2s linear infinite;
}

@keyframes pv-slide {
  to {
    left: 100%;
  }
}

.pv-task-body {
  border-top: 1px dashed var(--line);
  margin-top: 9px;
  padding-top: 8px;
}

.pv-k {
  font-size: 10.5px;
  font-weight: 800;
  color: var(--ink-faint);
  letter-spacing: 0.05em;
  margin: 0 0 3px;
}

.pv-prompt {
  font-size: 12px;
  color: var(--ink-soft);
  margin: 0 0 8px;
  line-height: 1.6;
}

.pv-result {
  font-size: 12px;
  margin: 0;
  line-height: 1.6;
}

.pv-hint {
  font-size: 11px;
  color: var(--ink-faint);
  margin: 2px 0 8px;
}

/* ── 底部：画布 / 侧边栏静态示意 ──────────────────────── */

.pv-strip {
  display: flex;
  gap: 14px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  background: var(--panel);
  overflow-x: auto;
}

.pv-mock {
  flex: 1;
  min-width: 240px;
}

.pv-mock-title {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink-soft);
  margin: 0 0 6px;
}

.pv-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px 12px;
  box-shadow: var(--shadow-card);
}

.pv-node-title {
  font-size: 12.5px;
  font-weight: 700;
}

.pv-badge {
  font-size: 10.5px;
  font-weight: 800;
  background: var(--lavender-soft);
  color: #7a66d6;
  border-radius: 999px;
  padding: 2px 8px;
}

.pv-side {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px 12px;
}

.pv-side-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 700;
  margin: 0 0 4px;
}

.pv-side-child {
  font-size: 11.5px;
  color: var(--ink-soft);
  margin: 0 0 2px;
  padding-left: 16px;
}

.pv-mock-note {
  font-size: 11px;
  color: var(--ink-faint);
  margin: 6px 0 0;
}

/* ── 子会话抽屉 ───────────────────────────────────────── */

.pv-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(74, 63, 58, 0.18);
  z-index: 40;
}

.pv-drill {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 92vw);
  background: var(--panel);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-lift);
  z-index: 41;
  display: flex;
  flex-direction: column;
  animation: pv-slide-in 0.22s ease;
}

@keyframes pv-slide-in {
  from {
    transform: translateX(24px);
    opacity: 0;
  }
}

.pv-drill-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 8px;
}

.pv-drill-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pv-drill-title strong {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-drill-close {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: var(--ink-soft);
  flex-shrink: 0;
}

.pv-drill-close:hover {
  background: var(--primary-soft);
  color: var(--primary-deep);
}

.pv-drill-meta {
  font-size: 11px;
  color: var(--ink-soft);
  padding: 0 14px 10px;
  border-bottom: 1px solid var(--line);
  margin: 0;
}

.pv-drill-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}

.pv-report p {
  margin: 0 0 8px;
}

.pv-report ul {
  margin: 0 0 8px;
  padding-left: 18px;
}

.pv-report li {
  margin-bottom: 4px;
}
</style>
