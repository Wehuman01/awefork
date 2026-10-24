/** Isolated production renderer benchmark; never connects to an agent or edits source. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const branches = option("--branches", "10,30,100").split(",").map(Number);
const samples = Number(option("--samples", "40"));
const assistantSteps = Number(option("--assistant-steps", "1"));
const deleteMessage = args.includes("--delete-message");
const output = option("--output", null);
const sourceRef = option("--source-ref", null);
const coldLoadOnly = args.includes("--cold-load-only");
const fullApp = args.includes("--full-app");
const panDuringLoad = args.includes("--pan-during-load");
if (
  branches.some((n) => !Number.isInteger(n) || n < 1) ||
  !Number.isInteger(samples) || samples < 5 ||
  !Number.isInteger(assistantSteps) || assistantSteps < 1
) {
  throw new Error("Use positive branch/step counts and at least 5 samples.");
}

const renderer = `
import { createApp, h, nextTick } from 'vue';
import Canvas from ${JSON.stringify(join(root, "src/renderer/src/components/session-canvas.vue"))};
import App from ${JSON.stringify(join(root, "src/renderer/src/app.vue"))};
import { benchmarkState as state, benchmarkLoadMessages as loadMessages,
  benchmarkSetStreamTail as setStreamTail, benchmarkAttemptedMessages as attemptedMessages,
  benchmarkPublishParts as publishParts,
  selectSession, cardHeights, turnGraph } from
  ${JSON.stringify(join(root, "src/renderer/src/state.ts"))};
import ${JSON.stringify(join(root, "src/renderer/src/style.css"))};

const counters = globalThis.__canvasCounters = { turns: 0, scanned: 0, graphs: 0, updates: 0 };
const Surface = ${fullApp} ? App : Canvas;
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

/** A viewport with no width or height would make every "is it visible" check
 *  meaningless — intersecting a zero-size rect is not visibility. Fail loudly
 *  instead of recording numbers that look fine. */
function viewportRect() {
  const viewport = document.querySelector('.viewport');
  if (!viewport) throw new Error('benchmark: .viewport is missing from the mounted surface');
  const rect = viewport.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) {
    throw new Error('benchmark: viewport has no size (' + rect.width + 'x' + rect.height + '); ' +
      'the mount container must give the canvas a real layout');
  }
  return rect;
}

/** Intersection of a card with the live viewport; only meaningful because
 *  viewportRect() already refused a zero-size rect. */
function intersects(cardRect, viewport) {
  return cardRect.right > viewport.left && cardRect.left < viewport.right &&
    cardRect.bottom > viewport.top && cardRect.top < viewport.bottom;
}

let rows = {};
window.awefork = {
  messages: async (_backend, id) => structuredClone(rows[id] ?? []),
  saveComposer: async () => {},
  models: async () => [],
  fileChanges: async () => null,
};

function messages(id, count, steps) {
  return Array.from({ length: count }, (_, i) => {
    const base = { id: id + '-u' + i, role: 'user', text: 'Prompt ' + i,
      thinking: '', toolNames: [], attachmentNames: [], providerId: null, modelId: null,
      variant: null, createdAt: 1700000000000 + i * 10000, completedAt: null,
      finish: null, outputTokens: null, error: null };
    return [base, ...Array.from({ length: steps }, (_, step) => ({ ...base,
      id: id + '-a' + i + '-' + step, role: 'assistant', text: 'Reply '.repeat(42),
      toolNames: ['read', 'edit'], completedAt: base.createdAt + step + 1000,
      finish: step === steps - 1 ? 'stop' : 'tool-calls' }))];
  }).flat();
}

