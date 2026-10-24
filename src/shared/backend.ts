import { opencodeDescriptor, selectOpencodeDescriptor } from "./agent-descriptor.js";
import type { AgentEvent } from "./types.js";

/**
 * Agent backends awefork can drive. Backend is a per-call argument end to
 * end (renderer → preload → IPC → registry); the main process never has a
 * "current" mode beyond the persisted selection read at boot.
 */
export type BackendId = "opencode" | "codex" | "pi" | "zcode";

/** One entry of awefork:backends — what the top-bar switcher renders. */
export interface BackendInfo {
  id: BackendId;
  label: string;
  /** Probed via `--version` spawn; no server is started for the probe. */
  installed: boolean;
  /** CLI version parsed from the probe output; null when absent or unparseable. */
  version: string | null;
  /** Set when the CLI version falls outside the descriptor's tested range. */
  versionWarning: string | null;
}

/** What awefork:backends resolves to: the list plus the persisted selection. */
export interface BackendsResult {
  selected: BackendId;
  backends: BackendInfo[];
}

/**
 * Per-backend feature surface. The renderer hides affordances the backend
 * lacks (attach button, turn delete) instead of surfacing errors on click.
 */
export interface BackendCapabilities {
  deleteMessage: boolean;
  /** Hard delete of a whole session through the backend's own API. */
  deleteSession: boolean;
  attachments: boolean;
  /** Per-turn file-change recording from tool events (observer sidecar). */
  fileChanges: boolean;
  /**
   * Folding a session's history into a summary through the backend's own
   * compaction primitive (opencode's summarize). History stays intact — the
   * backend just carries summary + recent turns on later prompts.
   */
  compress: boolean;
  /**
   * Copying a branch out as a standalone native session. Needs a fork whose
   * parent linkage awefork owns (opencode's sidecar lineage) — a backend
   * that records fork parents itself cannot offer a detached copy.
   */
  exportBranch: boolean;
}

/**
 * Every spawned backend's events are forwarded on one channel as these
 * envelopes; the renderer routes by `backend` (running maps, view refresh)
 * and only the active backend drives the visible canvas.
 */
export interface BackendEventEnvelope {
  backend: BackendId;
  event: AgentEvent;
}

export const BACKEND_LABELS: Record<BackendId, string> = {
  opencode: "opencode",
  codex: "codex",
  pi: "pi",
  zcode: "zcode",
};

export function isBackendId(value: unknown): value is BackendId {
  return value === "opencode" || value === "codex" || value === "pi" || value === "zcode";
}

/**
 * The npm package that ships each CLI's latest version — the one source the
 * one-click installer and every missing-CLI hint quote. zcode ships with the
 * ZCode desktop app, so it has no entry.
 *
 * pi moved scopes: @mariozechner/pi-coding-agent froze at 0.73.1
 * (2026-05-07) and the project publishes @earendil-works/pi-coding-agent
 * (1.x, node ≥ 22.19) instead — "latest" lives there now. The old scope
 * stays as `legacyPkg` because a global swap must uninstall it first: two
 * packages both providing the `pi` bin would fight over the symlink, which
 * is why `pi update --self` uninstalls before it installs too.
 */
export interface AgentPackage {
  /** What `npm install -g <pkg>@latest` pulls. */
  readonly pkg: string;
  /** Old scope to uninstall before installing `pkg`, when the CLI moved. */
  readonly legacyPkg?: string;
}

export const AGENT_PACKAGES: Partial<Record<BackendId, AgentPackage>> = {
  opencode: { pkg: "opencode-ai" },
  codex: { pkg: "@openai/codex" },
  pi: {
    pkg: "@earendil-works/pi-coding-agent",
    legacyPkg: "@mariozechner/pi-coding-agent",
  },
};

/** The npm package for a backend, or null when it has no one-click install. */
export function agentPackage(backend: BackendId): AgentPackage | null {
  return AGENT_PACKAGES[backend] ?? null;
}

