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

  // 4b-ii. A real directory through the path box: folder rows carry a
  //     disclosure caret, and clicking one unfolds its children in place —
  //     the tree behavior the session dock has, inside the browser's own
  //     listing. The repo checkout is a real tree wherever this runs.
  await retry(
    () =>
      cdp.evaluate(
        `(() => { ${fillInput(".fb-path", root)}; document.querySelector(".fb-path-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); return true; })()`,
      ),
    5000,
    "path jump to the repo root",
  );
  const listed = await retry(async () => {
    const rows = await cdp.evaluate(`({
      total: document.querySelectorAll(".fb-row").length,
      carets: document.querySelectorAll(".fb-row-caret:not(.fb-row-caret-off)").length,
      nested: [...document.querySelectorAll(".fb-row-wrap")].filter(
        (w) => parseFloat(getComputedStyle(w).paddingLeft) > 8,
      ).length,
    })`);
    if (rows.total < 2 || rows.carets < 1 || rows.nested !== 0) {
      throw new Error(`repo root listing incomplete: ${JSON.stringify(rows)}`);
    }
    return rows;
  }, 10_000, "repo root listing");
  check("a real listing renders folder carets and nothing unfolded", true, JSON.stringify(listed));

  await cdp.evaluate(`document.querySelector(".fb-row-caret:not(.fb-row-caret-off)").click()`);
  const unfolded = await retry(async () => {
    const rows = await cdp.evaluate(`({
      total: document.querySelectorAll(".fb-row").length,
      nested: [...document.querySelectorAll(".fb-row-wrap")].filter(
        (w) => parseFloat(getComputedStyle(w).paddingLeft) > 8,
      ).length,
      open: document.querySelectorAll('.fb-row-caret[aria-expanded="true"]').length,
    })`);
    if (rows.total <= listed.total || rows.nested < 1 || rows.open < 1) {
      throw new Error(`folder did not unfold: ${JSON.stringify(rows)}`);
    }
    return rows;
  }, 10_000, "folder unfolds in place");
  check("a folder's caret unfolds its children in place", true, JSON.stringify(unfolded));

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
