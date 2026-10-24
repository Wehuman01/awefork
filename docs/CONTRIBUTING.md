# Contributing to awefork

## Setup

```bash
npm install
npm run dev        # launches Electron + Vite; the selected agent starts lazily
npm run typecheck
npm run lint
npm test
```

Requirements: Node.js ≥ 22. A supported agent CLI (`opencode`, `codex`, `pi`, or
ZCode) is needed for a live app run, but not for unit tests or the GUI suite.

## Engineering Taste

We follow these principles verbatim. Apply them unless there is an explicit conflicting convention.

- **Simple**: make the smallest change that solves the real problem.
- **Clear**: optimize for the next reader, not for cleverness.
- **Decoupled**: keep boundaries clean, but do not add abstractions without a real need.
- **Honest**: make complexity, state, side effects, assumptions, and failure modes visible; do not hide complexity or create extra complexity.
- **Focused**: preserve boundaries between modules, and keep top-level convenience commands minimal.
- **Durable**: choose behavior that is easy to maintain, test, and extend.
- **First principles**: identify the real problem, hard constraints, and known facts before reaching for patterns, abstractions, or prior solutions.

## Project Structure

```
src/
  main/                     # Electron lifecycle, IPC, backend registry and process owners
    backend-registry.ts     # lazy adapter lifecycle, capability routing, per-backend stores
    opencode-server.ts      # server discovery/reuse/spawn and opencode transport
    codex-multihome.ts      # one Codex facade over the default and aweswitch homes
    codex-server.ts         # app-server processes and JSON-RPC transport
    pi-server.ts            # JSONL indexing and short-lived RPC children
    zcode-server.ts         # app-server discovery, lifecycle and provider config
    file-browser.ts         # bounded read-only filesystem access for the renderer
    save-file.ts            # native save dialog for generated branch Markdown
    ipc.ts                  # invoke handlers for sessions, overlays, files and updates
  preload/                  # the single contextBridge surface (window.awefork)
  shared/                   # pure logic, protocol data and adapters; no Electron imports
    types.ts                # AgentAdapter, domain types and normalized AgentEvent union
    backend.ts              # backend IDs, capabilities and store-path migration
    awefork-api.ts          # typed renderer/preload contract
    agents/                 # opencode v1/v2 protocol descriptors
    agent-descriptor.ts     # closed-vocabulary validator and version selection
    opencode-adapter.ts     # descriptor-driven HTTP/SSE backend
    codex-adapter.ts        # Codex JSON-RPC backend
    pi-adapter.ts           # pi JSONL/RPC backend
    zcode-adapter.ts        # ZCode app-server backend
    *-store.ts              # lineage, pins, marks, tags, archive, trash and composer overlays
    canvas-*.ts             # pure graph and working-set projections
    file-*.ts, diff.ts      # filesystem contracts, paths, changes and bounded diffs
  renderer/                 # Vue 3 app; reactive state lives in state.ts
tests/                      # unit, fake-server and real-Electron interaction tests
docs/                       # changelog, contribution guide, specs and measurements
```

Separation rule: `shared/` never imports Electron; `main/` owns processes and I/O;
`renderer/` renders and calls the typed preload bridge. Naming: kebab-case files,
`run`+PascalCase only for commands, verb-first camelCase utilities,
`is/has/should` booleans, PascalCase types.

## Architecture

### The one idea

Agent sessions are trees. Every supported agent has a native fork/history
primitive; awefork is a projection and control layer on top:

```
renderer ── window.awefork ── IPC ── backend registry ── AgentAdapter
                                                       ├─ opencode HTTP/SSE
                                                       ├─ Codex stdio JSON-RPC
                                                       ├─ pi JSONL/RPC
                                                       └─ ZCode app-server
```

Every backend-specific IPC request names its backend. The registry keeps one lazy
adapter per backend, forwards tagged events from all running backends, and routes
overlay reads and writes to backend-specific files.

### Hard constraints (facts + rules)

1. **Native sessions stay native.** Session data comes through each agent's API
   or files. awefork adds overlay sidecars, but does not invent a replacement
   session format or rewrite the agent's store.
2. **Fork through native primitives.** The adapter contract keeps the full turn
   that starts with `atMessageId`; each adapter translates that into its
   backend's exclusive cut or turn ID. `context: "none"` creates an empty native
   session and records the visual lineage in awefork's sidecar.
3. **Lineage has a backend owner.** opencode needs an awefork sidecar because
   its copy omits the parent link. Codex, pi, and ZCode also persist their native
   linkage; awefork still uses its sidecar for cross-backend presentation,
   detached exports, and empty-context forks. Never assume one global
   `lineage.json`.
