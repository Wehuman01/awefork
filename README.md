<div align="center">
  <img src="assets/icon/icon.png" alt="awefork icon" width="128" />
  <h1>awefork: Non-linear Session Workbench</h1>
  <p><strong>Fork any turn. Keep every branch.</strong></p>
  <p>A desktop workbench that turns AI coding-agent sessions into a tree: pick any past turn, branch from it, and keep exploring in parallel.</p>
  <p>
    <strong>English</strong> ·
    <a href="./README_cn.md">简体中文</a> ·
    <a href="https://www.wehuman.top/">Wehuman</a>
  </p>
  <p>
    <a href="https://ko-fi.com/mugpeng"><img src="https://img.shields.io/badge/Ko--fi-Buy%20me%20a%20coffee-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/version-0.4.5-7C3AED?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%E2%89%A522-0EA5E9?style=flat-square" alt="Node">
    <img src="https://img.shields.io/badge/license-MPL--2.0-22C55E?style=flat-square" alt="License">
  </p>
  <p>
    <img src="https://img.shields.io/badge/status-alpha-c96a3d?style=flat-square" alt="Status">
    <img src="https://img.shields.io/badge/install-download_dmg-22C55E?style=flat-square" alt="Download dmg from Releases">
    <img src="https://img.shields.io/badge/platform-desktop-334155?style=flat-square" alt="Platform">
    <img src="https://img.shields.io/github/stars/wehuman01/awefork?style=flat-square" alt="GitHub stars">
  </p>
</div>

<p align="center">
  <img src="assets/images/app-overview.png" alt="awefork app window: a canvas of branching sessions" width="860" />
</p>

> Fork any turn. Keep every branch.

