/**
 * Real-window canvas framing regression: a startup whose graph is small at
 * first (selected branch + ancestors ready, siblings still loading) must keep
 * a usable camera and the selected card on screen once the whole batch lands.
 * A manual pan during the load keeps the camera for the user.
 *
 * Runs the production component and styles in real Electron, mounted in a
 * flex container so .viewport has a real size — a zero-size viewport would
 * make every visibility check meaningless, so that is asserted first.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "awefork-canvas-view-"));
let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const renderer = `
import { createApp, h, nextTick } from 'vue';
import Canvas from ${JSON.stringify(join(root, "src/renderer/src/components/session-canvas.vue"))};
import { benchmarkState as state, benchmarkAttemptedMessages as attemptedMessages, selectSession, refreshSessions, cardHeights, turnGraph } from
  ${JSON.stringify(join(root, "src/renderer/src/state.ts"))};
import ${JSON.stringify(join(root, "src/renderer/src/style.css"))};

const frame = () => new Promise(r => requestAnimationFrame(r));
const base = { thinking: '', toolNames: [], attachmentNames: [], providerId: null, modelId: null,
  variant: null, createdAt: 1700000000000, completedAt: null, finish: null, outputTokens: null, error: null };
function turns(id, count) {
  return Array.from({ length: count }, (_, i) => [
    { ...base, id: id + '-u' + i, role: 'user', text: 'Prompt ' + i },
    { ...base, id: id + '-a' + i, role: 'assistant', text: 'Reply '.repeat(42), toolNames: ['read', 'edit'],
      completedAt: base.createdAt + 1000, finish: 'stop' },
  ]).flat();
}
const MAIN = turns('main', 3);
const SEL = 'branch-12';
const branches = Array.from({ length: 12 }, (_, i) => 'branch-' + (i + 1));
const allSessions = [
  { id: 'main', title: 'main', directory: '/bench', parentSessionId: null, origin: 'root', createdAt: 1, updatedAt: 1 },
  ...branches.map((id, i) => ({ id, title: id, directory: '/bench', parentSessionId: 'main', origin: 'fork',
    createdAt: 2 + i, updatedAt: 2 + i })),
];
const lineage = Object.fromEntries(branches.map(id => [id, { parentId: 'main', atMessageId: 'main-u2', context: 'inherit' }]));
// Startup shows only the selected branch and its ancestor; a later refresh
// discovers the other siblings — the "small graph first, then it grows" boot.
let visible = allSessions.filter(s => s.id === 'main' || s.id === SEL);
const rows = { main: structuredClone(MAIN) };
for (const id of branches) rows[id] = [...structuredClone(MAIN), ...turns(id, 3)];
window.awefork = {
  sessions: async () => ({ sessions: structuredClone(visible), lineage }),
  messages: async (_b, id) => {
    if (id !== 'main' && id !== SEL) await new Promise(r => setTimeout(r, 400));
    return structuredClone(rows[id] ?? []);
  },
  saveComposer: async () => {}, models: async () => [], fileChanges: async () => null,
};

function freshState() {
  for (const key of Object.keys(cardHeights)) delete cardHeights[key];
  attemptedMessages.clear();
  visible = allSessions.filter(s => s.id === 'main' || s.id === SEL);
  Object.assign(state, { sessions: structuredClone(visible), lineage, selectedDirectory: '/bench', selectedId: SEL,
    selectedTurnId: null, booted: true, loadingMessages: false, messagesBySession: {},
    running: {}, streams: {}, recent: {}, capabilities: { deleteMessage: false, deleteSession: true,
    attachments: false, fileChanges: false, compress: false, exportBranch: false } });
}

function selectedRects() {
  const viewport = document.querySelector('.viewport').getBoundingClientRect();
  if (!(viewport.width > 0 && viewport.height > 0)) return { viewport, rects: [], visible: false };
  const rects = [...document.querySelectorAll('.turn')]
    .filter(el => el.dataset.nodeId.startsWith(SEL + ':'))
    .map(el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
  const visible = rects.length > 0 && rects.some(r => r.bottom > viewport.top && r.top < viewport.bottom);
  return { viewport, rects, visible };
}

window.__run = async ({ panDuringLoad }) => {
  freshState();
  const app = createApp({ render: () => h(Canvas) });
  app.mount('#app');
  await nextTick(); await frame();
  const trace = [];
  const selected = await selectSession(SEL);
  await nextTick(); await frame();
  trace.push({ at: 'selected-ready', nodes: turnGraph.value.nodes.length, ...unwrap(selectedRects()) });
  // The refresh that grows the story; sibling reads are slow on purpose.
  visible = allSessions;
  void refreshSessions();
  let manualTransform = null;
  let panned = false;
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline && (state.loadingCanvas || turnGraph.value.nodes.length < 39)) {
    await frame();
    if (panDuringLoad && !panned && !state.loadingMessages && state.loadingCanvas) {
      const el = document.querySelector('.viewport');
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 20, clientY: 20 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 160, clientY: 120 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
      await nextTick();
      manualTransform = document.querySelector('.world').style.transform;
      panned = true;
    }
  }
  await selected;
  // Settle: ResizeObserver heights, the load-end pass, one paint.
  for (let i = 0; i < 12; i++) { await frame(); await new Promise(r => setTimeout(r, 25)); }
  trace.push({ at: 'settled', nodes: turnGraph.value.nodes.length, ...unwrap(selectedRects()),
    loading: state.loadingCanvas, panPreserved: manualTransform === null ? null
      : manualTransform === document.querySelector('.world').style.transform });
  app.unmount();
  await nextTick();
  return trace;
};
function unwrap({ viewport, rects, visible }) {
  return { viewport: { w: Math.round(viewport.width), h: Math.round(viewport.height) }, rects, visible };
}
`;

try {
  await writeFile(
    join(temp, "index.html"),
    '<style>html,body{height:100%;margin:0}#app{height:100%;display:flex;flex-direction:column;min-height:0}</style>' +
      '<div id="app"></div><script type="module" src="/e.js"></script>',
  );
  await writeFile(join(temp, "e.js"), renderer);
  await build({
    configFile: false,
    root: temp,
    base: "./",
    logLevel: "error",
    resolve: { alias: { vue: join(root, "node_modules/vue/dist/vue.runtime.esm-bundler.js") } },
    plugins: [
      vue(),
      {
        name: "isolated-canvas-view-export",
        transform(source, id) {
          if (id === join(root, "src/renderer/src/state.ts"))
            return source + "\nexport { state as benchmarkState, attemptedMessages as benchmarkAttemptedMessages };";
        },
      },
    ],
    build: { outDir: join(temp, "dist"), emptyOutDir: true },
  });
  const runner = join(temp, "e.cjs");
  await writeFile(runner, `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(temp, "user-data"))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: true,
    webPreferences: { backgroundThrottling: false } });
  await win.loadFile(${JSON.stringify(join(temp, "dist/index.html"))});
  const grow = await win.webContents.executeJavaScript('window.__run({ panDuringLoad: false })', true);
  const pan = await win.webContents.executeJavaScript('window.__run({ panDuringLoad: true })', true);
  process.stdout.write('RESULT ' + JSON.stringify({ grow, pan }) + '\\n');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
  const electron = createRequire(join(root, "package.json"))("electron");
  const out = await new Promise((resolve, reject) => {
    const child = spawn(electron, ["--no-sandbox", runner], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      if (code !== 0 || !line) reject(new Error(`canvas view test exited ${code}: ${stdout.slice(-400)}`));
      else resolve(JSON.parse(line.slice(7)));
    });
  });

  for (const [label, trace, expectPan] of [
    ["grow", out.grow, false],
    ["pan", out.pan, true],
  ]) {
    const ready = trace.find((row) => row.at === "selected-ready");
    const settled = trace.find((row) => row.at === "settled");
    check(`${label}: viewport has a real size`, settled?.viewport.w > 0 && settled.viewport.h > 0,
      JSON.stringify(settled?.viewport));
    check(`${label}: selected card visible when the small graph is ready`, ready?.visible === true,
      JSON.stringify(ready));
    check(`${label}: graph grew past the overview limit`, (settled?.nodes ?? 0) > 18, String(settled?.nodes));
    if (expectPan) {
      check(`${label}: manual pan keeps the camera through the load`, settled?.panPreserved === true,
      `panPreserved=${JSON.stringify(settled?.panPreserved)}`);
    } else {
      check(`${label}: selected card still visible after the batch settles`, settled?.visible === true,
        JSON.stringify(settled));
      check(`${label}: loading finished`, settled?.loading === false, String(settled?.loading));
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`canvas initial view: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("canvas initial view: all checks passed");
