<template>
  <div class="pv-shell">
    <header class="pv-top">
      <div class="pv-heading">
        <strong>subagent 显示优化</strong>
        <span>设计预览 · opencode 适配 · 加速回放（约 20 秒演完一回合，未接真实后端）</span>
      </div>
      <div class="pv-actions">
        <div class="pv-seg">
          <button type="button" :class="{ on: mode === 'new' }" @click="mode = 'new'">新版设计</button>
          <button type="button" :class="{ on: mode === 'old' }" @click="mode = 'old'">旧版现状</button>
        </div>
        <button type="button" class="pv-replay" @click="replay">▶ 重播运行</button>
      </div>
    </header>

    <main ref="paneEl" class="pv-pane">
      <div class="pv-col">
        <article class="message">
          <div class="message-row user-row">
            <div class="user-body">
              登录接口重构完了，做一次安全排查吧。三路并行：路由权限、密码哈希、session 管理。
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
                  <span>Thought · 拆解排查任务</span>
                  <span v-if="thinkingDone" class="thought-meta">· 2.1秒</span>
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
                  <p><strong>旧版现状的问题（对照本回合：并行派了 3 个子代理）</strong></p>
                  <p>· 3 次 <code>task</code> 调用，Set 去重后只剩一个 chip，看不出派了几个</p>
                  <p>· 子代理一跑几分钟，父会话只有一行 running…，无状态、无进度、无当前动作</p>
                  <p>· 没有结果摘要，想知道子代理做了什么只能翻日志</p>
                  <p>· 子会话在侧边栏和画布里都被隐藏，没有任何入口能打开</p>
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
                    <span class="pv-task-title">{{ task.title }}</span>
                    <span v-if="task.status === 'running'" class="pv-meta">
                      已运行 {{ task.elapsed }}秒
                    </span>
                    <span v-else-if="task.status === 'done'" class="pv-meta">
                      {{ formatDuration(task.duration) }} · {{ task.tools.length }} 次工具
                    </span>
                    <button
                      v-if="task.status === 'done'"
                      type="button"
                      class="pv-open"
                      title="打开这个子代理的会话（只读）"
                      @click.stop="openDrill(task.id)"
                      >打开子会话 ↗</button
                    >
                  </div>

                  <!-- 运行中：当前动作 + 字数 + 不确定进度条 -->
                  <template v-if="task.status === 'running'">
                    <p class="pv-feed">
                      <span class="spinner" aria-hidden="true"></span>
                      <span class="pre-wrap">{{ task.feed[task.feedIndex % task.feed.length] }}</span>
                    </p>
                    <div class="pv-bar" aria-hidden="true"></div>
                  </template>

                  <div v-if="expanded[task.id] && task.status === 'done'" class="pv-task-body">
                    <p class="pv-k">派发指令</p>
                    <p class="pv-prompt pre-wrap">{{ task.prompt }}</p>
                    <p class="pv-k">执行结果</p>
                    <p class="pv-result pre-wrap">{{ task.result }}</p>
                  </div>
                </div>
                <p class="pv-hint">
                  卡片点击展开指令与结果摘要 ·「打开子会话」进入只读子会话视图（试试）
                </p>
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
        <p class="pv-mock-title">画布：父节点挂子任务徽标</p>
        <div class="pv-node">
          <span class="pv-node-title">登录接口重构</span>
          <span class="pv-badge">🤖 3</span>
        </div>
        <p class="pv-mock-note">不把子会话铺进图里；徽标点开就地展开子节点</p>
      </div>
      <div class="pv-mock">
        <p class="pv-mock-title">侧边栏：子会话折叠在父会话下</p>
        <div class="pv-side">
          <p class="pv-side-row">▾ <span>登录接口重构</span> <span class="pv-badge">3</span></p>
          <p class="pv-side-child">🔍 排查路由权限</p>
          <p class="pv-side-child">🧐 审查密码哈希</p>
          <p class="pv-side-child">🧪 session 管理补测试</p>
        </div>
        <p class="pv-mock-note">默认折叠、样式弱化，不再一刀切隐藏</p>
      </div>
    </section>

    <!-- 子会话抽屉：只读 transcript -->
    <template v-if="drillTask">
      <div class="pv-backdrop" @click="closeDrill"></div>
      <aside class="pv-drill">
        <header class="pv-drill-head">
          <div class="pv-drill-title">
            <span class="pv-agent">{{ drillTask.icon }} {{ drillTask.agent }}</span>
            <strong>{{ drillTask.title }}</strong>
          </div>
          <button type="button" class="pv-drill-close" title="返回父会话（Esc）" @click="closeDrill">
            ✕
          </button>
        </header>
        <p class="pv-drill-meta">
          子会话 · 只读 · {{ drillTask.tools.length }} 次工具调用 · glm-5.3-flash · 由父会话 task
          工具派生
        </p>
        <div class="pv-drill-body">
          <article class="message">
            <div class="message-row user-row">
              <div class="user-body pre-wrap">{{ drillTask.prompt }}</div>
              <span class="avatar user">🍑</span>
            </div>
          </article>
          <article class="message">
            <div class="message-row">
              <span class="avatar bot">✨</span>
              <div class="message-body">
                <details class="thought">
                  <summary class="thought-toggle">Thought · 制定排查计划</summary>
                  <div class="thought-body pre-wrap">{{ drillTask.thought }}</div>
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
                  <p>{{ drillTask.report.intro }}</p>
                  <ul>
                    <li v-for="(item, index) in drillTask.report.items" :key="index">
                      {{ item }}
                    </li>
                  </ul>
                  <p>{{ drillTask.report.outro }}</p>
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
    title: "排查路由权限",
    prompt:
      "扫描 auth 相关的所有路由注册，找出没有权限中间件保护的端点。只读不改，回报路径和风险等级。",
    result:
      "发现 3 个 /api/admin/* 路由未挂 requireRole 中间件，其中 /api/admin/users 普通用户可直接访问（高危），另 2 个为中危。",
    thought:
      "先从路由注册处入手，逐一核对每个端点的中间件链，再交叉比对 permissions.ts 里的角色声明。",
    report: {
      intro: "扫描了 auth/router.go 注册的全部 12 个路由，逐条核对中间件链：",
      items: [
        "/api/admin/users — 未挂 requireRole，普通用户可直接访问，高危",
        "/api/admin/stats、/api/admin/audit — 同样缺失，但仅泄露统计信息，中危",
        "其余 9 个端点中间件齐全",
      ],
      outro: '修复建议：在路由组上统一注册 requireRole("admin")，一行改动覆盖全部缺口。',
    },
    tools: ["read", "grep", "read", "grep", "read", "read"],
    feed: [
      "read auth/router.go",
      "grep 'middleware'",
      "read auth/permissions.ts",
      "已扫描 12 个路由，3 个缺少权限中间件",
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
    title: "审查密码哈希迁移",
    prompt:
      "Review migration_007_argon2 和登录成功后的哈希回填逻辑，重点看事务边界和并发场景。只审不改。",
    result:
      "迁移脚本本身正确；但登录成功后的 argon2 回填没有事务保护，进程崩溃会留下半迁移用户，建议补成单事务 UPSERT。",
    thought: "先读迁移脚本确认双写窗口设计，再顺着登录成功路径看回填发生在哪个事务里。",
    report: {
      intro: "migration_007 的双写窗口设计正确，没有发现问题。风险在回填路径：",
      items: [
        "登录验证成功后回填 argon2_hash 的 UPDATE 与会话签发不在同一事务",
        "崩溃窗口内会出现「已验证明文、未写入新哈希」的半迁移用户，下次登录会重复迁移（幂等，但浪费）",
      ],
      outro: "建议：回填改成单事务 UPSERT，失败时整单回滚，登录照常走旧哈希兜底。",
    },
    tools: ["read", "read", "grep", "read"],
    feed: [
      "read migration_007_argon2.sql",
      "read auth/login.go",
      "grep 'argon2_hash'",
      "比对双写窗口与回填事务边界",
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
    title: "session 管理补测试",
    prompt: "给 session 管理补单测，覆盖：滑动过期、登出清缓存、记住我三条路径。跑绿为止。",
    result:
      "新增 session_test.go，3 个用例全绿。顺带发现登出没有清 redis 黑名单缓存（已在报告中标注，未改代码）。",
    thought: "先看 session/store.go 的三条路径，按行为逐条写用例，最后 go test 收口。",
    report: {
      intro: "新增 auth/session_test.go：",
      items: [
        "滑动过期 — 过期前访问续期 30 分钟 ✓",
        "登出 — session 键立即删除 ✓",
        "记住我 — 持久 cookie + 30 天 TTL ✓",
      ],
      outro:
        "go test ./auth/... 全绿。顺带发现：登出未清 redis 黑名单缓存，留存到下个 TTL 窗口，已标注未改。",
    },
    tools: ["read", "write", "bash"],
    feed: [
      "read session/store.go",
      "write session_test.go",
      "bash go test ./auth/...",
      "3 个用例全部通过",
    ],
    runMs: 4200,
    settledDuration: 31,
    status: "pending",
    duration: 0,
    elapsed: 0,
    feedIndex: 0,
  },
];

const THINKING_TEXT =
  "用户要三路并行排查。拆成三个独立子任务：路由权限交给 explore（只读扫描），密码哈希交给 review（只审不改），session 管理交给 test-writer（补测试）。三个互不依赖，可以同时派发。";
const FINAL_TEXT = `三路排查都完成了，汇总：

· 路由权限（explore）：3 个 /api/admin/* 路由未挂 requireRole，其中 /api/admin/users 普通用户可直接访问 —— 高危
· 密码哈希（review）：迁移脚本正确，但登录后的回填没有事务保护，崩溃会留下半迁移用户
· session 管理（test-writer）：3 个用例全绿；顺带发现登出没清 redis 黑名单缓存

建议先修第 1 项，路由组统一注册中间件，一行改动覆盖全部缺口。`;

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
    THINKING_TEXT,
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
      FINAL_TEXT,
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
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeDrill();
}

onMounted(() => {
  // 先摆出落定态，让打开页面的人先看到终点，再自动重播讲一遍过程
  phase.value = "done";
  thinkingDone.value = true;
  thinkingText.value = THINKING_TEXT;
  finalText.value = FINAL_TEXT;
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
