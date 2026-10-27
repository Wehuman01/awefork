/**
 * Real-window GUI smoke test, PiX-style: build output must already exist
 * (`npm run build`), then this script serves the renderer through the demo
 * vite server, boots the actual Electron app against it with the preload
 * skipped (AWEFORK_DEMO=1), and asserts the rendered DOM over CDP — no
 * jsdom stand-in, the same pixels and events a user gets.
 *
 * The mock adapter (demo/mock-adapter.ts) is the backend here, so every
 * assertion rides the hand-written fork story instead of a live opencode.
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const electron = createRequire(import.meta.url)("electron");

// ── demo vite server: DEV-mode renderer, random port ──────────────────
const { createServer } = await import("vite");
const { default: vue } = await import("@vitejs/plugin-vue");
const demoServer = await createServer({
  configFile: false,
  root: join(root, "src/renderer"),
  plugins: [vue()],
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
await demoServer.listen();
const demoUrl = demoServer.resolvedUrls.local[0];

// ── Electron under test: isolated HOME, random CDP port ───────────────
const testHome = await mkdtemp(join(tmpdir(), "awefork-gui-home-"));
const cdpPort = 9800 + Math.floor(Math.random() * 500);
const child = spawn(electron, ["--no-sandbox", "--disable-gpu", `--remote-debugging-port=${cdpPort}`, root], {
  cwd: root,
  env: {
    ...process.env,
    HOME: testHome,
    AWEFORK_DEMO: "1",
    AWEFORK_DEMO_URL: demoUrl,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += String(chunk)));

let demoClosed = false;
async function cleanup(code) {
  if (demoClosed) return;
  demoClosed = true;
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  child.kill("SIGKILL");
  // vite's close() waits on renderer sockets and can outlive the app; the
  // watchdog below is the real deadline, exit() is the honest one.
  await Promise.race([demoServer.close(), new Promise((resolve) => setTimeout(resolve, 2000))]);
  process.exit(code);
}
// Never let a wedged CDP connection hang a pipeline: hard deadline.
setTimeout(() => {
  console.error("gui smoke: global 240s watchdog fired");
  void cleanup(1);
}, 240_000).unref();
process.on("SIGINT", () => void cleanup(130));
process.on("SIGTERM", () => void cleanup(143));

// ── CDP over a raw WebSocket: evaluate, assert, retry until ready ─────
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
  }
  open() {
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    }).then(() => {
      // Attached only once the socket is live: responses and CDP events both
      // land here, matched back to the awaiting send() by id.
      this.socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error
          ? pending.reject(new Error(message.error.message))
          : pending.resolve(message.result);
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value;
  }
}

async function retry(fn, timeout = 20_000, label) {
  const start = Date.now();
  let error;
  while (Date.now() - start < timeout) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited early (${child.exitCode})\n${stderr}`);
    }
    try {
      return await fn();
    } catch (cause) {
      error = cause;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Timed out after ${timeout}ms: ${label}\n${error ?? ""}\n${stderr}`);
}

/** Set a form control's value the Vue v-model way: prototype setter + input event. */
const fillTextarea = (selector, text) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("missing " + ${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

/** Same v-model dance for a text input (the file panel's path box). */
const fillInput = (selector, text) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("missing " + ${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let cdp;
try {
  const target = await retry(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!page) throw new Error("Electron page target missing");
    return page;
  }, 30_000, "CDP page target");
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");

  // 0. Labs experiments (file browser, session overview) are off by default;
  //    their surfaces only exist behind those gates. Seed the switches on and
  //    reload once so every section below runs against the same app a user
  //    who flipped them would have. The seed retries because the CDP target
  //    can surface while the window is still its pre-navigation document,
  //    where localStorage is denied.
  await retry(
    () =>
      cdp.evaluate(
        `localStorage.setItem("awefork:settings", ${JSON.stringify(
          JSON.stringify({ labs: { fileBrowser: true, sessionOverview: true } }),
        )})`,
      ),
    30_000,
    "seed the labs switch",
  );
  await cdp.evaluate(`location.reload()`);

  // 1. Boot: mock adapter answers, canvas and sidebar actually rendered.
  await retry(async () => {
    const boot = await cdp.evaluate(`({
      turns: document.querySelectorAll(".turn").length,
      sidebar: Boolean(document.querySelector(".sidebar")),
      projects: document.querySelectorAll(".proj-row").length,
    })`);
    if (boot.turns < 2 || !boot.sidebar || boot.projects < 1) {
      throw new Error(`boot state incomplete: ${JSON.stringify(boot)}`);
    }
  }, 30_000, "renderer boot");
  check("boot renders canvas with demo fork story", true);

  // 2. Clicking a turn selects it.
  await cdp.evaluate(`document.querySelectorAll(".turn")[0].click()`);
  const selected = await retry(
    () => cdp.evaluate(`Boolean(document.querySelector(".turn.selected"))`),
    5000,
    "turn selection",
  );
  check("turn click selects the node", selected === true);

  // 3. Prompt flow: send a message, watch it stream, land in the transcript.
  const prompt = `gui-smoke-${Date.now()}`;
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", prompt)), 5000, "composer fill");
  await cdp.evaluate(`document.querySelector(".chat-input .send").click()`);
  await retry(async () => {
    const running = await cdp.evaluate(`Boolean(document.querySelector(".chat-input .abort"))`);
    if (!running) throw new Error("composer not in running state yet");
  }, 10_000, "running state");
  check("sent prompt flips composer into running state", true);
  await retry(async () => {
    const done = await cdp.evaluate(`({
      idle: Boolean(document.querySelector(".chat-input .send")),
      reply: document.querySelector(".message-list")?.textContent.includes("演示模式") ?? false,
      echo: document.querySelector(".message-list")?.textContent.includes(${JSON.stringify(prompt)}) ?? false,
      thought: Boolean(document.querySelector(".message-list details.thought")),
    })`);
    if (!done.idle || !done.reply || !done.echo || !done.thought) {
      throw new Error(`run not settled: ${JSON.stringify(done)}`);
    }
  }, 30_000, "streamed reply");
  check("mock run streams thinking + text into the transcript", true);

  // 4. Canvas session overview: the trigger pill sits above the canvas, opens
  //    a non-modal floating panel, a single click expands a row's summary
  //    without moving the canvas, the row's ↗ jumps straight to the session,
  //    and Esc collapses it again.
  const overviewTrigger = await cdp.evaluate(`Boolean(document.querySelector(".viewport .overview-trigger"))`);
  check("overview trigger renders above the canvas", overviewTrigger === true);

  await cdp.evaluate(`document.querySelector(".overview-trigger .trigger-name").click()`);
  await retry(
    () => cdp.evaluate(`Boolean(document.querySelector(".overview-float"))`),
    5000,
    "overview panel open",
  );
  check("trigger click opens the floating panel", true);

  const modal = await cdp.evaluate(`({
    backdrop: Boolean(document.querySelector(".overview-float + .interaction-backdrop")),
    rows: document.querySelectorAll(".overview-float .float-session-row").length,
    insideCanvas: Boolean(document.querySelector(".viewport .overview-float")),
  })`);
  check("panel lists sessions with no backdrop", modal.rows > 0 && !modal.backdrop, JSON.stringify(modal));
  check("panel floats inside the canvas viewport", modal.insideCanvas === true);

  // Each row names the model its last turn ran on, read from messages for the
  // backends whose listing cannot report one. The chip is text in the meta
  // line, so it must show up without expanding anything.
  await retry(
    () =>
      cdp.evaluate(
        `document.querySelectorAll(".overview-float .float-session-model").length > 0`,
      ),
    10000,
    "overview model chips",
  );
  const chips = await cdp.evaluate(`(() => {
    const labels = [...document.querySelectorAll(".overview-float .float-session-model")]
      .map((node) => node.textContent.trim())
      .filter(Boolean);
    return { count: labels.length, first: labels[0] ?? "" };
  })()`);
  check(
    "rows name the model their last turn ran on",
    chips.count > 0 && chips.first.length > 0,
    JSON.stringify(chips),
  );

  // A single click is a summary, never a navigation: the canvas selection and
  // the sidebar's active row must both stay put.
  const before = await cdp.evaluate(`({
    selected: document.querySelector(".turn.selected")?.dataset.nodeId ?? null,
    title: document.querySelector(".ctx-title")?.textContent ?? "",
  })`);
  await cdp.evaluate(`document.querySelector(".overview-float .float-session-main").click()`);
  await retry(
    () => cdp.evaluate(`Boolean(document.querySelector(".overview-float .float-summary"))`),
    5000,
    "row summary",
  );
  const after = await cdp.evaluate(`({
    selected: document.querySelector(".turn.selected")?.dataset.nodeId ?? null,
    title: document.querySelector(".ctx-title")?.textContent ?? "",
    panel: Boolean(document.querySelector(".overview-float")),
  })`);
  check(
    "single click expands a summary without navigating",
    after.panel && after.selected === before.selected && after.title === before.title,
    JSON.stringify({ before, after }),
  );

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await retry(
    () => cdp.evaluate(`!document.querySelector(".overview-float")`),
    5000,
    "overview panel closed by Esc",
  );
  check("Esc collapses the panel", true);

  // The row's ↗ is the one-click jump: it goes straight to the conversation,
  // so the panel closes on the landing instead of opening a summary first.
  await cdp.evaluate(`document.querySelector(".overview-trigger .trigger-name").click()`);
  await retry(
    () => cdp.evaluate(`Boolean(document.querySelector(".overview-float .jump-chevron"))`),
    5000,
    "overview panel reopened",
  );
  await cdp.evaluate(`document.querySelector(".overview-float .jump-chevron").click()`);
  await retry(
    () => cdp.evaluate(`!document.querySelector(".overview-float")`),
    10_000,
    "chevron jump",
  );
  check("row chevron jumps straight to the session", true);

  // 4c. Multi-select and bulk mark-seen: a fresh run leaves a new result, the
  //     row checkboxes take rows into a selection (without opening a
  //     summary), the header checkbox takes the whole list, and one bulk mark
  //     retires every selected new result — none of them opened.
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", "gui-smoke 批量标记")), 5000, "composer fill");
  await cdp.evaluate(`document.querySelector(".chat-input .send").click()`);
  await retry(async () => {
    const idle = await cdp.evaluate(`Boolean(document.querySelector(".chat-input .send"))`);
    if (!idle) throw new Error("run still going");
  }, 30_000, "bulk-mark run settled");
  check("second mock run settles with a new result", true);

  await cdp.evaluate(`document.querySelector(".overview-trigger .trigger-name").click()`);
  await retry(
    () => cdp.evaluate(`Boolean(document.querySelector(".overview-float .row-check"))`),
    5000,
    "overview panel reopened for multi-select",
  );
  const boxes = await cdp.evaluate(`({
    rows: document.querySelectorAll(".overview-float .float-session-row").length,
    checks: document.querySelectorAll(".overview-float .row-check").length,
  })`);
  check(
    "every row carries a multi-select checkbox",
    boxes.rows > 0 && boxes.checks === boxes.rows,
    JSON.stringify(boxes),
  );

  await cdp.evaluate(`document.querySelector(".overview-float .row-check").click()`);
  const selectedOne = await cdp.evaluate(`({
    checked: document.querySelectorAll(".overview-float .float-session-row.checked").length,
    bulk: Boolean(document.querySelector(".overview-float .float-bulk")),
    summary: Boolean(document.querySelector(".overview-float .float-summary")),
  })`);
  check(
    "row checkbox selects without opening a summary",
    selectedOne.checked === 1 && selectedOne.bulk && !selectedOne.summary,
    JSON.stringify(selectedOne),
  );

  await cdp.evaluate(`document.querySelector(".overview-float .labels-check").click()`);
  const selectedAll = await cdp.evaluate(`({
    checked: document.querySelectorAll(".overview-float .float-session-row.checked").length,
    rows: document.querySelectorAll(".overview-float .float-session-row").length,
  })`);
  check(
    "header checkbox takes the whole list into the selection",
    selectedAll.rows > 1 && selectedAll.checked === selectedAll.rows,
    JSON.stringify(selectedAll),
  );

  const markable = await cdp.evaluate(
    `Number(document.querySelector(".overview-float .bulk-mark")?.textContent.match(/·\\s*(\\d+)/)?.[1] ?? 0)`,
  );
  await cdp.evaluate(`document.querySelector(".overview-float .bulk-mark").click()`);
  await retry(async () => {
    const after = await cdp.evaluate(`({
      bulk: Boolean(document.querySelector(".overview-float .float-bulk")),
      unread: document.querySelectorAll(".overview-float .status-badge.unread").length,
      failed: document.querySelectorAll(".overview-float .status-badge.failed").length,
    })`);
    if (after.bulk || after.unread > 0 || after.failed > 0) {
      throw new Error(`new results survived the bulk mark: ${JSON.stringify(after)}`);
    }
  }, 10_000, "bulk mark-seen");
  check(
    "one bulk mark retires every selected new result",
    markable >= 1,
    `markable=${markable}`,
  );

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await retry(() => cdp.evaluate(`!document.querySelector(".overview-float")`), 5000, "panel closed after bulk mark");
  check("panel collapses after the bulk mark", true);

  // 4g. Story search layout: the popup lives in the canvas's top-strip stack,
  //     whose max-width leaves the overview pill its corner. An open surface
  //     is a flex item, and its own fit-content used to ride over that cap —
  //     a long hit's text then pushed the box past the canvas's right edge,
  //     where the context panel cut the results off. Measured on a narrow
  //     viewport so the cap binds below the demo hits' own content width:
  //     that is the only state where the overflow shows up at all.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    await retry(
      () =>
        cdp.evaluate(
          `window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }))`,
        ),
      5000,
      "open the story search",
    );
    await retry(() => cdp.evaluate(`Boolean(document.querySelector(".ss-box"))`), 5000, "search box open");
    await retry(() => cdp.evaluate(fillInput(".ss-box input", "hero")), 5000, "type the query");
    const searchLayout = await retry(async () => {
      const state = await cdp.evaluate(`(() => {
        const rect = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), right: Math.round(r.right) };
        };
        return {
          hits: document.querySelectorAll(".ss-hit").length,
          viewport: rect(".viewport"),
          stack: rect(".canvas-panels"),
          results: rect(".ss-results"),
        };
      })()`);
      if (state.hits < 1) throw new Error("no hits yet");
      return state;
    }, 5000, "search hits");
    check(
      "the results popup obeys the stack's width cap",
      searchLayout.results.w <= searchLayout.stack.w + 1,
      JSON.stringify(searchLayout),
    );
    check(
      "the results popup never reaches past the canvas's right edge",
      searchLayout.results.right <= searchLayout.viewport.right + 1,
      JSON.stringify(searchLayout),
    );
    await retry(() => cdp.evaluate(`document.querySelector(".ss-box .ss-close").click()`), 5000, "close the search");
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }

  // 5. Fork flow: ＋ on a mid turn opens a draft; sending grows a new branch.
  await retry(() => cdp.evaluate(`document.querySelectorAll(".turn .add-chip")[0].click()`), 5000, "open draft");
  const draft = await retry(
    () => cdp.evaluate(`Boolean(document.querySelector(".draft textarea"))`),
    5000,
    "draft visible",
  );
  check("＋ chip opens the draft box", draft === true);
  await retry(() => cdp.evaluate(fillTextarea(".draft textarea", "gui-smoke 分支第一回合")), 5000, "draft fill");
  await cdp.evaluate(`document.querySelector(".draft .send-btn").click()`);
  await retry(async () => {
    // The forked session inherits the cut prefix, so its canvas node is a
    // turn (not a stub) under the demo-fork id the mock adapter hands out.
    const forked = await cdp.evaluate(`(() => {
      // The demo parent has tags; answer its inheritance prompt before the
      // fork request can proceed. Keep asserting the resulting node below.
      document.querySelector('.fork-tag-dialog .interaction-allow')?.click();
      return {
      node: Boolean(document.querySelector('.turn[data-node-id^="demo-fork-"]')),
      draftGone: !document.querySelector(".draft"),
      };
    })()`);
    if (!forked.node || !forked.draftGone) {
      throw new Error(`fork not grown: ${JSON.stringify(forked)}`);
    }
  }, 15_000, "fork grown");
  check("draft send forks a new branch onto the canvas", true);

  // 4d. Story digest dialog: the ✦ entry sits on the story-tab strip, opens
  //     the picker with the parked stories, both scope options and the
  //     summary controls; picking a story arms the start; Esc closes. The
  //     demo adapter parks one story, so the list shows that story.
  const digestEntry = await cdp.evaluate(`Boolean(document.querySelector(".story-tab-digest"))`);
  check("digest entry renders on the story-tab strip", digestEntry === true);

  await retry(() => cdp.evaluate(`document.querySelector(".story-tab-digest").click()`), 5000, "digest entry click");
  const digestDialog = await retry(async () => {
    const state = await cdp.evaluate(`({
      open: Boolean(document.querySelector(".ddg")),
      rows: document.querySelectorAll(".ddg-item").length,
      scopes: document.querySelectorAll(".ddg-scope-option").length,
      start: Boolean(document.querySelector(".ddg-start")),
    })`);
    if (!state.open || state.rows < 1 || state.scopes !== 2 || !state.start) {
      throw new Error(`digest dialog incomplete: ${JSON.stringify(state)}`);
    }
    return state;
  }, 5000, "digest dialog open");
  check(
    "digest dialog lists the parked stories with both scopes",
    true,
    JSON.stringify(digestDialog),
  );

  await cdp.evaluate(`document.querySelector(".ddg-item").click()`);
  const armed = await cdp.evaluate(`({
    count: document.querySelector(".ddg-count")?.textContent ?? "",
    startDisabled: document.querySelector(".ddg-start")?.disabled ?? true,
  })`);
  check("picking a story arms the digest", armed.startDisabled === false, JSON.stringify(armed));

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await retry(() => cdp.evaluate(`!document.querySelector(".ddg")`), 5000, "digest dialog closed");
  check("Esc closes the digest dialog", true);

  // 4b. File browser panel: the tabs switch the middle column and the
  //     sidebar, and the panel mounts with its states. The demo adapter has
  //     no filesystem, so the listing answers "not found" — the panel must
  //     phrase that, not crash or spin. The preview pane is on demand (it
  //     mounts for a previewed file, and every demo read answers
  //     not-found), so its absence is the correct state here.
  await retry(() => cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll(".main-tab")].find((b) => b.textContent.includes("文件"));
    if (!tab) throw new Error("files tab missing");
    tab.click();
    return Boolean(document.querySelector(".fb"));
  })()`), 5000, "files tab opens the browser");
  const fbStates = await retry(async () => {
    const state = await cdp.evaluate(`({
      visible: Boolean(document.querySelector(".fb")),
      canvasHidden: document.querySelector(".viewport")?.offsetParent === null,
      error: document.querySelector(".fb-state.err")?.textContent ?? "",
      crumbs: document.querySelectorAll(".fb-crumb").length,
      quick: Boolean(document.querySelector(".fb-quick-input")),
      tabs: document.querySelectorAll(".fb-tab:not(.fb-tab-new)").length,
      preview: Boolean(document.querySelector(".fb-preview")),
    })`);
    if (!state.visible || !state.canvasHidden || !state.quick || state.tabs < 1) {
      throw new Error(`file panel incomplete: ${JSON.stringify(state)}`);
    }
    return state;
  }, 10_000, "file panel states");
  check("files tab shows the browser and hides the canvas", true);
  check("a missing listing is phrased, not spun", fbStates.error.length > 0, fbStates.error);
  check("path breadcrumbs render for the landing directory", fbStates.crumbs >= 1, `${fbStates.crumbs} crumbs`);
  check("the preview pane waits for a file instead of squatting", fbStates.preview === false);

  // 4b-ii. Folder rows carry a disclosure caret, and clicking one unfolds
  //     its children in place — the tree behavior the session dock has,
  //     inside the browser's own listing. The demo has no filesystem (every
  //     read answers "not found"), so a small tree is handed to the IPC
  //     boundary the browser reads through; everything above it — the rows,
  //     the caret, the nesting — is the real component.
  await cdp.evaluate(`(() => {
    const entry = (name, isDir, size = null) => ({
      name,
      path: "/demo/proj/" + name,
      isDir,
      isSymlink: false,
      size,
      mtime: 1,
      hidden: false,
    });
    const trees = {
      "/demo/proj": [entry("docs", true), entry("src", true), entry("README.md", false, 12)],
      "/demo/proj/docs": [entry("guide.md", false, 4)],
      "/demo/proj/src": [entry("main.ts", false, 9)],
    };
    window.awefork.listDir = async (dir) =>
      trees[dir]
        ? { ok: true, value: { path: dir, entries: trees[dir], capped: false } }
        : { ok: false, error: { code: "not-found" } };
    return true;
  })()`);
  await retry(
    () =>
      cdp.evaluate(
        `(() => { ${fillInput(".fb-path", "/demo/proj")}; document.querySelector(".fb-path-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return true; })()`,
      ),
    5000,
    "path jump to the demo project",
  );
  const listed = await retry(async () => {
    const rows = await cdp.evaluate(`({
      total: document.querySelectorAll(".fb-row").length,
      carets: document.querySelectorAll(".fb-row-caret:not(.fb-row-caret-off)").length,
      nested: [...document.querySelectorAll(".fb-row-wrap")].filter(
        (w) => parseFloat(getComputedStyle(w).paddingLeft) > 8,
      ).length,
    })`);
    if (rows.total !== 3 || rows.carets !== 2 || rows.nested !== 0) {
      throw new Error(`demo listing incomplete: ${JSON.stringify(rows)}`);
    }
    return rows;
  }, 10_000, "demo project listing");
  check("a listing renders folder carets and nothing unfolded", true, JSON.stringify(listed));

  await cdp.evaluate(`document.querySelector(".fb-row-caret:not(.fb-row-caret-off)").click()`);
  const unfolded = await retry(async () => {
    const rows = await cdp.evaluate(`({
      total: document.querySelectorAll(".fb-row").length,
      nested: [...document.querySelectorAll(".fb-row-wrap")].filter(
        (w) => parseFloat(getComputedStyle(w).paddingLeft) > 8,
      ).length,
      open: document.querySelectorAll('.fb-row-caret[aria-expanded="true"]').length,
    })`);
    if (rows.total !== 4 || rows.nested !== 1 || rows.open !== 1) {
      throw new Error(`folder did not unfold: ${JSON.stringify(rows)}`);
    }
    return rows;
  }, 10_000, "folder unfolds in place");
  check("a folder's caret unfolds its children in place", true, JSON.stringify(unfolded));

  // 4b-iii. The preview toolbar is pinned to the top of its pane: a long
  //     file scrolls under it and the name, badges and buttons stay
  //     reachable instead of scrolling away. The demo has no filesystem, so
  //     the reads are handed to the IPC boundary the preview reads through;
  //     everything above it — the pane, the sticky head, the scrolled
  //     body — is the real component.
  await cdp.evaluate(`(() => {
    window.awefork.readImagePreview = async () => ({ ok: false, error: { code: "not-image" } });
    window.awefork.readTextPreview = async (path) => ({
      ok: true,
      value: {
        path,
        text: Array.from({ length: 200 }, (_, i) => "line " + (i + 1)).join("\\n\\n"),
        truncated: false,
        bytes: 1400,
      },
    });
    return true;
  })()`);
  await retry(() => cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll(".fb-row-name")].find((n) => n.textContent === "README.md");
    if (!row) throw new Error("README.md row missing");
    row.click();
    return Boolean(document.querySelector(".fb-preview .fp-head"));
  })()`), 5000, "preview opens for a text file");
  const pinned = await retry(async () => {
    const state = await cdp.evaluate(`(() => {
      const pane = document.querySelector(".fb-preview");
      const head = document.querySelector(".fb-preview .fp-head");
      if (!pane || !head) throw new Error("preview pane missing");
      if (pane.scrollHeight <= pane.clientHeight) throw new Error("preview pane not scrollable");
      pane.scrollTop = 400;
      const pr = pane.getBoundingClientRect();
      const hr = head.getBoundingClientRect();
      return {
        scrollTop: pane.scrollTop,
        position: getComputedStyle(head).position,
        headOffset: Math.round(hr.top - pr.top),
      };
    })()`);
    if (state.scrollTop < 100) throw new Error(`pane did not scroll: ${JSON.stringify(state)}`);
    if (state.position !== "sticky" || Math.abs(state.headOffset) > 1) {
      throw new Error(`toolbar not pinned: ${JSON.stringify(state)}`);
    }
    return state;
  }, 10_000, "toolbar pinned while scrolling");
  check("the preview toolbar stays pinned while the file scrolls", true, JSON.stringify(pinned));

  // 4b-iv. A double-click quick-previews the file inside the app — the
  //     same side pane a click opens, listing still beside it. It must
  //     not fold the listing away into reading mode; that stays the ⤢
  //     toggle's gesture.
  await retry(() => cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll(".fb-row-name")].find((n) => n.textContent === "README.md");
    if (!row) throw new Error("README.md row missing");
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return true;
  })()`), 5000, "double-click dispatched");
  const quick = await retry(async () => {
    const state = await cdp.evaluate(`({
      preview: Boolean(document.querySelector(".fb-preview .fp-head")),
      listingVisible: document.querySelector(".fb-entries")?.offsetParent !== null,
      reading: Boolean(document.querySelector(".fb-body-reading")),
    })`);
    if (!state.preview || !state.listingVisible || state.reading) {
      throw new Error(`double-click did not stay a quick preview: ${JSON.stringify(state)}`);
    }
    return state;
  }, 10_000, "double-click stays a quick preview");
  check("a double-click quick-previews without folding the listing away", true, JSON.stringify(quick));

  await retry(() => cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll(".side-tab")].find((b) => b.textContent.includes("文件"));
    if (!tab) throw new Error("sidebar files tab missing");
    tab.click();
    return Boolean(document.querySelector(".ft"));
  })()`), 5000, "sidebar files tab");
  const tree = await retry(
    () =>
      cdp.evaluate(`({
        tree: Boolean(document.querySelector(".ft")),
        places: document.querySelectorAll(".ft-row").length,
        sessionsHidden: document.querySelector(".sidebar-sessions")?.offsetParent === null,
      })`),
    5000,
    "sidebar file tab",
  );
  check("sidebar files tab shows common places", tree.tree && tree.places >= 4 && tree.sessionsHidden, JSON.stringify(tree));

  // 4b-v. The sidebar tree lists files, not just folders: an expanded
  //     place shows its .md rows, and the filter box narrows the loaded
  //     tree by name. The demo's listDir answers not-found for
  //     everything, so the place's own listing is handed to the IPC
  //     boundary the tree reads through. A place (not the project root)
  //     because the session dock pre-loads the root's children at boot.
  await retry(() => cdp.evaluate(`(() => {
    const sections = [...document.querySelectorAll(".ft-section")];
    const places = sections[0];
    const label = places?.querySelector(".ft-row-label");
    const root = label?.getAttribute("title");
    if (!root) throw new Error("place label missing");
    window.__treeRoot = root;
    const entry = (name, isDir) => ({
      name,
      path: root + "/" + name,
      isDir,
      isSymlink: false,
      size: isDir ? null : 12,
      mtime: 1,
      hidden: false,
    });
    const trees = { [root]: [entry("README.md", false), entry("guide.md", false), entry("docs", true)] };
    window.awefork.listDir = async (dir) =>
      trees[dir]
        ? { ok: true, value: { path: dir, entries: trees[dir], capped: false } }
        : { ok: false, error: { code: "not-found" } };
    places.querySelector(".ft-caret").click();
    return root;
  })()`), 5000, "expand a common place");
  const treeFiles = await retry(async () => {
    const names = await cdp.evaluate(`[...document.querySelectorAll(".ft-row-name")].map((n) => n.textContent)`);
    if (!names.includes("README.md")) {
      throw new Error(`tree lists no files: ${JSON.stringify(names)}`);
    }
    return names;
  }, 10_000, "tree lists files");
  check("the sidebar tree lists files alongside folders", true, JSON.stringify(treeFiles));
  await retry(() => cdp.evaluate(fillInput(".ft-filter input", "readme")), 5000, "type the filter");
  const filtered = await retry(async () => {
    const names = await cdp.evaluate(`[...document.querySelectorAll(".ft-row-name")].map((n) => n.textContent)`);
    if (!names.includes("README.md") || names.includes("guide.md")) {
      throw new Error(`filter did not narrow the tree: ${JSON.stringify(names)}`);
    }
    return names;
  }, 10_000, "filter narrows the tree");
  check("the filter box narrows the loaded tree", true, JSON.stringify(filtered));
  await cdp.evaluate(`document.querySelector(".ft-filter-x").click()`);

  // 4b-vi. Common places belong to the user: ＋ picks a folder into the
  //     list and × takes it back out. The defaults were seeded at boot.
  await cdp.evaluate(`(() => {
    window.awefork.pickDirectory = async () => "/demo/picked";
    return true;
  })()`);
  await retry(() => cdp.evaluate(`(() => {
    const add = [...document.querySelectorAll(".ft-row")].find((r) =>
      r.textContent.includes("选择其他文件夹"),
    );
    if (!add) throw new Error("add-place row missing");
    add.click();
    return true;
  })()`), 5000, "pick a folder for the places list");
  const added = await retry(
    () =>
      cdp.evaluate(
        `[...document.querySelectorAll(".ft-row-name")].some((n) => n.textContent === "picked")`,
      ),
    5000,
    "place added",
  );
  check("＋ adds a picked folder to the common places", added === true);
  await retry(() => cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll(".ft-row")].find((r) =>
      r.textContent.includes("picked"),
    );
    if (!row) throw new Error("picked place row missing");
    row.querySelector(".ft-row-x").click();
    return true;
  })()`), 5000, "remove the picked place");
  const removed = await retry(
    () =>
      cdp.evaluate(
        `![...document.querySelectorAll(".ft-row-name")].some((n) => n.textContent === "picked")`,
      ),
    5000,
    "place removed",
  );
  check("× removes a place from the common places", removed === true);

  // 4b-vii. The middle browser is a setting, not a fixture: turning it off
  //     in settings folds the 文件 tab away live, a tree click previews in
  //     the middle column, and ✕ returns to the canvas. Toggled through
  //     the real settings page — the switch takes effect without a reload,
  //     which is the behavior worth asserting.
  const flipMiddleBrowser = async (on) => {
    await retry(
      () =>
        cdp.evaluate(
          `window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true, bubbles: true }))`,
        ),
      5000,
      "open settings",
    );
    await retry(() => cdp.evaluate(`Boolean(document.querySelector(".settings-switch"))`), 5000, "settings page");
    await retry(() => cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll(".settings-row")].find((r) =>
        r.querySelector(".settings-row-title")?.textContent.includes("中栏文件浏览器"),
      );
      const toggle = row?.querySelector(".settings-switch");
      if (!toggle) throw new Error("middle-browser row missing");
      if (toggle.getAttribute("aria-checked") !== ${JSON.stringify(String(on))}) toggle.click();
      return toggle.getAttribute("aria-checked");
    })()`), 5000, "flip the middle-browser switch");
    await retry(
      () => cdp.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`),
      5000,
      "close settings",
    );
    await retry(() => cdp.evaluate(`!document.querySelector(".settings-backdrop")`), 5000, "settings closed");
  };

  await flipMiddleBrowser(false);
  const noBrowser = await retry(async () => {
    const state = await cdp.evaluate(`({
      filesTab: [...document.querySelectorAll(".main-tab")].some((b) => b.textContent.includes("文件")),
      canvasTab: [...document.querySelectorAll(".main-tab")].some((b) => b.textContent.includes("画布")),
    })`);
    if (state.filesTab || !state.canvasTab) {
      throw new Error(`browser did not fold away: ${JSON.stringify(state)}`);
    }
    return state;
  }, 10_000, "the 文件 tab folds away");
  check("the middle browser's tab is gone when the setting is off", true, JSON.stringify(noBrowser));
  await retry(() => cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll(".side-tab")].find((b) => b.textContent.includes("文件"));
    if (!tab) throw new Error("sidebar files tab missing");
    tab.click();
    return Boolean(document.querySelector(".ft"));
  })()`), 5000, "sidebar files tab");
  await retry(() => cdp.evaluate(`(() => {
    window.awefork.readTextPreview = async (path) => ({
      ok: true,
      value: { path, text: "# " + path + "\\n\\nstandalone preview body\\n", truncated: false, bytes: 32 },
    });
    // Expand the home place (the project root's children were pre-loaded
    // empty by the session dock at boot) and click its file.
    const sections = [...document.querySelectorAll(".ft-section")];
    const places = sections[0];
    const label = places?.querySelector(".ft-row-label");
    const root = label?.getAttribute("title");
    if (!root) throw new Error("place label missing");
    const entry = (name, isDir) => ({
      name,
      path: root + "/" + name,
      isDir,
      isSymlink: false,
      size: isDir ? null : 12,
      mtime: 1,
      hidden: false,
    });
    const trees = { [root]: [entry("README.md", false), entry("docs", true)] };
    window.awefork.listDir = async (dir) =>
      trees[dir]
        ? { ok: true, value: { path: dir, entries: trees[dir], capped: false } }
        : { ok: false, error: { code: "not-found" } };
    // The place may still be expanded from the tree test above — clicking
    // an expanded caret would collapse it and hide the file to click.
    const caret = places.querySelector(".ft-caret");
    if (caret.getAttribute("aria-expanded") !== "true") caret.click();
    return true;
  })()`), 5000, "expand a common place again");
  await retry(() => cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll(".ft-row-label")].find((n) =>
      n.textContent.includes("README.md"),
    );
    if (!row) throw new Error("README row missing");
    row.click();
    return true;
  })()`), 5000, "click the file in the tree");
  const standalone = await retry(async () => {
    const state = await cdp.evaluate(`({
      preview: Boolean(document.querySelector(".fp .fp-head")),
      markdown: (document.querySelector(".fp-markdown")?.textContent ?? "").includes("standalone preview body"),
      browser: Boolean(document.querySelector(".fb")),
      canvas: document.querySelector(".viewport")?.offsetParent !== null,
    })`);
    if (!state.preview || !state.markdown || state.browser || state.canvas) {
      throw new Error(`standalone preview incomplete: ${JSON.stringify(state)}`);
    }
    return state;
  }, 10_000, "standalone preview fills the middle column");
  check("a tree click previews in the middle column with no browser", true, JSON.stringify(standalone));
  await retry(() => cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll(".fp-head .fp-open")];
    const close = buttons[buttons.length - 1];
    if (!close) throw new Error("preview close button missing");
    close.click();
    return true;
  })()`), 5000, "close the preview");
  const backToCanvas = await retry(async () => {
    const state = await cdp.evaluate(`({
      preview: Boolean(document.querySelector(".fp")),
      canvas: document.querySelector(".viewport")?.offsetParent !== null,
    })`);
    if (state.preview || !state.canvas) {
      throw new Error(`preview did not return to the canvas: ${JSON.stringify(state)}`);
    }
    return state;
  }, 10_000, "back to the canvas");
  check("✕ returns from the preview to the canvas", true, JSON.stringify(backToCanvas));
  // The browser comes back the same way it left — through the setting.
  await flipMiddleBrowser(true);
  const browserBack = await retry(async () => {
    const state = await cdp.evaluate(
      `[...document.querySelectorAll(".main-tab")].some((b) => b.textContent.includes("文件"))`,
    );
    if (!state) throw new Error("browser did not come back");
    return state;
  }, 10_000, "the 文件 tab comes back");
  check("turning the setting back on restores the browser", browserBack === true);

  await cdp.evaluate(`[...document.querySelectorAll(".side-tab")].find((b) => b.textContent.includes("会话")).click()`);
  await cdp.evaluate(`[...document.querySelectorAll(".main-tab")].find((b) => b.textContent.includes("画布")).click()`);

  // 4c. Path drop: an internal payload lands in the draft it is dropped on
  //     as verbatim text — no attachment chip, no send — and the drop
  //     affordance lights the target while the drag is over it.
  const DROP_PATH = "/demo/shop-api/docs/interaction-notes.md";
  /**
   * Dispatch a path drag onto the element `elExpr` resolves to in the page.
   * The highlight is read after a frame, because Vue applies the class on
   * its next tick rather than inside the event handler.
   */
  const dropOnto = (elExpr, paths, files = false) =>
    cdp.evaluate(`(async () => {
      const el = (${elExpr});
      if (!el) return { ok: false, why: "target missing" };
      const dt = new DataTransfer();
      if (${JSON.stringify(paths)}.length > 0) {
        dt.setData("application/x-awefork-path", JSON.stringify(${JSON.stringify(paths)}));
      }
      if (${JSON.stringify(files)}) {
        dt.items.add(new File(["x"], "from-finder.md", { type: "text/markdown" }));
      }
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const highlighted = el.classList.contains("drop-on");
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true, highlighted };
    })()`);

  await retry(() => cdp.evaluate(`document.querySelectorAll(".turn .add-chip")[0].click()`), 5000, "open draft");
  await retry(() => cdp.evaluate(fillTextarea(".draft textarea", "请帮我看一下这个文件：")), 5000, "draft fill");
  const dropped = await retry(async () => {
    const result = await dropOnto(`document.querySelector(".draft")`, [DROP_PATH]);
    if (!result.ok) throw new Error(result.why);
    return result;
  }, 5000, "internal drop on draft");
  check("dragover highlights the draft as a drop target", dropped.highlighted === true);
  const draftText = await retry(
    () => cdp.evaluate(`document.querySelector(".draft textarea")?.value ?? ""`),
    5000,
    "draft value",
  );
  check(
    "path lands as plain text on its own line",
    draftText === `请帮我看一下这个文件：\n${DROP_PATH}\n`,
    JSON.stringify(draftText),
  );
  check(
    "no attachment chip was staged",
    (await cdp.evaluate(`document.querySelectorAll(".draft .att-chip").length`)) === 0,
  );
  check(
    "the draft was not sent",
    (await cdp.evaluate(`Boolean(document.querySelector(".draft"))`)) === true,
  );

  // 4d. Dropping on another turn retargets the draft (continue/fork), and
  //     the first draft's unsent text is parked, not lost.
  const retargeted = await retry(async () => {
    const result = await dropOnto(`document.querySelectorAll(".turn")[1]`, [DROP_PATH]);
    if (!result.ok) throw new Error(result.why);
    return result;
  }, 5000, "drop on turn card");
  check("drop on a turn card is accepted", retargeted.ok === true);
  await retry(async () => {
    const text = await cdp.evaluate(`document.querySelector(".draft textarea")?.value ?? ""`);
    if (!text.includes(DROP_PATH)) throw new Error(`retarget draft missing path: ${JSON.stringify(text)}`);
  }, 5000, "retargeted draft");
  await retry(() => cdp.evaluate(`document.querySelectorAll(".turn .add-chip")[0].click()`), 5000, "back to first target");
  const restored = await retry(
    () => cdp.evaluate(`document.querySelector(".draft textarea")?.value ?? ""`),
    5000,
    "parked draft",
  );
  check(
    "the first draft's unsent text survived the retarget",
    restored === `请帮我看一下这个文件：\n${DROP_PATH}\n`,
    JSON.stringify(restored),
  );

  // 4e. An external drop the OS cannot name inserts nothing and says so.
  const beforeExternal = await cdp.evaluate(`document.querySelector(".draft textarea")?.value ?? ""`);
  await retry(async () => {
    const result = await dropOnto(`document.querySelector(".draft")`, [], true);
    if (!result.ok) throw new Error(result.why);
  }, 5000, "external drop");
  const notice = await retry(async () => {
    const text = await cdp.evaluate(`document.querySelector(".banner-files")?.textContent ?? ""`);
    if (text === "") throw new Error("no notice after the drop");
    return text;
  }, 5000, "unnamed-drop notice");
  const afterExternal = await cdp.evaluate(`document.querySelector(".draft textarea")?.value ?? ""`);
  check("an unnamed external drop inserts nothing", beforeExternal === afterExternal);
  check(
    "the unnamed-drop notice says the paths could not be resolved",
    notice.includes("拿不到") || notice.includes("Could not resolve"),
    notice,
  );

  // 4f. The file browser is a drop target too: a path dropped anywhere in
  //     it opens in its own new tab, and the whole view lights while the
  //     drag is over it. The demo adapter has no filesystem — its stat
  //     answers "vanished" — so the drop lands on a fresh tab showing that
  //     state; what is under test is the wiring (highlight, new tab, the
  //     dropped path's own tab ending active and rendered).
  await retry(() => cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll(".main-tab")].find((b) => b.textContent.includes("文件"));
    if (!tab) throw new Error("files tab missing");
    tab.click();
    return Boolean(document.querySelector(".fb"));
  })()`), 5000, "files tab for the browser drop");
  const browserTabsBefore = await cdp.evaluate(
    `document.querySelectorAll(".fb-tab:not(.fb-tab-new)").length`,
  );
  const browserDrop = await retry(async () => {
    const result = await dropOnto(`document.querySelector(".fb")`, [DROP_PATH]);
    if (!result.ok) throw new Error(result.why);
    return result;
  }, 5000, "drop on the file browser");
  check("dragover highlights the whole browser as a drop target", browserDrop.highlighted === true);
  const browserTabs = await retry(async () => {
    const tabs = await cdp.evaluate(`({
      count: document.querySelectorAll(".fb-tab:not(.fb-tab-new)").length,
      active: document.querySelector(".fb-tab.on .fb-tab-title")?.textContent ?? "",
      activeBrowsing: document.querySelector(".fb-tab.on")?.getAttribute("title") ?? "",
    })`);
    if (tabs.count !== browserTabsBefore + 1) {
      throw new Error(`no new tab after the drop: ${JSON.stringify(tabs)}`);
    }
    // A tab that renders parked (or stuck loading) is the reactivity slip
    // this gesture first exposed: the store navigated a raw row.
    if (tabs.activeBrowsing === "") {
      throw new Error(`the new tab rendered parked: ${JSON.stringify(tabs)}`);
    }
    return tabs;
  }, 5000, "new browser tab");
  check(
    "a dropped path opens its own new tab and becomes the active one",
    browserTabs.active.includes("interaction-notes.md"),
    JSON.stringify(browserTabs),
  );

  // The ＋ button opens a tab through the same path, so it carries the same
  // regression guard: its new tab must render the position it navigated to.
  const plusTab = await retry(async () => {
    await cdp.evaluate(`document.querySelector(".fb-tab-new").click()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const state = await cdp.evaluate(`({
      activeBrowsing: document.querySelector(".fb-tab.on")?.getAttribute("title") ?? "",
      body: document.querySelector(".fb-state")?.textContent ?? "",
    })`);
    if (state.activeBrowsing === "") {
      throw new Error(`the ＋ tab rendered parked: ${JSON.stringify(state)}`);
    }
    return state;
  }, 5000, "plus tab renders its position");
  check("the ＋ tab renders the position it navigated to", plusTab.activeBrowsing !== "");
  await cdp.evaluate(`[...document.querySelectorAll(".main-tab")].find((b) => b.textContent.includes("画布")).click()`);

  // 5. No error toast survived the whole run.
  const errorToast = await cdp.evaluate(`document.querySelector(".toast.banner-error")?.textContent ?? ""`);
  check("no error toast raised", errorToast === "", errorToast);

  // 7. Sidebar panel layout: drag-resize clamps to min/max, the width
  //    survives a reload, and double-click collapse hands the freed pixels
  //    to the canvas then gives them back on the next double-click. This
  //    runs on a live desktop, so every drag re-targets from the measured
  //    width: a stray real mousemove riding the window-level drag listener
  //    costs a retry, not the run. Targets beyond the limits (100/500)
  //    exercise the clamps rather than landing on them by accident.
  const panelWidth = (selector) =>
    cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error(${JSON.stringify(`${selector} missing from the DOM`)});
      return el.getBoundingClientRect().width;
    })()`);
  const sidebarHandleCenter = () =>
    cdp.evaluate(`(() => {
      const r = document.querySelectorAll(".shell .col-handle")[0].getBoundingClientRect();
      // The fold button occupies the handle's middle and stops mousedown.
      return { x: r.x + r.width / 2, y: r.y + r.height / 3 };
    })()`);
  const mouse = (type, params) => cdp.send("Input.dispatchMouseEvent", { type, ...params });
  async function dragSidebarHandle(dx) {
    const p = await sidebarHandleCenter();
    await mouse("mouseMoved", p);
    await mouse("mousePressed", { button: "left", buttons: 1, clickCount: 1, ...p });
    await mouse("mouseMoved", { buttons: 1, x: p.x + dx, y: p.y });
    await mouse("mouseReleased", { button: "left", buttons: 0, clickCount: 1, x: p.x + dx, y: p.y });
  }
  async function dblclickSidebarHandle() {
    const p = await sidebarHandleCenter();
    await mouse("mouseMoved", p);
    for (const count of [1, 2]) {
      await mouse("mousePressed", { button: "left", clickCount: count, ...p });
      await mouse("mouseReleased", { button: "left", clickCount: count, ...p });
      if (count === 1) await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  const near = (value, expected, tolerance = 2) => Math.abs(value - expected) <= tolerance;
  /** Drag towards `target`; the rendered width must end at `expected`. */
  async function dragSidebar(target, expected, label) {
    await retry(async () => {
      const before = await panelWidth(".sidebar");
      await dragSidebarHandle(target - before);
      const after = await panelWidth(".sidebar");
      if (!near(after, expected)) throw new Error(`${label}: ${after}px, want ${expected}px`);
    }, 5000, label);
    check(label, true);
  }
  async function expectWidth(selector, expected, label) {
    await retry(async () => {
      const width = await panelWidth(selector);
      if (!near(width, expected)) throw new Error(`${label}: ${width}px, want ${expected}px`);
    }, 5000, label);
    check(label, true);
  }

  const bootWidth = await panelWidth(".sidebar");
  check("sidebar boots at the default width", near(bootWidth, 232), `${bootWidth}px`);
  await dragSidebar(292, 292, "drag widens the sidebar");
  await dragSidebar(100, 180, "drag below the minimum clamps at 180");
  await dragSidebar(500, 420, "drag past the maximum clamps at 420");

  // Mark the live page, reload, then wait until the mark is GONE plus the
  // demo story is back — evaluating against the pre-navigation document
  // otherwise passes instantly and races the fresh mount.
  await cdp.evaluate("window.__guiPreReload = true");
  await cdp.send("Page.reload");
  await retry(async () => {
    const reboot = await cdp.evaluate(`({
      stale: Boolean(window.__guiPreReload),
      turns: document.querySelectorAll(".turn").length,
      sidebar: Boolean(document.querySelector(".sidebar")),
    })`);
    if (reboot.stale || reboot.turns < 2 || !reboot.sidebar) {
      throw new Error(`reboot incomplete: ${JSON.stringify(reboot)}`);
    }
  }, 30_000, "renderer reboot after reload");
  const reloadedWidth = await panelWidth(".sidebar");
  check("reload restores the dragged width", near(reloadedWidth, 420), `${reloadedWidth}px`);

  const canvasBefore = await panelWidth(".viewport");
  // Reload can leave the page without focus, and Input.dispatchMouseEvent
  // then drops presses before they reach the DOM (verified with capture-phase
  // window listeners: not even a mousedown arrives). Bring the page back to
  // the front first; the retry below re-issues the gesture anyway.
  await cdp.send("Page.bringToFront");
  // A reload can leave the renderer unfocused, and Chromium then drops
  // Input.dispatchMouseEvent presses before they reach the DOM (verified: not
  // even a capture-phase mousedown arrives, and togglePanel never runs). Focus
  // emulation makes the page accept input regardless of real window focus.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // Input.dispatchMouseEvent can race the fresh document right after a
  // reload: the press is lost before it ever reaches the DOM (verified with
  // capture-phase window listeners — no mousedown at all). Re-issue the same
  // gesture like the drag checks do; the width assertions stay as strict.
  await retry(async () => {
    await dblclickSidebarHandle();
    const collapsed = await panelWidth(".sidebar");
    if (!near(collapsed, 0)) throw new Error(`double-click collapses the sidebar: ${collapsed}px, want 0px`);
  }, 5000, "double-click collapses the sidebar");
  await retry(async () => {
    const grown = await panelWidth(".viewport");
    if (!near(grown, canvasBefore + 420, 4)) {
      throw new Error(`canvas did not absorb the freed pixels: ${grown}px, want ${canvasBefore + 420}px`);
    }
  }, 5000, "canvas absorbs the freed pixels");
  await retry(async () => {
    await dblclickSidebarHandle();
    const restored = await panelWidth(".sidebar");
    if (!near(restored, 420)) throw new Error(`double-click restores the sidebar: ${restored}px, want 420px`);
  }, 5000, "double-click restores the sidebar");
  await retry(async () => {
    const back = await panelWidth(".viewport");
    if (!near(back, canvasBefore, 4)) throw new Error(`canvas did not return the pixels: ${back}px`);
  }, 5000, "canvas returns the pixels on expand");

} catch (error) {
  failures += 1;
  console.error(`  ✗ ${error.message}`);
}
console.log(failures === 0 ? "gui smoke: all checks passed" : `gui smoke: ${failures} check(s) failed`);
await cleanup(failures === 0 ? 0 : 1);
