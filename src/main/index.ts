import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, nativeImage, screen } from "electron";
import type { BackendId } from "../shared/backend.js";
import { DigestsStore } from "../shared/digest-store.js";
import { OverviewLedgerStore } from "../shared/overview-ledger.js";
import { RoundsStore } from "../shared/rounds-store.js";
import { createBackendRegistry } from "./backend-registry.js";
import { registerIpc } from "./ipc.js";
import { registerSaveFileIpc } from "./save-file.js";
import {
  readBackendSelection,
  readWindowBounds,
  type WindowBounds,
  writeWindowBounds,
} from "./settings-store.js";
import { setUpdaterExitHook } from "./update-install.js";

const registry = createBackendRegistry(app.getPath("userData"));
// The overview's unread ledger lives in the main process so every window
// shares one record: a window that marks a result seen (or that settles a
// run while off screen) updates the same file the others read. The IPC
// channels and the "awefork:overview-read" broadcast are registered by
// registerIpc whenever this store is passed in.
const overviewLedger = new OverviewLedgerStore(join(app.getPath("userData"), "overview-read.json"));
// The multi-model rounds sidecar, also main-owned: the renderer's round
// groups are window-local memory, so without this file a restart forgets
// which branches form a round and its sessions degrade into plain fork
// cards. Every window restores the same rounds at boot.
const roundsStore = new RoundsStore(join(app.getPath("userData"), "rounds.json"));
// The story digests sidecar (事后总结), main-owned for the same reason: a
// digest's ✦ card and reading view must survive a restart, and every
// window restores the same digests.
const digestsStore = new DigestsStore(join(app.getPath("userData"), "digests.json"));

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
// Registered after agentWindows so multi-window navigations can find the
// window that owns the target agent.
registerIpc(
  registry,
  openAgentWindow,
  overviewLedger,
  undefined,
  agentWindows,
  roundsStore,
  digestsStore,
);
registerSaveFileIpc();
// The updater's macOS relaunch exits via app.exit(0), which never fires
// before-quit — hook the same teardown so no backend child survives the swap.
// Keep-alive is forced off here on purpose: an update swap must not leave the
// old install's servers behind to fight the new one over session files.
setUpdaterExitHook(() => registry.dispose({ keepAlive: false }));

/**
 * Whether a saved placement still lands on a real display. A laptop that
 * undocks, or a monitor that is unplugged, leaves bounds that would open the
 * window off-screen where the user cannot reach it — the default box is the
 * better answer then.
 */
function isOnScreen(bounds: WindowBounds): boolean {
  const displays = screen.getAllDisplays();
  // Any overlap with any display counts; requiring full containment would
  // reject a window the user deliberately hung over an edge.
  return displays.some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

async function createWindow(agent?: BackendId): Promise<void> {
  // Reopen where this kind of window was left. The saved placement is applied
  // before first paint so the window never flashes at the default size first;
  // a placement that is off-screen (a monitor that is gone) is dropped and the
  // default box is used instead.
  const settingsPath = join(app.getPath("userData"), "settings.json");
  const kind = agent ?? "main";
  const saved = await readWindowBounds(settingsPath, kind).catch(() => null);
  const placement = saved && isOnScreen(saved) ? saved : null;
  const window = new BrowserWindow({
    width: placement?.width ?? 1280,
    height: placement?.height ?? 840,
    ...(placement ? { x: placement.x, y: placement.y } : {}),
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

  // Remember the placement for the next launch. Debounced: dragging a window
  // emits a resize/move per frame, and each save is a read-modify-write of the
  // whole settings file. `getNormalBounds` reports the restored box even while
  // maximized, so un-maximizing after a restart lands on a real size.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const rememberBounds = (): void => {
    if (window.isDestroyed()) return;
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (window.isDestroyed()) return;
      const box = window.getNormalBounds();
      void writeWindowBounds(settingsPath, kind, {
        ...box,
        maximized: window.isMaximized(),
      }).catch(() => {
        // A failed write only costs the next launch its placement.
      });
    }, 400);
  };
  window.on("resized", rememberBounds);
  window.on("moved", rememberBounds);
  window.on("maximize", rememberBounds);
  window.on("unmaximize", rememberBounds);
  // A close is the last chance to record a move that is still inside the
  // debounce window.
  window.on("close", () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (window.isDestroyed()) return;
    const box = window.getNormalBounds();
    void writeWindowBounds(settingsPath, kind, {
      ...box,
      maximized: window.isMaximized(),
    }).catch(() => {});
  });
  if (placement?.maximized) window.maximize();

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

/**
 * Quit gate: quitting kills every spawned backend, so a run in flight gets
 * interrupted. When one is still going and the user has not opted into
 * keep-alive, ask first — the checkbox turns keep-alive on for future quits
 * (toggleable in the top bar). The main process cannot see the renderer's
 * locale, so the dialog text carries both languages.
 */
let quitConfirmed = false;
app.on("before-quit", (event) => {
  const running = registry.runningSessions();
  if (!quitConfirmed && running.length > 0 && !registry.quitKeepAlive()) {
    event.preventDefault();
    void dialog
      .showMessageBox({
        type: "warning",
        message: `${running.length} 个会话仍在运行 / ${running.length} session(s) still running`,
        detail:
          "退出会中断 Pi 任务。/ Quitting interrupts Pi tasks." +
          "\n后台保留时，其他后端的任务会在后台完成。/ With keep-alive, other backends finish in the background.",
        buttons: ["退出并中断 / Quit and interrupt", "取消 / Cancel"],
        defaultId: 1,
        cancelId: 1,
        checkboxLabel: "以后退出都在后台保留运行 / Keep runs alive after quit from now on",
        checkboxChecked: false,
      })
      .then((choice) => {
        if (choice.response !== 0) return;
        if (choice.checkboxChecked) registry.setQuitKeepAlive(true);
        quitConfirmed = true;
        app.quit();
      });
    return;
  }
  registry.dispose();
});
