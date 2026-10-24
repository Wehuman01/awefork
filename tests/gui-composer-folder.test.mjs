/**
 * Real-window GUI verification of the composer's folder handling: a folder
 * dropped or pasted onto the right-pane composer lands as its absolute path,
 * one line, while files keep taking the attachment route.
 *
 * Boots like gui-test.mjs — the built app under AWEFORK_DEMO=1 against the
 * demo vite server, asserted over CDP. Two platform behaviors are stubbed
 * page-side, because a synthetic transfer cannot produce them:
 * webkitGetAsEntry (the only thing that can call an item a directory before
 * reading it — stubbed per item off its mime, exactly the shape a directory
 * File has) and window.awefork.pathForFile (the preload bridge, null in the
 * demo adapter — stubbed to name an absolute path).
 *
 * Build first: `npm run build` (the production renderer + preload).
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
const testHome = await mkdtemp(join(tmpdir(), "awefork-folder-home-"));
const cdpPort = 9800 + Math.floor(Math.random() * 100);
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
  await Promise.race([demoServer.close(), new Promise((resolve) => setTimeout(resolve, 2000))]);
  process.exit(code);
}
setTimeout(() => {
  console.error("composer folder gui: global 180s watchdog fired");
  void cleanup(1);
}, 180_000).unref();
process.on("SIGINT", () => void cleanup(130));
process.on("SIGTERM", () => void cleanup(143));

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
      this.socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
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

const fillTextarea = (selector, text) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("missing " + ${JSON.stringify(selector)});
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

const composerValue = () => `document.querySelector(".chat-input textarea")?.value ?? ""`;
const chipCount = () => `document.querySelectorAll(".chat-input .att-chip").length`;

/** Drop a batch of synthetic Files on the composer, like a Finder drag. */
const dropOnComposer = (files) => `(() => {
  const dt = new DataTransfer();
  for (const [name, type, body] of ${JSON.stringify(files)}) dt.items.add(new File([body], name, { type }));
  const el = document.querySelector(".chat-input");
  el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
})()`;

/** Paste a batch of synthetic Files into the composer's textarea. */
const pasteIntoComposer = (files) => `(() => {
  const dt = new DataTransfer();
  for (const [name, type, body] of ${JSON.stringify(files)}) dt.items.add(new File([body], name, { type }));
  const el = document.querySelector(".chat-input textarea");
  el.focus();
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
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

  // 1. Boot, then open the right-pane composer (it needs a selected session).
  await retry(() => cdp.evaluate(`document.querySelectorAll(".turn").length >= 2`), 30_000, "renderer boot");
  await retry(() => cdp.evaluate(`document.querySelectorAll(".turn")[0].click()`), 5000, "turn select");
  await retry(() => cdp.evaluate(`Boolean(document.querySelector(".chat-input textarea"))`), 10_000, "composer");
  check("composer mounted in the right pane", true);

  // 2. Stub the two platform behaviors a synthetic transfer cannot produce.
  await cdp.evaluate(`(() => {
    // A directory File carries no mime; a text file does — the stub answers
    // per item off that, exactly the split the composer needs.
    DataTransferItem.prototype.webkitGetAsEntry = function () {
      return { isDirectory: this.type === "" };
    };
    // The demo adapter's pathForFile answers null; name an absolute path.
    window.awefork.pathForFile = (file) => "/probe/" + file.name;
    return true;
  })()`);

  // 3. Drop a folder: its absolute path lands on its own line, no chip.
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", "看看这个目录：")), 5000, "composer fill");
  const chipsBeforeDrop = await cdp.evaluate(chipCount());
  await cdp.evaluate(dropOnComposer([["myproject", "", "x"]]));
  const afterFolderDrop = await retry(
    () => cdp.evaluate(composerValue()),
    5000,
    "folder drop value",
  );
  check(
    "a dropped folder lands as its absolute path on its own line",
    afterFolderDrop === "看看这个目录：\n/probe/myproject\n",
    JSON.stringify(afterFolderDrop),
  );
  const chipsAfterFolderDrop = await cdp.evaluate(chipCount());
  check(
    "a dropped folder stages no attachment chip",
    chipsAfterFolderDrop === chipsBeforeDrop,
    `${chipsBeforeDrop} -> ${chipsAfterFolderDrop}`,
  );

  // 4. Drop a file: the attachment route is untouched.
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", "")), 5000, "composer clear");
  await cdp.evaluate(dropOnComposer([["note.txt", "text/plain", "hello"]]));
  await retry(async () => {
    const chips = await cdp.evaluate(chipCount());
    if (chips <= chipsAfterFolderDrop) throw new Error(`no chip staged: ${chips}`);
  }, 5000, "file drop chip");
  const afterFileDrop = await cdp.evaluate(composerValue());
  check("a dropped file stages a chip and inserts no text", afterFileDrop === "", JSON.stringify(afterFileDrop));

  // 5. Paste a folder: same path landing, through the paste handler.
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", "")), 5000, "composer clear");
  await cdp.evaluate(pasteIntoComposer([["pasted-dir", "", "x"]]));
  const afterFolderPaste = await retry(
    () => cdp.evaluate(composerValue()),
    5000,
    "folder paste value",
  );
  check(
    "a pasted folder lands as its absolute path",
    afterFolderPaste === "/probe/pasted-dir\n",
    JSON.stringify(afterFolderPaste),
  );

  // 6. Paste a file: the attachment route is untouched here too.
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", "")), 5000, "composer clear");
  const chipsBeforePaste = await cdp.evaluate(chipCount());
  await cdp.evaluate(pasteIntoComposer([["clip.txt", "text/plain", "hi"]]));
  await retry(async () => {
    const chips = await cdp.evaluate(chipCount());
    if (chips <= chipsBeforePaste) throw new Error(`no chip staged: ${chips}`);
  }, 5000, "file paste chip");
  const afterFilePaste = await cdp.evaluate(composerValue());
  check("a pasted file stages a chip and inserts no text", afterFilePaste === "", JSON.stringify(afterFilePaste));

  // 7. A mixed batch: the folder takes the path route, the file the chip.
  await retry(() => cdp.evaluate(fillTextarea(".chat-input textarea", "")), 5000, "composer clear");
  const chipsBeforeMixed = await cdp.evaluate(chipCount());
  await cdp.evaluate(dropOnComposer([["mixed-dir", "", "x"], ["mixed.txt", "text/plain", "hello"]]));
  const afterMixed = await retry(
    async () => {
      const value = await cdp.evaluate(composerValue());
      if (!value.includes("/probe/mixed-dir")) throw new Error(`path missing: ${JSON.stringify(value)}`);
      return value;
    },
    5000,
    "mixed drop value",
  );
  const chipsAfterMixed = await retry(async () => {
    const chips = await cdp.evaluate(chipCount());
    if (chips <= chipsBeforeMixed) throw new Error(`no chip staged: ${chips}`);
    return chips;
  }, 5000, "mixed drop chip");
  check(
    "a mixed batch inserts the folder path and stages the file chip",
    afterMixed === "/probe/mixed-dir\n" && chipsAfterMixed === chipsBeforeMixed + 1,
    `value=${JSON.stringify(afterMixed)} chips=${chipsBeforeMixed} -> ${chipsAfterMixed}`,
  );

  void cleanup(failures === 0 ? 0 : 1);
} catch (error) {
  console.error("composer folder gui FAILED:", error);
  void cleanup(1);
}