function fixture(count, steps) {
  const main = messages('main', 30, steps);
  rows = { main, outside: messages('outside', 2, steps) };
  const sessions = [];
  const lineage = {};
  for (let i = 0; i <= count; i++) {
    const id = i === 0 ? 'main' : 'branch-' + i;
    sessions.push({ id, title: id, directory: '/benchmark',
      parentSessionId: i ? 'main' : null, origin: i ? 'fork' : 'root',
      createdAt: 1700000000000 + i, updatedAt: 1700000000000 + i });
    if (i) {
      rows[id] = [...structuredClone(main), ...messages(id, 5, steps)];
      lineage[id] = { parentId: 'main', atMessageId: 'main-u29', context: 'inherit' };
    }
  }
  for (const key of Object.keys(cardHeights)) delete cardHeights[key];
  Object.assign(state, { sessions, lineage, selectedDirectory: '/benchmark',
    selectedId: ${fullApp} ? 'branch-1' : 'main', selectedTurnId: null, booted: true, loadingMessages: false,
    messagesBySession: structuredClone(rows), running: {}, streams: {}, recent: {},
    capabilities: { deleteMessage: ${deleteMessage}, deleteSession: true,
      attachments: false, fileChanges: false, compress: false, exportBranch: false } });
}

async function measure(action, samples) {
  const raw = [];
  for (let i = 0; i < samples + 5; i++) {
    Object.keys(counters).forEach(key => counters[key] = 0);
    const start = performance.now();
    await action(i);
    await nextTick();
    const vueMs = performance.now() - start;
    const counts = { ...counters };
    await frame();
    // A rAF boundary is before painting; this is NOT input-to-paint latency.
    if (i >= 5) raw.push({ vueMs, toAnimationFrameMs: performance.now() - start, ...counts });
  }
  const sorted = raw.map(row => row.vueMs).sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1), raw };
}

window.runCanvasBenchmark = async ({ branches, samples, assistantSteps }) => {
  const results = [];
  for (const count of branches) {
    fixture(count, assistantSteps);
    const app = createApp({ render: () => h(Surface) });
    app.mixin({ updated() { counters.updates++; } });
    app.mount('#app');
    for (let i = 0; i < 6; i++) { await nextTick(); await frame(); }
    const rect = viewportRect();
    const viewportEl = document.querySelector('.viewport');
    const visibleCards = [...document.querySelectorAll('.turn')].filter(card =>
      intersects(card.getBoundingClientRect(), rect),
    ).length;
    viewportEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 }));
    await nextTick();
    const drag = await measure(i => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 + i * 2, clientY: 20 + i }));
    }, samples);
    window.dispatchEvent(new MouseEvent('mouseup'));
    const zoom = await measure(i => {
      viewportEl.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
        clientX: 700, clientY: 450, deltaY: i % 2 ? 1 : -1 }));
    }, samples);
    const reload = await measure(() => loadMessages('branch-1', false, state.activeBackend), samples);
    const outsideReload = await measure(() => loadMessages('outside', false, state.activeBackend), samples);
    state.running['branch-1'] = true;
    await nextTick(); await frame();
    const stream = await measure(i => publishParts(state.activeBackend, 'branch-1', [{
      partId: 'live', messageId: 'inflight', kind: 'text', text: 'stream ' + i, startedAt: null, endedAt: null,
    }]), samples);
    const repeatedTail = await measure(() => setStreamTail(state.activeBackend, 'branch-1', 'stream unchanged'), samples);
    results.push({ branches: count, cards: turnGraph.value.nodes.length, visibleCards,
      viewport: { w: Math.round(rect.width), h: Math.round(rect.height) },
      domElements: document.querySelectorAll('*').length, drag, zoom, reload, outsideReload, stream, repeatedTail });
    app.unmount();
    await nextTick();
  }
  return { userAgent: navigator.userAgent, results };
};