awefork is a non-linear workbench for local coding agents, currently supporting [opencode](https://opencode.ai), Codex, [pi](https://github.com/badlogic/pi-mono), and ZCode. It is built around one move: **node-level forking** — pick any user message in a session, branch a new session from that exact turn, and continue in a fresh context while the original stays untouched.

It is intentionally scoped: project your real agent sessions, fork and continue through each agent's native API, and keep backend-specific data out of the renderer. No session-format rewrite and no lock-in — every session it creates stays native to the selected agent.

The idea of treating sessions as a branching graph originates from [PiX](https://github.com/huang-sh/PiX), which first explored this non-linear interaction model for AI agent workbenches. awefork adapts it to several agent backends through one normalized adapter surface.

## How It Works

```text
┌──────────────┬──────────────────────────────────┐
│ Sessions     │  the selected turn's exchange    │
│ (tree with   │                                  │
│  forks ⎇,    │  ▸ click any card or session —   │
│  foldable    │    the pane jumps to that turn   │
│  folders)    │                                  │
│ /repo        │  chat input to continue          │
│  · session A │  this branch                     │
│    · ⎇ A-1   │                                  │
└──────────────┴──────────────────────────────────┘
```

- **Navigator** — sessions from the selected agent grouped by project directory (folders fold); forks nest under their parent, and any branch's subtree folds from the caret on its row (folds suspend while searching). Star a session to bookmark it — stars gather in the ★ favorites shelf at the sidebar's top, across projects, and never touch the canvas (it draws the selected story only). Right-click a row to rename or archive it; right-click a directory to archive the whole project. Archived items hide from every view (search, palette, canvas included) and restore from the archive section at the sidebar's bottom — sessions created under an archived directory stay hidden until the directory comes back.
- **Enhanced search** — the ✦ button next to the search box opens scope checkboxes (title / tags / body), a project picker (default: all projects, or scope to one), and a search cap (default 1000; choose 100 / 300 / 500 / 1000 / all). The same powers live in the box as syntax: `body:word` scans conversation bodies case-insensitively (results stream in with highlighted snippets; click one to land on that turn on the canvas), `#tag`, `title:`, `dir:`, `is:starred` / `is:fork` / `is:running`, `"exact phrase"`, and `-word` to exclude. Full-width colons and a space after a prefix work too.
- **Turn pane** — the right panel shows one turn: its prompt and reply, with run duration and output tokens in the header. Click a canvas card or a sidebar session and the pane jumps there; while a new turn runs, it follows along. Walk turns with ‹ › or ←/→.
- **Fork here** — any user turn can seed a new branch. The new session keeps that full turn (question + answer), and awefork lands you in it.
- **Model choice** — a searchable picker (70+ models is fine) when starting a branch, plus a per-session picker beside the composer. ★ pins models into a Favorites group and recent picks feed Recent, both at the picker's top.
- **Thinking effort** — pick the run's reasoning variant (minimal/low/medium/high…) next to the model; canvas cards show `model · variant` for what each turn actually used.
- **Approvals and forms** — Codex approvals and opencode permission/form requests appear at the end of the relevant session's conversation, with an auto-deny setting and no default-allow fallback. Asks for background sessions wait on their own pane.
- **Files and folders in the composer** — paste or drop files into either composer (capability-gated per backend/model); images, text, and Word/RTF documents become bounded attachments, while a folder becomes its absolute path as editable draft text. Sent rows carry attachment chips.
- **Retry failed turns** — the ↻ on a failed turn (card or pane header) reopens its prompt prefilled with the original text and model; edit and resend — mid-story turns retry as a fresh fork, the failed original stays untouched.
- **File changes per turn** — as edit/write tool events stream in, awefork snapshots the touched files on the spot; the turn carries a file card with status, +/− line counts, the saved diff (unchanged by later edits), and an open-file action. Turns that ran outside awefork — forked or offline — say "not recorded" instead of guessing. opencode only.
- **Continue** — send messages from awefork; replies stream in live. Replying while an older turn is selected branches from that turn.
- **Canvas** — selecting a turn highlights its full path from the root and dims the rest; fit view, and an always-on minimap with a live viewport rectangle.
- **Compare and export** — compare a fork with its parent or two independent sessions, or export the selected branch as Markdown with model, duration, and token metadata. Right-click a session to reopen it in the agent's terminal.
- **Key turn marks** — star any turn with ★ (card chip, pane header, or the turn's right-click menu). Marked turns get a rose ring on the canvas, a rose dot on the minimap, and a Key turns panel listing them for one-click jump. Pure overlay (`marks.json`), never touches agent storage.
- **Command palette** — ⌘K / Ctrl+K to jump between sessions and fire actions; drag the column handles to resize, double-click to fold.
- **Native sessions** — forking calls the selected agent's native fork primitive; the result is a real session you can reopen in that agent's own tools.
- **Multiple agents** — switch agents in place, or enable separate windows and keep one window per agent. Background runs and their event streams continue while you view another backend.
- **Settings and Labs** — ⌘, / Ctrl+, opens settings for appearance, language, agents, models, canvas, files, search, shortcuts, storage, updates, and Labs. Labs currently gates the read-only file browser and multi-model rounds, both off by default.
- **File browser** — with the Labs switch on, browse local files from the middle column or sidebar, preview Markdown, source, images, CSV/TSV, and the first pages of PDFs, then quote a file into the canvas draft. Reads are local, read-only, bounded, and ignore configured names.
- **Multi-model rounds** — with the Labs switch on, send one prompt to up to four models, each running on its own fork, read the answers side by side, and optionally add a summary branch over the completed answers.
- **Story tabs** — open independent fork trees in browser-style tabs; tabs wrap instead of disappearing, keep their own canvas viewport, and can be opened from the sidebar or command palette.

## Install

**Download** — grab `awefork-<version>-arm64.dmg` (macOS, Apple Silicon) from the [latest release](https://github.com/wehuman01/awefork/releases/latest) and drag it into Applications. The build is unsigned: on first launch, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

**Windows** — build it from source with `npm run dist:win` (NSIS installer). The selected agent CLI must be on PATH; npm-style installs (`.cmd` shims) are picked up automatically.

**From source** — requires Node.js ≥ 22 and at least one supported agent CLI on PATH: `opencode`, `codex`, `pi`, or ZCode. The in-app agent picker reports missing CLIs and can install opencode, Codex, and pi.

```bash
git clone https://github.com/wehuman01/awefork.git
cd awefork
npm install
```

opencode reuses a compatible running server or starts one lazily. Codex, pi, and ZCode use their own app-server or RPC lifecycles; selecting an installed agent materializes it only when needed.

## Quick Start (from source)

```bash
npm run dev
```

1. Pick an installed agent in the top bar.
2. Pick a session from the left tree.
3. Find the turn you want to branch from → click **⎇ fork here**.
4. The new branch opens; type in the input to continue it.
5. Original session untouched — switch back anytime.

## Config

The app stores its own state under Electron's `userData` directory; it never rewrites an agent's session store.

| Fact | Value |
|---|---|
| app selection and server facts | `<userData>/settings.json` (selected backend, last opencode port, quit behavior, onboarding) |
| renderer preferences | `awefork:settings` and `awefork:layout` in renderer storage (theme, language, layout, files, Labs) |
| per-backend overlays | `<userData>/*-<backend>.json` (lineage, pins, marks, tags, trash, archive, composer, directories) |
| file-change snapshots | `<userData>/file-changes/<backend>/<sessionId>/` |

The sidecars hold only facts awefork adds around native sessions. Legacy unsuffixed opencode stores remain readable, and new backends use suffixed files. Deleting an overlay can lose its tree linkage, marks, or UI state; it does not delete the agent's session. opencode is probed across its recorded port, `AWEFORK_OPENCODE_PORT`, classic candidates, and a registered v2 background service rather than assuming port 4096 is always available.

## Compatibility

opencode's drift-prone protocol facts live in `src/shared/agents/opencode.json` (the 1.18–1.19 API) and `src/shared/agents/opencode-v2.json` (the v2 `/api` server): endpoints, SSE event names, field paths, fork-cut translation, capability flags, and tested version ranges. The adapter interprets those closed-vocabulary descriptors, and the validator rejects unknown keys at every level. Codex, pi, and ZCode keep their backend-specific lifecycle and protocol mapping in adapters and main-process facades.

| Backend | Native protocol | Rename | Delete session | Branch export | Notes |
|---|---|---:|---:|---:|---|
| opencode 1.18–1.19 | HTTP + SSE | yes | yes | yes | descriptor-driven v1 protocol |
| opencode 2.0–2.1 | authenticated `/api` + events | yes | yes | yes | single-message delete is unavailable |
| Codex | `codex app-server` JSON-RPC | yes | yes | no | aweswitch account homes are merged |
| pi | JSONL sessions + RPC | yes | no | no | `npm install -g @earendil-works/pi-coding-agent` |
| ZCode | app-server / v4 commands | yes | yes (soft) | no | macOS app discovery or `AWEFORK_ZCODE_CLI` |

All four backends support forks, continuation, streaming replies, and session compaction. Image, text, and document attachments are capability-gated; per-turn file-change snapshots remain opencode-only. opencode versions outside `≥1.18.0, <1.19.0` and `≥2.0.0, <2.2.0` show a warning in the switcher.

## Multi-Agent Roadmap

The core is the `AgentAdapter` protocol (`src/shared/types.ts`): session listing, messages, models, create, fork/export, delete, rename, prompt/abort, compaction, interactions, and normalized event subscription. opencode, Codex, pi, and ZCode are implemented. A main-process backend registry owns lazy lifecycle and capability routing. Planned next: Claude Code (JSONL with `parentUuid` + `--resume`).

## Support

If awefork helps you, consider supporting its development:

- ⭐ Star the repo — it helps others find it.
- ☕ [Ko-fi](https://ko-fi.com/mugpeng) — buy me a coffee.
- 💬 WeChat — scan the QR code below.

<p align="center">
  <img src="assets/images/wechat-pay.jpg" alt="WeChat Pay" width="240">
</p>

> awefork is free and open source. Sponsors keep it maintained — thank you.

## Development

```bash
npm run typecheck   # tsc + vue-tsc
npm run lint        # biome
npm test            # vitest (fake HTTP/stdio/RPC agents; no real agent needed)
npm run test:gui    # real Electron + mock adapter interaction checks
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for architecture and design constraints.

- [Contributing](./docs/CONTRIBUTING.md)
- [Changelog](./docs/CHANGELOG.md)

## Awesome Ecosystem

awefork is part of a growing family of "awesome" tools — CLI-first, local-first, and operable by AI agents.

### CLI Tools

- **[aweskill](https://aweskill.wehuman.top/)** — CLI-first skill package manager supporting 47+ AI coding agents.
- **[aweswitch](https://github.com/wehuman01/aweswitch)** — Agent profile switcher for Claude Code, Codex, and OpenCode.
- **[awerouter](https://github.com/wehuman01/awerouter)** — Smart router that splits requests between Flash and Pro models using structural signals, cutting unnecessary model spend.
- **[aweshelf](https://github.com/wehuman01/aweshelf)** — Bookmark, categorize, and restore AI coding sessions; pairs with aweswitch to save profiles and launch with one command.
- **[aweshare](https://github.com/wehuman01/aweshare)** — Share local Ollama/vLLM backends, domestic coding plans, or authorized OpenAI/Anthropic subscriptions through a self-hosted hub — a sharing economy for tokens.
- **[awewarm](https://github.com/wehuman01/awewarm)** — Subscription window warmer that keeps AI coding-plan windows active, for local setups and through a remote hub server.
- **[awescholar](https://github.com/wehuman01/awescholar)** — AI-agent-operable scientific literature discovery and curation.
- **[awecontrib](https://github.com/wehuman01/awecontrib)** — One verify entry per repo: writes a small `verify` file and a minimal CI, so local and CI run the exact same checks.

### Desktop Apps

- **[awefork](https://github.com/wehuman01/awefork)** — this project. Turns AI coding-agent sessions into a tree: fork any turn, keep every branch. Pairs with aweswitch — launch a session with a profile, then explore and fork its history here.
- **[awedot](https://awedot.wehuman.top/)** — A floating orb at your screen edge keeps track of the current AI session: bookmark it in one click, resume anytime, and pair with aweswitch to pin the agent's config (e.g., relaunch with the GLM model).

### Project Collections

- **[Awesome AI Meets Biology](https://github.com/Webioinfo01/Awesome-AI-Meets-Biology)** — A curated survey of AI applications in biology, bioinformatics, and biomedical research. Powered by awescholar.
- **[Awesome AI Virtual Tumor](https://github.com/Webioinfo01/Awesome-AI-Virtual-Tumor)** — A curated collection of state-of-the-art AI systems for virtual tumor modeling and simulation: static models, dynamic models, agents, benchmarks, and reviews.
- **[AgentX](https://github.com/Webioinfo01/agentx-hub)** — A community directory of scientific research AI agents: verified-run reviews, live GitHub metrics, and monthly reports, curated through awescholar's validated pipeline.
