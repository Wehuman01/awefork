import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";
import type { BackendId } from "../shared/backend.js";
import { OverviewLedgerStore } from "../shared/overview-ledger.js";
import { createBackendRegistry } from "./backend-registry.js";
import { registerIpc } from "./ipc.js";
import { registerSaveFileIpc } from "./save-file.js";
import { readBackendSelection } from "./settings-store.js";
import { setUpdaterExitHook } from "./update-install.js";

const registry = createBackendRegistry(app.getPath("userData"));
// The overview's unread ledger lives in the main process so every window
// shares one record: a window that marks a result seen (or that settles a
// run while off screen) updates the same file the others read. The IPC
// channels and the "awefork:overview-read" broadcast are registered by
// registerIpc whenever this store is passed in.
const overviewLedger = new OverviewLedgerStore(join(app.getPath("userData"), "overview-read.json"));
registerIpc(registry, openAgentWindow, overviewLedger);
registerSaveFileIpc();
// The updater's macOS relaunch exits via app.exit(0), which never fires
// before-quit — hook the same teardown so no backend child survives the swap.
setUpdaterExitHook(() => registry.dispose());

// GUI smoke mode (tests/gui-test.mjs): load the demo vite server instead of
// the built renderer and skip the preload — the renderer then sees no
// window.awefork and installs its in-memory mock adapter. Packaged builds
// never honor this, so the demo surface can't leak into a real install.
const demoMode = !app.isPackaged && process.env.AWEFORK_DEMO === "1";

let mainWindow: BrowserWindow | null = null;
/**
 * One window per agent, when the user asks for one ("open in new window"). Keyed by
 * backend id so a second ask for the same agent focuses the existing window —
 * the map's size is bounded by the agent count, never the click count.
 */
const agentWindows = new Map<BackendId, BrowserWindow>();

async function createWindow(agent?: BackendId): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 560,
    title: agent ? `awefork — ${agent}` : "awefork",
    webPreferences: {
      preload: demoMode ? undefined : join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Load-bearing, not an oversight: the preload is built as ESM
      // (package.json has "type": "module"), and Electron only loads ESM
      // preload scripts with the sandbox disabled. The renderer still gets
      // no Node access — contextIsolation on, nodeIntegration off, and
      // the preload does nothing but bridge ipcRenderer.invoke channels.
      sandbox: false,
    },
  });
  if (agent) {
    agentWindows.set(agent, window);
    // macOS keeps the app alive after the window closes; a stale reference
    // would throw "Object has been destroyed" on the next focus ask.
    window.on("closed", () => {
      if (agentWindows.get(agent) === window) agentWindows.delete(agent);
    });
  } else {
    mainWindow = window;
    window.on("closed", () => {
      mainWindow = null;
    });
  }

  // The renderer is not a web browser: a compromised or confused page must
  // not be able to navigate the window to an arbitrary origin or pop one
  // open. Same-document moves (hash jumps, SPA history) stay allowed.
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === contents.getURL().split("#")[0]) return;
    event.preventDefault();
  });

  // The agent window's URL carries `#agent=<id>`: the renderer boots straight
  // into that backend — no switcher hop, no persisted-selection rewrite.
  const agentHash = agent ? `#agent=${agent}` : "";
  if (demoMode) {
    await window.loadURL(process.env.AWEFORK_DEMO_URL ?? "http://127.0.0.1:5180");
  } else if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL + agentHash);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"), {
      hash: agent ? `agent=${agent}` : "",
    });
  }
}

/** Focus the agent's window, or open one when none exists yet. */
async function openAgentWindow(backend: BackendId): Promise<{ ok: boolean; error?: string }> {
  const existing = agentWindows.get(backend);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { ok: true };
  }
  await createWindow(backend);
  return { ok: true };
}

// Subscribed exactly once, outside createWindow: a macOS Dock re-open runs
// createWindow again, and a second subscribe would leave the first reconnect
// loop alive — every event would then arrive twice and double the streams.
// Every spawned backend's events arrive here as {backend, event} envelopes,
// broadcast to every open window — each renderer keeps only its own agent's
// share, so an agent window sees its backend and the main window sees its own.
registry.forward((envelope) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("awefork:event", envelope);
  }
});

app.whenReady().then(() => {
  // Packaged builds take the Dock icon from the bundle; dev would show the
  // stock Electron one otherwise. Electron can't decode .icns, so hand it the
  // PNG master — a missing or bad icon must never block startup.
  if (!app.isPackaged && process.platform === "darwin" && app.dock) {
    try {
      const iconPath = join(app.getAppPath(), "assets/icon/icon.png");
      const image = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
      if (image && !image.isEmpty()) app.dock.setIcon(image);
    } catch {
      // cosmetic in dev; ignore
    }
  }
  // Spawn only the persisted selection at launch; the other backend stays
  // cold until the user first switches to it (registry.get spawns lazily).
  // Demo mode never spawns a real sidecar — the mock adapter is the backend.
  if (!demoMode) {
    void readBackendSelection(join(app.getPath("userData"), "settings.json"))
      .then((backend) => registry.get(backend))
      .catch(() => {
        // Startup failures surface through awefork:ready; nothing to do here.
      });
  }
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  registry.dispose();
});