window.runColdCanvasBenchmark = async ({ branches, assistantSteps }) => {
  const coldLoads = [];
  for (const count of branches) {
    fixture(count, assistantSteps);
    const selected = 'branch-' + count;
    state.messagesBySession = {};
    state.selectedId = selected;
    attemptedMessages.clear();
    let active = 0, maxConcurrent = 0;
    const requests = [];
    const start = performance.now();
    window.awefork.messages = async (backend, id) => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      const request = { backend, id, startedMs: performance.now() - start };
      requests.push(request);
      // A slow sibling models backend variance; these delays are synthetic.
      const delay = id === selected ? 15 : id === 'main' ? 30 : id === 'branch-1' ? 400 : 40;
      await new Promise(resolve => setTimeout(resolve, delay));
      active--;
      request.finishedMs = performance.now() - start;
      return structuredClone(rows[id]);
    };
    Object.keys(counters).forEach(key => counters[key] = 0);
    const app = createApp({ render: () => h(Surface) });
    app.mixin({ updated() { counters.updates++; } });
    app.mount('#app');
    let finished = false, firstReadableMs = null, firstVisibleMs = null, firstReadyMs = null;
    let finalVisible = false, manualTransform = null;
    const loading = selectSession(selected, { focus: true }).then(() => { finished = true; });
    let settledFrames = 0;
    while (!finished || settledFrames < 4) {
      await frame();
      const cards = [...document.querySelectorAll('.turn')].filter(el => el.dataset.nodeId.startsWith(selected + ':'));
      const readable = cards.filter(el => el.textContent.includes('Reply'));
      if (readable.length && firstReadableMs === null) firstReadableMs = performance.now() - start;
      const viewport = viewportRect();
      const visible = readable.some(el => intersects(el.getBoundingClientRect(), viewport));
      if (visible && firstVisibleMs === null) firstVisibleMs = performance.now() - start;
      if (visible && !state.loadingMessages && firstReadyMs === null) firstReadyMs = performance.now() - start;
      finalVisible = visible;
      if (${panDuringLoad} && firstReadyMs !== null && manualTransform === null) {
        const viewportEl = document.querySelector('.viewport');
        viewportEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 70 }));
        window.dispatchEvent(new MouseEvent('mouseup'));
        await nextTick();
        manualTransform = document.querySelector('.world').style.transform;
      }
      if (finished) settledFrames++;
    }
    await loading;
    const finalViewport = viewportRect();
    coldLoads.push({ branches: count, viewport: { w: Math.round(finalViewport.width), h: Math.round(finalViewport.height) },
      firstReadableMs, firstVisibleMs, firstReadyMs,
      allLoadedMs: Math.max(...requests.map(r => r.finishedMs)), maxConcurrent,
      finalVisible, panPreserved: manualTransform === null ? null : manualTransform === document.querySelector('.world').style.transform,
      ...counters, requests });
    app.unmount();
    await nextTick();
  }
  return { userAgent: navigator.userAgent, coldLoads };
};
`;

const sourceHashes = Object.fromEntries(await Promise.all([
  "src/renderer/src/state.ts", "src/renderer/src/components/session-canvas.vue", "src/shared/turns.ts", "src/shared/canvas-graph.ts",
].map(async path => {
  const source = sourceRef ? execFileSync("git", ["show", sourceRef + ":" + path], { cwd: root }) : await readFile(join(root, path));
  return [path, createHash("sha256").update(source).digest("hex")];
})));
if (!sourceRef) {
  const path = "src/renderer/src/message-loader.ts";
  sourceHashes[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
}

const temp = await mkdtemp(join(tmpdir(), "awefork-canvas-bench-"));
try {
  await writeFile(
    join(temp, "index.html"),
    // The canvas-only mount needs a flex column host: .viewport sizes itself
    // with flex:1, and a plain block #app collapses it to height 0 — a
    // zero-size viewport silently invalidates every visibility check.
    '<style>html,body{height:100%;margin:0}#app{height:100%;display:flex;flex-direction:column;min-height:0}</style>' +
      '<div id="app"></div><script type="module" src="/benchmark-entry.js"></script>',
  );
  await writeFile(join(temp, "benchmark-entry.js"), renderer);
  await build({
    configFile: false,
    root: temp,
    base: "./",
    logLevel: "error",
    resolve: { alias: { vue: join(root, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
    plugins: [vue(), {
      name: "isolated-benchmark-instrumentation",
      enforce: "pre",
      load(id) {
        if (sourceRef && id.startsWith(join(root, "src/")) && !id.includes("?") && /\.(ts|vue)$/.test(id)) {
          return execFileSync("git", ["show", sourceRef + ":" + id.slice(root.length)],
            { cwd: root, encoding: "utf8" });
        }
      },
      transform(source, id) {
        if (id === join(root, "src/renderer/src/app.vue")) {
          if (!source.includes("void init();")) throw new Error("App bootstrap changed; update the isolated benchmark.");
          return source.replace("void init();", "");
        }
        if (id === join(root, "src/shared/turns.ts")) {
          return source.replace(
            "export function buildTurns(sessionId: string, messages: readonly ChatMessage[]): Turn[] {",
            "$&\n globalThis.__canvasCounters.turns++; globalThis.__canvasCounters.scanned += messages.length;",
          );
        }
        if (id === join(root, "src/shared/canvas-graph.ts")) {
          return source.replace("export function buildTurnGraph(options: BuildGraphOptions): TurnGraph {",
            "$&\n globalThis.__canvasCounters.graphs++;");
        }
        if (id === join(root, "src/renderer/src/state.ts")) {
          return source + "\nexport { state as benchmarkState, loadSessionMessages as benchmarkLoadMessages, setStreamTail as benchmarkSetStreamTail, attemptedMessages as benchmarkAttemptedMessages, publishParts as benchmarkPublishParts };";
        }
      },
    }],
    build: { outDir: join(temp, "dist"), emptyOutDir: true },
  });
  const runner = join(temp, "electron.cjs");
  await writeFile(runner, `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(temp, "user-data"))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: true,
    title: 'awefork canvas benchmark', webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadFile(${JSON.stringify(join(temp, "dist/index.html"))});
    const result = await win.webContents.executeJavaScript(
      'window.${coldLoadOnly ? "runColdCanvasBenchmark" : "runCanvasBenchmark"}(' + ${JSON.stringify(JSON.stringify({ branches, samples, assistantSteps }))} + ')');
    process.stdout.write('CANVAS_BENCH_RESULT ' + JSON.stringify(result) + '\\n');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`);
  const electron = createRequire(import.meta.url)("electron");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, ["--no-sandbox", runner], {
      cwd: root,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const line = stdout.split("\n").find((s) => s.startsWith("CANVAS_BENCH_RESULT "));
      if (code !== 0 || !line) reject(new Error(`Benchmark exited ${code}: ${stderr}`));
      else resolve(JSON.parse(line.slice("CANVAS_BENCH_RESULT ".length)));
    });
  });
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const report = {
    measuredAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    changes: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }),
    platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node: process.version, version: pkg.version,
    config: { branches, samples, assistantSteps, deleteMessage, fullApp, coldLoadOnly, panDuringLoad, width: 1440, height: 900 },
    sourceRef,
    sourceHashes,
    note: "Synthetic canvas only; event to Vue nextTick, not FPS or input-to-paint latency. Raw timings include instrumentation.",
    ...result,
  };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  if (report.coldLoads) console.table(report.coldLoads.map(({ requests, ...summary }) => summary));
  else console.table(report.results.map(({ branches, cards, visibleCards, viewport, drag, zoom, reload, outsideReload, stream }) => ({
    branches, cards, visibleCards, viewport: `${viewport.w}x${viewport.h}`,
    dragMs: drag.medianMs.toFixed(2), dragP95Ms: drag.p95Ms.toFixed(2), zoomMs: zoom.medianMs.toFixed(2),
    reloadMs: reload.medianMs.toFixed(2), outsideReloadMs: outsideReload.medianMs.toFixed(2),
    streamMs: stream.medianMs.toFixed(2), turnsPerDrag: drag.raw[0].turns, graphsPerReload: reload.raw[0].graphs,
  })));
  if (output) console.log(`Raw results: ${output}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