4. **Events are normalized.** HTTP/SSE, JSON-RPC notifications, and RPC frames
   become the `AgentEvent` union in `types.ts`, including message parts, tool
   progress, compaction, interactions, branch continuation, and connection
   changes. The renderer never branches on raw backend payloads.
5. **Capabilities gate affordances.** `backendCapabilities()` is the single
   renderer-facing feature surface. Missing rename/delete/export/attachment/
   compression/file-change support must hide or disable the action rather than
   defer the error until click time.
6. **Lifecycle belongs to main.** opencode reuses compatible servers and walks
   configured, remembered, classic, and discovered ports. Codex, pi, and ZCode
   own separate child processes or pooled RPC children. Never kill a process
   awefork did not spawn.
7. **Overlay state is scoped.** New writes use
   `<userData>/<store>-<backend>.json`; legacy bare names remain opencode
   fallbacks. Settings are split between main's `settings.json` and the
   renderer's validated `awefork:settings` blob; shell geometry lives in the
   separate `awefork:layout` record.
8. **The renderer gets no Node access.** `contextIsolation` stays on and
   `nodeIntegration` stays off. The preload exposes typed IPC only; navigation
   away from the app and new windows are denied.
9. **Reply content is untrusted.** Markdown becomes a typed tree and Vue
   vnodes; raw reply HTML is never injected. External links pass a protocol
   allowlist in main, and math output uses KaTeX with `trust` disabled.
10. **File access is bounded.** Browser listings cap entries, previews cap
    bytes, and a dropped Finder item keeps its absolute path as text rather
    than inventing a path. File reads are read-only; saving branch Markdown is
    a separate, explicit native-dialog action.
11. **Known limitation:** the message list is flat. Sessions where the user
   reverted and re-asked inside the same session show every attempt in order;
   dead-branch filtering is future work.

### Adding an agent backend

Implement `AgentAdapter` in `src/shared/`, add its ID and capability row in
`src/shared/backend.ts`, extend the typed bridge in `src/shared/awefork-api.ts`,
and wire its lifecycle through the main-process backend registry. Add a fake
transport and focused adapter tests. The protocol doc-comments in `types.ts` are
the contract; do not fork the protocol per backend. If protocol facts drift
often, put the closed vocabulary in a descriptor and validate it at startup, as
opencode does.

### Renderer message updates

Update `messagesBySession` by session key and preserve arrays whose complete message state is unchanged. Reads are serialized by backend and session; completion and explicit reloads request a snapshot taken after any older read. Local sends and deletions invalidate older snapshots. Changed replies publish together at the next animation frame, with a timer fallback for hidden windows, and reads resolve after publication.

Canvas loading prioritizes the selected session and its ancestors, with at most four canvas reads active across workspaces. `loadingMessages` tracks the missing data needed to position that branch; `loadingCanvas` tracks the remaining batch. Old queued jobs stop after a selection, directory or backend switch. Background responses may populate their session caches, but cannot clear a newer batch's loading state. While sibling heights settle, requested focus follows its card; manual pan, zoom or fit ends that tracking.

## Testing

- Unit tests use real temp directories and real HTTP servers where the boundary
  matters. Codex and ZCode use fake JSON-RPC clients; pi uses fake JSONL/RPC
  seams. No module-level mocks for the storage layer.
- Adapter tests cover protocol translation and recovery, including exclusive
  fork cuts, prompt acknowledgement, dropped frames, compaction, attachments,
  and capability-specific failure paths.
- Renderer state regressions use a scripted preload bridge and fake timers. They
  cover message snapshots, optimistic sends, backend switches, canvas tabs,
  files, settings, and multi-model round settlement.
- `npm run verify` runs typecheck, lint, and Vitest. `npm run test:gui` builds
  the app and runs the real Electron interaction suite against the mock adapter.
  For repeatable production-renderer measurements and their limits, see
  [the many-branch performance report](performance/2026-10-22-many-branches.md).

## Release

Versioning from `package.json`. `docs/CHANGELOG.md` gets a `## vX.Y.Z` section per release. Tag `v*` triggers `.github/workflows/release.yml` (tests → changelog extraction → GitHub Release).

Installers are built locally with `npm run dist` (mac) / `npm run dist:win` (Windows) into `dist/`. Before each build, `scripts/archive-dist.mjs` moves installers of older versions into `dist/archive/<version>/`, so `dist/` root only ever holds the current build.