/**
 * "Install it with: npm install -g <pkg>" — the hint every missing-CLI
 * message quotes. null for the backends npm cannot install (zcode).
 */
export function agentInstallHint(backend: BackendId): string | null {
  const agent = agentPackage(backend);
  return agent === null ? null : `Install it with: npm install -g ${agent.pkg}`;
}

/**
 * Per-backend feature surface. The renderer hides affordances the backend
 * lacks (attach button, turn delete) instead of surfacing errors on click.
 * opencode's flags live in the agent descriptor the probed CLI version
 * selects — v2 dropped single-message delete — so `opencodeVersion` (when the
 * caller knows it) picks the right one; the CLI-spawn backends stay literal
 * until their differences migrate to a descriptor too.
 */
export function backendCapabilities(
  backend: BackendId,
  opencodeVersion: string | null = null,
): BackendCapabilities {
  switch (backend) {
    case "codex":
      // codex records fork parents itself, so no detached export; no
      // single-message delete. Compaction is thread/compact/start (a turn of
      // its own, streamed like any run). Images ride turn/start's localImage
      // input items (staged as files by main); non-image attachments have no
      // file part, so the adapter inlines them into the prompt text.
      return {
        deleteMessage: false,
        deleteSession: true,
        attachments: true,
        fileChanges: false,
        compress: true,
        exportBranch: false,
      };
    case "pi":
      // pi sessions are append-only files: no message delete, no session
      // delete primitive. Images round-trip through prompt images. A pi
      // branch copy bakes `parentSession` into the new file header, so the
      // fork linkage is pi's — no detached export. Compaction is the `compact`
      // RPC command.
      return {
        deleteMessage: false,
        deleteSession: false,
        attachments: true,
        fileChanges: false,
        compress: true,
        exportBranch: false,
      };
    case "zcode":
      // Rename and whole-session delete ride the v4 command channel
      // (`v4/command`), which the legacy session/* surface lacks; no
      // single-message delete. Fork linkage lives in zcode's own store
      // (forkedSessionId + parentSessionId), so a detached copy is not
      // offered. Compaction is the legacy session/compact method.
      return {
        deleteMessage: false,
        deleteSession: true,
        attachments: false,
        fileChanges: false,
        compress: true,
        exportBranch: false,
      };
  }
  const descriptor =
    opencodeVersion === null ? opencodeDescriptor() : selectOpencodeDescriptor(opencodeVersion);
  return {
    ...descriptor.capabilities,
    // The descriptor's optional fileChanges section is the capability: no
    // section, no recorder, no card.
    fileChanges: descriptor.fileChanges !== undefined,
    exportBranch: true,
    deleteSession: true,
  };
}

/**
 * Overlay-store path per backend (`lineage`, `pins`, `trash`, `archive` →
 * e.g. `lineage-codex.json`). Migration without moves: when the
 * opencode-suffixed file does not exist but the legacy bare one does,
 * opencode keeps reading/writing the legacy path; a fresh install (neither
 * file exists) writes the suffixed path so the two backends never collide.
 * `exists` is injected so the resolution stays pure and testable.
 */
export function resolveStorePath(
  directory: string,
  base: string,
  backend: BackendId,
  exists: (path: string) => boolean,
): string {
  const suffixed = joinPath(directory, `${base}-${backend}.json`);
  // Only opencode has legacy bare-name stores; every later backend starts
  // (and stays) on its suffixed path.
  if (backend !== "opencode") return suffixed;
  if (exists(suffixed)) return suffixed;
  const legacy = joinPath(directory, `${base}.json`);
  return exists(legacy) ? legacy : suffixed;
}

/**
 * The join, done by hand: this module is compiled into the renderer too
 * (the web tsconfig has no node types), so it cannot import node:path. The
 * separator follows the directory's own style — a Windows userData path
 * spells it with "\" throughout, and mixing in "/" would give the store
 * files a name that differs from what an older awefork wrote, so the
 * legacy-store lookup above could miss a file that is really there.
 */
function joinPath(directory: string, name: string): string {
  if (directory === "") return name;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`;
}
