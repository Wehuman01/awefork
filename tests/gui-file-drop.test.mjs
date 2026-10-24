/**
 * Real-Electron verification of the external (Finder-style) file drop.
 * The app boots WITHOUT demo mode, so the production preload — and with it
 * webUtils.getPathForFile — is the live bridge. A real file is injected
 * through a file input (the only way CDP hands the renderer a File with a
 * real path) and dropped on the canvas through the app's own drop handler:
 * with no backend there are no drafts, so the expected outcome is the
 * "drop onto a specific draft" notice — reachable only when the path
 * resolved. The "could not resolve the path" notice would mean the bridge
 * failed.
 *
 * Build first: `npm run build` (the production renderer + preload).
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const electron = createRequire(import.meta.url)("electron");

const dropDir = await mkdtemp(join(tmpdir(), "awefork-drop-"));
const dropFile = join(dropDir, "interaction-notes.md");
await writeFile(dropFile, "# 交接笔记\n");

// ── Electron under test: isolated HOME (no agent CLIs found → the canvas
// stays empty, which is fine: the drop lands on the viewport itself), the
// real preload, the built renderer. ────────────────────────────────────
const testHome = await mkdtemp(join(tmpdir(), "awefork-drop-home-"));
const cdpPort = 9400 + Math.floor(Math.random() * 400);
const child = spawn(electron, ["--no-sandbox", "--disable-gpu", `--remote-debugging-port=${cdpPort}`, root], {
  cwd: root,
  env: {
    ...process.env,
    HOME: testHome,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += String(chunk)));

let cleaned = false;
async function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  child.kill("SIGKILL");
  process.exit(code);
}
setTimeout(() => {
  console.error("external drop: global 120s watchdog fired");
  void cleanup(1);
}, 120_000).unref();
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

async function retry(fn, timeout = 30_000, label) {
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Timed out after ${timeout}ms: ${label}\n${error ?? ""}\n${stderr}`);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  const target = await retry(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!page) throw new Error("CDP page target missing");
    return page;
  }, 30_000, "CDP page target");
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  // 1. The production preload is live: its bridge is on window.
  await retry(async () => {
    const bridge = await cdp.evaluate(`({
      api: typeof window.awefork,
      pathForFile: typeof window.awefork?.pathForFile,
      listDir: typeof window.awefork?.listDir,
    })`);
    if (bridge.api !== "object" || bridge.pathForFile !== "function" || bridge.listDir !== "function") {
      throw new Error(`preload bridge incomplete: ${JSON.stringify(bridge)}`);
    }
  }, 30_000, "preload bridge");
  check("production preload exposes the file bridge", true);

  // 2. The shell mounted (the canvas viewport is the drop surface).
  await retry(async () => {
    const booted = await cdp.evaluate(`Boolean(document.querySelector(".viewport"))`);
    if (!booted) throw new Error("shell not mounted yet");
  }, 30_000, "shell boot");
  check("renderer booted with the real preload", true);

  // 3. A real File, injected the only way CDP can hand the renderer one
  //    with a real path: through a file input.
  await cdp.evaluate(`(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "drop-probe-input";
    document.body.appendChild(input);
    return true;
  })()`);
  const doc = await cdp.send("DOM.getDocument");
  const node = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "#drop-probe-input",
  });
  if (!node.nodeId) throw new Error("probe input not found in the DOM");
  await cdp.send("DOM.setFileInputFiles", { files: [dropFile], nodeId: node.nodeId });

  const resolved = await retry(async () => {
    const result = await cdp.evaluate(`(() => {
      const file = document.querySelector("#drop-probe-input")?.files?.[0];
      if (!file) return { ok: false, why: "no file" };
      return { ok: true, name: file.name, path: window.awefork.pathForFile(file) };
    })()`);
    if (!result.ok || result.path !== dropFile) {
      throw new Error(`pathForFile did not resolve the real path: ${JSON.stringify(result)}`);
    }
    return result;
  }, 10_000, "webUtils path resolution");
  check("webUtils.getPathForFile resolves a real file", true, JSON.stringify(resolved));

  // 4. Drop it on the canvas through the app's own drop handler. No drafts
  //    exist without a backend, so the notice must be the "drop onto a
  //    specific draft" one — the "could not resolve" notice would mean the
  //    bridge failed inside the real handler.
  const notice = await retry(async () => {
    const text = await cdp.evaluate(`(async () => {
      const file = document.querySelector("#drop-probe-input").files[0];
      const dt = new DataTransfer();
      dt.items.add(file);
      const vp = document.querySelector(".viewport");
      vp.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      vp.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      return document.querySelector(".banner-files")?.textContent ?? "";
    })()`);
    if (text === "") throw new Error("no notice after the drop");
    return text;
  }, 10_000, "drop notice");
  check(
    "a real file drop reaches the canvas handler with its real path",
    notice.includes("请把文件放到") || notice.includes("Drop onto"),
    notice,
  );

  // 5. The same bridge drives the main process for real filesystem work.
  const listing = await retry(async () => {
    const result = await cdp.evaluate(
      `window.awefork.listDir(${JSON.stringify(dropDir)}).then((r) => JSON.stringify(r))`,
    );
    const parsed = JSON.parse(result);
    if (!parsed.ok || !parsed.value.entries.some((e) => e.name === "interaction-notes.md")) {
      throw new Error(`real listing failed: ${result}`);
    }
    return parsed;
  }, 10_000, "real directory listing");
  check("the main process lists a real directory", true);
  const relative = await retry(async () => {
    const result = await cdp.evaluate(
      `window.awefork.relativeToRoot(${JSON.stringify(dropDir)}, ${JSON.stringify(dropFile)}).then((r) => JSON.stringify(r))`,
    );
    const parsed = JSON.parse(result);
    if (!parsed.ok || parsed.value !== "interaction-notes.md") {
      throw new Error(`relative path wrong: ${result}`);
    }
    return parsed;
  }, 10_000, "real relative path");
  check("the project-relative path computes against the real root", true);
} catch (error) {
  failures += 1;
  console.error(`  ✗ ${error.message}`);
}
console.log(failures === 0 ? "external drop: all checks passed" : `external drop: ${failures} check(s) failed`);
await cleanup(failures === 0 ? 0 : 1);
