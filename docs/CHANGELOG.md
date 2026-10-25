# Changelog

## Unreleased

- **Subagent task cards surface delegated runs** — opencode v1/v2 Task-tool calls now render as live cards with agent, title, elapsed time, dispatch prompt, result/error, and model. Completed cards can open a read-only child-session drawer without changing the selected branch; ordinary tool calls keep the grouped summary chip, and a task-only assistant row no longer disappears when it has no reply text.

## v0.4.6

- **A turn's tool calls fold into one grouped chip** — a settled turn no longer stacks a wall of near-identical pills: the chips collapse into a single grouped count following opencode's TUI ("shell ×8 · read · edit"), codex's command previews group on the family before " · ", a lone call keeps its full label (that command preview is the whole point of a single chip), the full list rides in the chip's title attribute, and an overlong line cuts at a group boundary so the ellipsis never lands mid tool name. Canvas cards drop their per-turn tool chips — the pane already tells that story.
- **The installer lands the latest CLI and says why an install failed** — pi moved npm scopes: `@mariozechner/pi-coding-agent` froze at 0.73.1, so installs now target `@earendil-works/pi-coding-agent` (1.x) and uninstall the legacy global package first, because it still owns the `pi` bin symlink. An install cut short (the 5-minute timeout, a killed app) leaves npm's retire dir behind and every retry then dies ENOTEMPTY on the same deterministic name — it is cleared and retried once. npm's failure codes map to the action that fixes them (write access, missing npm, unreachable registry) instead of the raw wall of text, and the install button counts elapsed seconds, so minutes of silent npm no longer read as a frozen app. `probePi` returns the version the `--version` probe already produced, pi rows older than 0.55.3 (the verified RPC surface) warn instead of failing at the first run, backend rows re-probe when settings open and the window refocuses (throttled to one probe per 30s), and one shared `AGENT_PACKAGES` table replaces the install command duplicated across the installer, the registry hints, and CLI messages.

### Install

Installer attached: `awefork-0.4.6-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). This release ships macOS only.

## v0.4.5

- **Composer drops now separate folders from files** — a drop or paste batch turns directories into absolute paths inserted as editable draft text, one per line, while files keep the attachment route. Folder paths work even on a backend that accepts no attachments, mixed batches preserve order, the drop highlight appears wherever a drop will land something, and edits remain on the native undo stack.
- **A locked Codex thread continues in a visible fork** — when Codex's app-server reports that another writer owns the thread, the prompt now continues on a full-history fork. The optimistic prompt survives, the run and watchdog move to the fork, and the pane follows it instead of settling the original as failed and stranding the reply on a hidden branch. The fork is registered with the session list the moment it is cut, because `thread/list` omits a branch carrying only copied prefix turns — without that the pane could not select the branch the run moved to. The continuation notice rides its own toast, since the send that produced it resolves successfully and clears the error banner on the way out.
- **Codex snapshots no longer make a sent prompt disappear** — while a run is active, a lagging thread snapshot keeps unsent local rows pinned at the tip until the server carries the same text, and sending the same prompt twice now keeps the second row too: matching is per server copy, not per text. A briefly missing selected thread has an eight-second grace window, and the pane keeps showing the session's last known summary throughout, so a refresh no longer unmounts the composer and discards the draft.
- **Many story tabs wrap instead of hiding** — open fork-tree tabs stack into rows rather than sliding under the context panel through a hidden horizontal scroll.
- **File tabs and previews keep their state coherent** — reading mode survives arrow-key file changes and ends with the preview it belongs to; dock and context-menu jumps land on the file's real directory; PDF paging stops at the pages actually rendered; quick search honors the ignore list; failed previews keep the listing visible; CSV row counts exclude the header; and the image-size badge resets between files.

### Install

Installer attached: `awefork-0.4.5-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). This release ships macOS only.

## v0.4.3

- **Multi-model rounds get a picker dialog, a canvas entry, and Labs defaults** — the composer's inline flat model list is replaced by a dialog that groups models the same way the single-model picker does (favorites/recent/all), the round seeds from the settings' defaults (falling back to the current model), and the summary length gains "none": a round without a summary lands as "skipped" and the results panel offers one on demand. With the multi-model Labs switch on, the labs section grows a "default models & summary" row that writes the same dialog's choices straight into the settings blob, and the files section grows a text row for the ignore list. The canvas draft card's foot gains a ⇄ switch too, so a round can fork from the draft's own session and turn — including its ✂ empty-context mode — and a successful send spends the draft exactly like a single-model send.
- **A fork no longer redraws its ancestor's story** — the canvas matched inherited turns by message id, but opencode v2 and zcode re-key every row they copy, so each branch drew the whole inherited history as its own turns: four parallel answers to one question produced four copies of the question. The check now falls back to each copied row's creation time plus its prompt text, which a copy keeps, so inherited turns stay on the ancestor's cards.
- **A round can no longer hang on a target that never reports back** — `collectParallelTarget` and the summary wait looped on the session's running flag with no deadline, so a backend that dropped its idle frame froze the round's summary forever. Both now give up after ten minutes, say why, and let the round summarize the answers that did arrive. A failed re-summary keeps the last good text and provenance instead of blanking it, and retrying a target claims it before the first await so two quick clicks cannot both pass the busy check.
- **Rounds read the same on canvas and pane** — source forks carry a `⇄ Round N · i/total` badge that opens the round's reading view, any summary version's card shows that version's text and provenance read-only (not always the newest), and the composer remembers the summary setup and lineup as the next round's defaults, numbers the selected models in send order, and states why a send is disabled.
- **codex shows what it is doing while a turn runs** — tool items (commandExecution / fileChange / mcpToolCall / …) stream as live tool chips in the pane while the turn runs, so the reader sees the work before the idle reload lands the settled tool rows; a thread codex compacted on its own now announces itself with the 🗜 toast and a reload instead of a silent refresh.
- **"Never auto-deny" really means never** — with the auto-deny countdown set to "never", the renderer armed no timer but the main process's fixed 60s backstop still declined the ask silently. The backstop now re-arms while any renderer window is alive — the window owns the ask for as long as the user needs — and declines only once no window can show it.
- **An empty-context fork tags its origin card, not the edge** — the ✂ badge floating in the severed edge's gap could land over other lines as the graph moved; the fork's first card now carries a "未继承上文 / No inherited history" tag, and the edge keeps only a small gap near the child card as the cut cue.

### Install

Installer attached: `awefork-0.4.3-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). This release ships macOS only.

## v0.4.2

- **Parallel prompt groups, behind a Labs toggle** — a new Labs switch (off by default) unlocks the composer's parallel mode: stage one prompt, pick several targets (native sessions or models), send it to all of them at once, and read the answers side by side in a results panel. A group is a reading group — it references native sessions and never changes their history; each target's reply is matched to the exact request by its baseline message ids and the prompt text, so only the latest step of that request counts, never a completed intermediate tool step. Targets report preparing / running / done / failed, and a group can optionally run a summary session over the collected answers (brief or standard, on a chosen model).
- **Sending into a busy group says so instead of silently doing nothing** — a prompt aimed at a group whose targets or summary are still running surfaces a busy-group message rather than a no-op send.
- **A fork no longer redraws its ancestor's story** — opencode v2 and zcode mint fresh message ids for the rows they copy, so the canvas's shared-prefix check (which matched ids) found no prefix and every branch drew the whole inherited history as its own turns. Four parallel answers to one question therefore produced four copies of the question. The check now falls back to each copied row's creation time plus its prompt text, which a copy does preserve, so the inherited turns stay on the ancestor's cards. A fork's own first turn is still kept even when the clock is coarse, because the prompt text has to agree too.
- **A round can no longer hang on a target that never reports back** — `collectParallelTarget` and the summary wait looped on the session's running flag with no deadline, so a backend that dropped its idle frame froze the round's summary forever. Both now wait at most ten minutes, mark the target unknown with a reason, and leave the round free to summarize the answers that did arrive.
- **A failed re-summary keeps the last good summary** — the summary text and its source ids were overwritten as soon as the summary fork existed, so a failed attempt blanked a summary that had already worked and also convinced the round it had nothing to retry. Both are now restored on failure, and the round's "needs a fresh summary" test still sees the real provenance.
- **Retrying a target cannot start two runs** — the busy check read a status that only flips after the retry's own awaits, so two quick clicks could both pass it. The target is now claimed before the first await.
- **The canvas and the pane read a round the same way** — source forks carry a `⇄ Round N · i/total` badge that opens the round's reading view, and selecting any summary version's card shows that version's text and provenance instead of always the newest one (older versions render read-only, from their own session's rows).
- **Multi-model input remembers its setup** — the summary model and length, and the lineup a round was sent with, persist as the defaults for the next round; a disabled send says why in the layout instead of only in a tooltip; and the model picker numbers the selected models in send order, which is the order the reading view uses.
- **Mid-story compression lands in a fresh fork** — compressing a session that already has branches no longer rewrites the branch the canvas is showing: the compression runs on a fresh fork that carries the whole story, the original branch keeps its history untouched, the fork is recorded in the lineage so the canvas nests it, and the toast names it. A double-compress is guarded through the fork await itself.
- **codex image attachments actually arrive** — codex's turn input takes a filesystem path, not a payload, so staged images are now written to a fresh temp dir (named after the attachment, deduped, extension guaranteed) and sent as `localImage` turn input, aligned with how opencode sends attachments; the staging dir is removed when the turn that read the files ends, or on prompt failure, and the rollout's echoed basename is what the session history shows as the attachment name.
- **codex turns are attributed the model they actually ran on** — `thread/read` carries only the session's current model settings, so a mid-session model switch relabeled every earlier turn. Each home's rollout files are parsed for per-turn `turn_context` and those take precedence, falling back to thread settings when a turn has none.
- **The prompt-text inlining of non-image attachments moved to a shared module** (pi's inline-files helper now lives in `inline-attachments.ts`), and the i18n dictionaries cover all the new panels in both languages.

### Install

Installer attached: `awefork-0.4.2-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). This release ships macOS only.

## v0.4.1

- **A settings page, and the top bar it emptied** — ⌘, (Ctrl+, off macOS) or the new ⚙ button opens a floating panel over the workbench: grouped navigation, a search box that filters sections and rows, and eleven sections covering appearance, language, agents, models, canvas, files, search, shortcuts, storage, updates and labs. Rows are built as data, so every control writes the preference directly and a deep watcher persists it — there is no save button and no path where a control changes a value and forgets to store it. Each section names where it lives (this machine, the app's settings file, or per backend), a section can be reset on its own, Esc or a click on the dimmed backdrop returns to the workbench, and the panel layers above the interaction backdrop. The top bar's multi-window toggle, ⌘K palette button and quit keep-alive toggle are gone from the bar — they are rows in here now, and keep-alive no longer asks for the in-flight count when turned on, because quitting with runs going still asks at the quit gate.
- **One settings document instead of a key per preference** — the renderer's preferences moved into a single JSON blob (`awefork:settings`), read once at boot and written whole on every change. Every field is validated on its own, so one corrupt key costs only that key and the rest of the file still applies; a blob that is missing or unparseable falls back to defaults instead of blocking boot. The three keys the app used to write (theme, locale, multi-window) are folded in once on upgrade and then removed, and an existing blob is authoritative so a stale legacy key cannot override a newer choice.
- **Theme gains "system", and the top-bar button cycles it** — the preference is now light / dark / system, with system following the OS and repainting when it flips without touching the stored choice. The one-click button walks light → dark → system and shows a half-filled ◐ while following the OS, so a click never looks like it will do nothing; native scrollbars and form controls follow the painted appearance too.
- **Density, motion and the canvas dot grid are preferences** — compact vs comfortable rows, transitions on or off, and the dotted backdrop behind the branch canvas. All three are stamped as `html[data-*]` attributes before the first frame, so a compact user never sees one comfortable frame first, and the CSS does the work — a change costs one attribute write and no component re-render.
- **The rest of the workbench is configurable** — sessions open in a fresh tab by default (created ones and ones picked from the lists), multi-window is on by default, the middle column can boot on the canvas or the files view, fit-view-on-open and the minimap can be turned off, the auto-deny countdown for pending decisions is 15/30/60 seconds or never, turn deletes can skip their confirmation, and "reset layout" restores both panel widths and the file dock without touching any other preference.
- **File and search preferences, wired to the live surfaces** — hidden files, list or grid, text preview cap (128/256/512 KB), image cap (2/4/8 MB) and whether a double-clicked file opens in the system app or the in-app preview; search scopes and the result cap. The file toolbar's view and hidden-file toggles and the sidebar's ✦ search knobs double as these defaults and mirror settings changes both ways, so the two never disagree within a session.
- **Labs gates the file browsing experiment** — a Labs section with one switch, off by default. Turning it off hides the files tabs in the middle column and the sidebar, folds any open files view back to its session counterpart, and makes the dock/tree jump-ins no-ops; turning it back on keeps every preference the experiment had.
- **Storage and updates in one place** — open the app data folder in the OS file manager (a new IPC channel, because `~` names the wrong folder), see what the sidecars hold, the archive and trash counts, export the settings blob as JSON, and reset every preference behind a confirmation. The version row, the check-on-launch toggle (which now really gates the startup check), a manual check and links to the release notes, the project and the issue tracker sit beside them, plus a shortcut reference listing ⌘,, Esc, ⌘K, ⌘F, ⇧⌘H and undo/redo.
- **＋ in the tab strip starts a session, not an empty tab** — the button was the one way to get a blank tab; it now runs the same `createSession` path the sidebar's per-directory entry uses, so it opens a real session in the open project.
- **Jumping to a session no longer parks the outgoing tab on the wrong story** — the command palette used to switch directory and then select, which let the directory switch adopt that directory's latest session into the tab being left behind. Palette jumps, sidebar rows and favorites all go through one `openSession` helper that retargets the directory itself and then lands the session per the new-tab setting.
- **A tab whose story vanished stays blank instead of adopting someone else's** — the refresh refill now picks the latest session whose story root no other open tab already shows (two tabs on one story is exactly what tabs exist to prevent), and the "this tab's story just died" flag is cleared on tab switches, blank-tab opens, workspace restores and backend resets so a later refresh cannot inherit a stale verdict.
- **File previews honor the configured caps, and symlinks resolve** — the image cap the renderer sends can only lower main's ceiling, never raise it (the data URL holds the bytes twice); preview reads `stat` instead of `lstat`, so a symlinked file previews and a symlink to a directory answers "not a directory" instead of failing the open. An image that exists but is too large reports that, rather than falling through to the text reader and coming back "binary"; a failed listing clears the old selection and preview instead of describing entries that are no longer on screen; and a tree load that loses the race to a newer load of the same directory drops its result.
- **codex's encrypted reasoning renders as a one-liner** — codex sends chain-of-thought encrypted (an `encrypted_content` field and an empty summary), so every reasoning part it emits was an expandable box that opened onto nothing. Such a part now shows a quiet line with its spinner and duration, which is the real progress signal, and keeps the box for reasoning a reader can actually read.
- **Small fixes** — a file dropped on the tab strip can no longer navigate the renderer away (the drop is prevented now that the strip declares itself a drop target); the file context menu removes its window-blur listener on unmount; and the file menu and its info popover sit above the interaction backdrop.

### Install

This release ships notes only — no installers attached. Build locally with `npm run dist` (macOS dmg) or `npm run dist:win` (Windows exe).

## v0.4.0

- **A file browser joins the app** — a read-only local file surface behind a single IPC channel feeds a middle-column file view (breadcrumbs, path input, back/forward/up, a current-directory filter, list and grid layouts, quick open scoped to the project) plus a sidebar file tab with the common locations and a lazily expanded project tree. Files preview as markdown, rendered code with line numbers, or images — with zoom on the image preview — while binary, oversized, unreadable and deleted files each get their own honest state, and a preview response that lost the race to a newer selection is dropped. The context menu copies absolute and project-relative paths and names, reveals, previews, inserts into the canvas draft, shows in the file manager and gets info; the relative base is the target session's directory or the selected project, never the browsing directory, and browsing a folder does not switch the working project. A collapsible file dock under the sidebar's session list roots the same tree at the selected session's directory, with the fold state persisted in the layout.
- **Drop files into drafts as plain path text** — files dropped on the canvas land in the draft as one path per line; consecutive drops stack one line each instead of overwriting, and the drop path is gated against the real Electron drag surface (the browser demo carries its own honest fallback).
- **Browser-style story tabs over the canvas** — one tab per fork-tree story, deduped on the story root. The active tab's selection stays the renderer's own selectedId — tab records are snapshots swapped on activate — so every existing reader keeps working; the canvas camera parks per tab and replays on switch, so a parked viewport survives the round trip. Sidebar rows gain a middle-click and a context-menu entry to open a story in a new tab, closing the last tab leaves one blank tab instead of a limbo, and a restore that finds its story gone blanks the tab instead of leaving it claiming a story the canvas isn't showing.
- **Quitting no longer kills running sessions in silence** — the backend registry tracks sessions with a run in flight (message started to session idle, or a session-scoped server error), and quitting asks first when any are going; the dialog's checkbox turns on the persisted keep-alive setting, also toggleable from the top bar. With keep-alive on, quit drops adapters and streams but leaves the spawned servers alive so terminal-side work continues; enabling it while runs are going asks too, naming the count it would cover.
- **Model picker no longer hides under the compress dialog** — the picker panel's z-index sat under the interaction backdrop, so the model swap inside the compress dialog opened behind it; the panel now layers above (95 over 90).

### Install

Installer attached: `awefork-0.4.0-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). This release ships macOS only.

## v0.3.9

- **Session compression now works on every agent** — the context meter's ⇲ button was opencode-only, because the other three adapters carried a comment saying they had no compaction primitive. Probing the protocols said otherwise, and the button now works everywhere: codex runs `thread/compact/start` (which compacts as an ordinary turn of its own — a `contextCompaction` item that streams in like any other run, then `turn/completed`), pi runs its `compact` RPC command (resolves only once the summary is written, so unlike opencode's detached summarize the adapter can await it before announcing) and zcode calls the dedicated `session/compact` method — not the `v4/command` envelope of the same name, which answers with `proto.sessionNotFound` because the legacy gateway does not own the session. zcode's compaction completion frame (`session_compacted`) is mapped onto `session.compressed`, so the reload and the toast behave like the others. pi's compaction entries are rendered too: the marker row plus the summary that follows it, the same shape opencode's summarize leaves behind.
- **codex finally shows its context percentage** — the meter read codex's usage from `thread/turns/list`, which carries none, and its model catalog has no context window at all, so the bar was permanently blank. The live `thread/tokenUsage/updated` notification carries both (`tokenUsage.last.totalTokens` and `modelContextWindow`), and the adapter now records it per turn and stamps it onto the row that produced it, so the footprint survives the reload that previously erased it. The window a backend reports alongside the usage now takes precedence over the catalog lookup, because it is the window the run was actually measured against — codex is the backend where the two can differ (its catalog field does not exist).
- **pi's image attachments are actually sent** — the attach button showed on pi (its capability table said images were supported) but `prompt` dropped the staged files on the floor, sending only the text. Staged images now go out as pi `ImageContent` blocks with the base64 payload from the data URL. Non-image attachments have no file part in pi's protocol, so they are inlined as named sections of the prompt text rather than silently vanishing.
- **Windows: the ZCode CLI is found and launched where it actually lives** — the desktop app's bundled `zcode.cjs` was located through a path resolver that treated a drive-letter path as relative, so the lookup landed on the working directory instead of the install folder and the provider catalog was never handed to the CLI (once the runtime cache expired, the CLI exited with "cannot locate the CLI ZCode Built-in Provider Config" and awefork reported only "zcode app-server exited right after launch"). The candidate roots now follow the real environment — `%ProgramFiles%`, `%ProgramFiles(x86)%` and `%LOCALAPPDATA%`, so a machine that installs ZCode on another drive is found too — instead of a hardcoded `C:`.
- **Windows: a missing CLI is named as one, for every backend** — the npm `.cmd` shims run under `cmd.exe`, which reports an absent command as exit code 9009 and never surfaces the child's own ENOENT, so a missing CLI was indistinguishable from a broken install (codex waited out its handshake timeout, pi and zcode reported a bare exit). All four backends now read that exit code and say the CLI is not on PATH, with the same ENOENT wording the POSIX path uses.
- **Windows: shortcut hints no longer name a key the keyboard does not have** — the hints that read "⌘Z" or "⌘↵" now follow the platform ("Ctrl+Z" / "Ctrl+↵" off macOS), and the dropdown carets use the same ▾/▸ glyphs as the rest of the app instead of the macOS-only ⌃/⌄.
- **zcode sessions can be renamed and deleted** — the adapter now carries `renameSession` and `deleteSession` over the `v4/command` channel, so the sidebar's rename and delete actions work on zcode sessions instead of being unsupported.
- **Branches without parent history are named in the renderer** — sessions whose lineage points at a parent the backend no longer has are marked as carrying no parent history, so the canvas and tree say what happened instead of silently treating them as ordinary roots.

### Install

This release ships notes only — no installers attached. Build locally with `npm run dist` (macOS dmg) or `npm run dist:win` (Windows exe).

## v0.3.8

- **Update prompts only for releases you can install** — a version whose release carries no installer for your platform (a notes-only tag, like v0.3.7, or a macOS-only release on Windows) no longer raises the update banner; the check now reads the release's asset list and requires the platform's own dmg/exe before reporting an update, so following the banner can never land on a 404 download.
- **English-only user-facing strings** — every error, toast, dialog title and prompt the app produces is now English: the Chinese leftovers in the main process, the backend adapters, the branch-markdown export and the renderer comments are gone, and the changelog is English. The i18n dictionaries keep their `zh` entries so the language toggle still switches the renderer to Chinese; the `中`/`EN` switcher labels, the search-grammar examples (`body:词` …) and the browser-demo fixture's sample conversation stay as they were.
- **codex: a thread whose writer is held elsewhere continues in a fork** — codex 0.163's managed app-server daemon keeps a thread's writer lock open long after its turn finished (verified on 0.163: the rollout's last write was minutes stale, yet the lock fd stayed open), so every prompt on such a thread died with "already has an active writer" and the advice to "close the other window" was one nobody could follow — there is no other window, only the daemon. `thread/fork` is not gated on that lock, so prompt now recovers there: the message runs on a full-history fork that carries the locked thread's history, the fork is recorded in the lineage so the canvas nests it, and the toast names the new branch. If the fork is refused too, the original conflict is reported as before.
- **codex: the first prompt on a fresh session no longer fails** — 0.163's `thread/resume` refuses a `thread/start` session that has no rollout yet ("no rollout found for thread id"; 0.154 said "is not materialized yet"), and prompt() resumed unconditionally, so every new session's first message errored. The resume is skipped for that state — `turn/start` materializes the rollout itself.
- **The composer sidecar no longer loses its favorites** — a backend switch cleared the workspace and then let a debounced persist run against the cleared state, overwriting the incoming backend's favorites, recents, last model and draft with empty values — the favorites group came back empty after every restart. Persists are now gated on which backend's composer state is actually loaded in memory, the sidecar read claims its backend before the IPC hop and drops a payload whose backend moved on mid-read, and a send that lands after a switch clears only the draft instead of deleting the whole sidecar.
- **Context usage display for opencode/zcode** — the context meter's live token footprint, previously codex-only, now reads the usage opencode and zcode report, capability-gated per adapter.
- **Backend switches ask first, and the context meter gains a compress shortcut** — picking a backend (e.g. codex) now confirms before switching, in both the in-place switch and the separate-windows mode with wording matching each; the context meter gains a ⇲ button that jumps straight into the existing session-compress flow where the backend supports it.
- **Compare columns flow independently** — the aligned mode bound left[i]/right[i] into one grid row, so opening one side's card left a wall of dead space under its folded neighbour; both compare modes now render two independently scrolling columns (the row pager went with the row grid), each column's fold state is its own (cell ids are namespaced by side, and a fold resets when its column changes, not only its card), the aligned mode drops the redundant column head whose "select" tore the lens down mid-comparison, and an optional lockstep toggle relays one column's scroll to the other by progress ratio.
- **The context meter no longer freezes on reload** — the reload-equality check compared messages but not `contextTokens`, so a reload whose only change was token usage kept the stale array and froze the pane's context meter at the old footprint; the field is compared now.

### Install

Installer attached: `awefork-0.3.8-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). This release ships macOS only; the Windows build returns next release.

## v0.3.7

- **New conversations land in the project you were working in** — the command palette's “＋” used to send an empty body with no `location` when no directory was selected, and the opencode server then created the session in its own cwd: the background service runs in `$HOME`, while a TUI started from a temp directory creates sessions in `/var/folders/…/T`. Auto-selection at startup then let the “globally latest session”’s directory win — often exactly the one that TUI produced in the temp directory — so every later new conversation inherited that junk directory, and “Open in terminal” dutifully `cd`’d into it. The open project directory is now persisted per backend in the composer sidecar: `bootBackend` reads it back before loading the session list, so auto-selection picks a session in the remembered project instead of the globally latest one; directory changes persist through the same debounced write as the draft, one per backend. `createSession`’s undo/redo also freezes the target directory at entry, so it can no longer create in a directory the user switched to afterwards.
- **Dark mode** — a dark theme joins the peach-soda light one: a full CSS-variable override driven by `html[data-theme]` covers the canvas, sidebar, right pane, dialogs, markdown and code blocks; it follows the system preference or manual switching, and the choice is remembered locally.
- **Large-canvas load performance** — canvas node layout and message batch loading were reworked into batched processing: sibling branches discovered in one refresh merge into the same batch load, and scroll/zoom layout calculation changed from per-node relayout to a one-shot measurement, so a million-session canvas first screen no longer waits card by card.
- **Every ask renders in its own session** — opencode’s permission and form asks no longer fight over one global modal: both kinds render inline at the tail of their own session’s conversation pane, an ask from a background session parks on that session’s pane and surfaces when selected; the modal keeps only what the pane cannot show (codex approvals, opencode asks with no correlatable session, compare mode or a hidden pane), and no ask ever vanishes.
- **opencode permission / form asks are answerable in-app** — a run hitting an `"ask"` rule in your permission config used to stall forever, because the server-side prompt had no one to answer it; `permission.asked` frames now travel the codex interaction channel, rendered inline at the tail of the conversation: the gated command, the matched rule patterns, and three replies — Deny / Allow once / Always allow (“always” is saved by opencode itself as a saved permission). `form.created`’s structured forms (login, MCP elicitation) are answerable too: text, select, number/integer range, boolean, multiselect and external link fields render per the field union the server sent, required fields validate first, “Other…” collects free text, Cancel cancels, Submit posts the answer map; an ask answered elsewhere (TUI) retires through `form.replied`/`form.cancelled`.
- **Forms still waiting after a restart reappear** — form asks still pending server-side when the app restarts resurface through the subscription, instead of leaving that turn stuck at “running” forever.
- **The running indicator color moved from mint to sky blue** — kept distinct from the dark theme and the error/success colors.
- **v2 tells a fork from a subagent** — v2 gives the two parent relationships their own fields, and the old mapping read them as one, so every fork was labeled origin “subagent” and deliberately hidden by the sidebar tree and canvas; forks made outside awefork (TUI, web UI) disappeared entirely. `parentSessionId` now reads only `parentID`, and a new `forkSessionId` reads `fork.sessionID`.
- **v2 exported copies stay visible roots** — export as a standalone session used to do nothing under v2: the fork succeeded, but v2’s fork endpoint stamps the parent onto the copy’s own row and the refresh mapped that row as a hidden subagent. awefork now records what only it knows — the copy is a detached export — and marked rows drop the server’s parent link everywhere the renderer looks.
- **codex: fresh threads start clean, dropped frames can’t hijack an abort, and the reply backstop waits its turn** — a new codex thread no longer pops an error because the rollout file doesn’t exist yet (read as empty); a dropped `turn/completed` frame’s stale turn id can no longer be interrupted by a later abort with codex’s raw RPC error; the JSON-RPC request backstop moved from 30 s to 60 s, strictly behind the renderer’s own 30 s auto-decline.
- **Story search closes after a jump** — picking a hit dismisses the panel instead of leaving it open over the canvas.

### Install

This release ships notes only — no installers attached. Build locally with `npm run dist` (macOS dmg) or `npm run dist:win` (Windows exe).

## v0.3.6

- **Bilingual UI completed** — the language toggle now covers the whole renderer, not just the interaction dialogs: every remaining hardcoded-Chinese surface (sidebar, chat input, model picker, command palette, compress/fork-tag/variant dialogs, message list and code blocks, canvas, compare views, history and marks panels, undo toasts, state errors and confirm prompts, relative-time text, attachment notices) is extracted into zh/en dictionaries (~460 keys across five per-surface `i18n-*.ts` modules merged into `i18n.ts`'s single `t()`), with list separators (`、` vs `, `) following the locale. Deliberately untouched: the language switcher labels, the literal search-grammar examples (`body:词` …), and the demo fixture's sample conversation content.
- **One window per agent** — the switcher's plain click stays as it was: one click still switches in place. A new "Separate windows" toggle joins the right side of the top bar (off by default, remembered locally); with it on, picking an agent in the switcher opens a full awefork window for it (titled `awefork — codex`), at most one per agent — picking the same agent again just focuses the existing window instead of stacking more, and turning the toggle off restores in-place switching. The persisted default backend is still rewritten only by the main window's switch. Backend events broadcast to every window, each window claims only its own agent's share, and permission/form asks still pop in the window they belong to.
- **opencode permission asks are answerable in-app** — a run hitting an "ask" rule in your opencode permission config (e.g. `"rm": "ask"`) used to stall forever, because the server-side prompt had no one to answer it through awefork. `permission.asked` frames now surface through the same interaction dialog codex uses, rendered inline at the tail of the conversation pane: the gated command (correlated from the in-flight tool part), the matched rule patterns, and three replies — Deny / Allow once / Always allow (`reject` / `once` / `always`; "always" is saved by opencode itself as a saved permission, so the button names the exact rule it unlocks). Esc denies, Enter allows once, ⇧Enter saves the rule; the 30 s auto-deny and the never-default-allow principle carry over, a finished run settles its asks, and an ask answered elsewhere (TUI, auto mode) is simply ignored. Wire facts live in the descriptor: the `permission.asked` frame — v2's real action/resources shape, not v1's keys — and `POST /session/{id}/permissions/{permissionId}` are data, so a renamed route stays a one-line fix.
- **opencode form asks are answerable in-app** — the typed sibling of a permission ask. opencode's `form.created` asks the user to fill structured input (an auth/login step, an MCP elicitation) before the run continues; awefork used to drop the frame, so the turn sat "running" with no sign anything was waiting. It now renders the form — inline in the conversation pane — built from the field union the server sent: text and select (`string`, with the server's own `value` submitted rather than the label), number/integer with range checks, a boolean checkbox, a multiselect with min/max, and `external` fields as display-only links. Required fields are validated before submit, an "Other…" pick on a `custom` select collects free text, and a field whose shape the vocabulary cannot express is dropped rather than guessed at. Cancel cancels (`DELETE .../form/{formID}`), Submit posts the answer map (`POST .../form/{formID}/reply`); a form answered elsewhere (TUI) retires the dialog through `form.replied`/`form.cancelled`, a settled run drops it, and a form with no real session (`sessionID: "global"`) stays in the modal. The three frames and both routes live in the descriptor as data.
- **Asks live in the conversation pane, not one global modal** — both opencode ask kinds render inline at the tail of their own session's on-screen pane; an ask for a background session parks on that session's pane and surfaces when you select it, so several sessions' confirmations never fight over one dialog. The modal keeps only what the pane cannot show: codex approvals, opencode asks with no correlatable session, and any ask whose pane cannot currently show the card (compare mode up, host hidden) falls back to it so nothing vanishes.
- **codex: fresh threads start clean, dropped frames can't hijack an abort, and the reply backstop waits its turn** — a brand-new codex thread fired an `awefork:messages` error toast on creation because its rollout file doesn't exist until the first user message (now read as empty); a dropped `turn/completed` frame left a stale turn id that a later abort interrupted with codex's raw RPC error (idle status frames clear it too); and the JSON-RPC request backstop moved from 30 s to 60 s, strictly behind the renderer's own 30 s auto-decline, so an "allow" clicked at the last instant is no longer silently swallowed by the transport.
- **Story search closes after a jump** — picking a hit dismisses the panel instead of leaving it open over the canvas.
- **v2 tells a fork from a subagent** — opencode v2 gives the two parent relationships their own fields and the v2 mapping read them as one, so every fork mapped to origin "subagent" and was hidden by the sidebar tree and canvas by design; forks made outside awefork (TUI, web UI) vanished — 18 of 1761 real sessions on the authoring machine. `parentSessionId` now reads `parentID` alone and a new `forkSessionId` reads `fork.sessionID`, so a fork is a fork again.
- **v2 exports stay visible roots** — exporting as a standalone session did nothing under v2: the fork succeeded, but v2's fork endpoint stamps the parent onto the copy's own row and the refresh mapped that row as a hidden subagent. awefork now records what only it knows — the copy is a detached export — and marked rows drop the server's parent link everywhere the renderer looks, so the copy is a plain root in every view.

### Install

Installers are attached: `awefork-0.3.6-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.3.6-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.3.5

- **opencode v2 support (1.18.x keeps working)** — awefork now drives opencode v2's `/api` server as well as the 1.18–1.19 API it was built on. The probed CLI version picks the protocol: v2 means Basic auth with the server's password, `{data}`-wrapped responses, cursor-paged lists, prompts whose model lives on the session (pinned before each send), forks that spell the cut `before`, compaction through `/compact`, interrupts through `/interrupt`, a flat model catalog, and the new streaming event family (`session.execution.*`, `session.text.*`, `session.reasoning.*`, `session.tool.*`) — a v2 run streams, settles and records file changes exactly like a v1 one. v2's server is adopted from the CLI's background service (its registered password) or spawned with one awefork pins; single-message delete is capability-hidden because v2 dropped the endpoint. An untested version still carries the ⚠ warning, now naming both tested ranges.
- **Compress a session into a summary (🗜)** — opencode conversations can be folded on demand through the backend's summarize primitive. Right-click a session (Compress…) or use the pane header's 🗜 button; the dialog preselects the branch's current model and lets you swap to a cheaper one before it starts. Non-destructive: history stays fully readable, later prompts just carry summary + the most recent turns. The compaction lands as a 🧹 Compress turn on the canvas and a divider banner in the pane, the summary streams in live like any run, and completion toasts. Capability-gated — codex/pi/zcode hide the affordance (their adapters reject with a named error).
- **A slow fork is a copy, not a dead server** — fork requests ride their own long deadline, and a copy that lands after the request deadline is adopted instead of reported as a failure, so a big branch never reads as a timeout while the server keeps working.
- **Compare fixes** — the shared composer keeps a failed side's error notice while the other side's run settles, and a folded card keeps its natural height instead of stretching to its open row-neighbour.

### Install

Installers are attached: `awefork-0.3.5-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.3.5-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.3.2 - 2026-09-18

- **Cross-platform backend compatibility** — Windows global npm installs now locate pi's SDK for session creation, forking, and renaming; terminal resume scripts preserve literal `%` and `!` in paths; and macOS discovers ZCode installed in `~/Applications` as well as `/Applications`.
- **Write to compared conversations together (⇄)** — both aligned branch comparison and free side-by-side now share one composer beneath the two timelines. A shared draft can target the left side, right side, or both (both selected by default), with independent model/effort picks and stop controls for each running session. Sends use explicit session targets, so comparison never redirects the selected pane; one side can fail without rolling back the other. Image attachments block the send with a named notice when any selected model cannot accept them.
- **Compare any two conversations (⇄ free side-by-side)** — a comparison no longer needs a shared fork. When the two sessions never meet (different stories, two roots attacking one task), the pane falls back to free side-by-side: two independent scrolling timelines of each session's own turns — Select jumps in, Latest jumps to the newest turn, copied original prefix turns carry an Inherited chip. Pairs may span every story in the directory: pick mode now completes on a sidebar row as well as a canvas card, and the session menu entry is Compare with another session…. One shared cell renderer serves both modes; the aligned branch-compare view is unchanged.
- **Branch comparison (⇄)** — the right pane gains a dual-column compare mode. Compare original puts a branch side by side with the one it forked from: the shared prefix collapses into an expandable band, the fork point is named on the divider, and every turn after it pairs up row by row — click a cell to read the whole turn, ‹ › pages the pairs, Esc leaves. Two more entries: right-click any canvas card for Compare with another session…, and a ⇄ chip on every branch-summary row. While comparing, the canvas tints the two paths lavender/mint, frames the fork point in dashed orange, and fades everything else; the context panel borrows a wider 680px and hands it back on exit.
- **Empty-context forks keep their turns on the canvas** — an empty-context fork that grew its own prompts used to have them swallowed by the shared-prefix fallback (they read as “inherited”); fork records now carry the context mode so the canvas renders every turn the branch actually owns.
- **Empty-context forks** — a mid-story fork draft gains a toggle: “Empty context” starts the branch as a brand-new session in the same directory (only the lineage sidecar remembers where it branched), while “With history” keeps the usual copy-up-to-that-turn. The choice rides the fork call through every backend and survives composer reloads.
- **Tag chips in search surfaces** — story search hits and command-palette entries show the session's tags (up to two plus an overflow count) in their own colors, so a tagged branch is recognizable before you commit to it.
- **pi and ZCode backends** — pi sessions resume through `pi --session <jsonl>` (install `@mariozechner/pi-coding-agent` globally); ZCode sessions resume through its bundled `zcode.cjs` (located automatically or via `AWEFORK_ZCODE_CLI`).
- **deleteSession capability** — backends without a session-delete primitive hide the delete entry instead of surfacing a runtime error.
- **backendCapabilities expansion** — the capability flags now cover pi and ZCode, so the renderer can gate affordances per backend.
- **ZCode machine messages stay machine messages** — harness-injected notes such as todo reminders carry a model-only marker in the ZCode store and are no longer rendered as user input.
- **ZCode forks keep the anchor turn's tail** — an injected message landing mid-turn no longer pulls the fork cut point early, so a branch copied at an earlier turn keeps everything the anchor turn actually produced.
- **ZCode runs settle after a crash** — when the app-server dies and respawns, event subscriptions are restored, so a running session can reach a final state instead of spinning “running” forever.
- **ZCode crash spawns one replacement, not many** — concurrent requests racing a crashed app-server no longer leak duplicate child processes.

## v0.3.4

This release carries everything since v0.3.2 — v0.3.3 was tagged but its release notes never published, so the ZCode alignment work below ships with notes for the first time here.

- **Collapsible fork branches in the sidebar** — fold any session's subtree from the ▸/▾ caret on its row. Folds live in memory only, are suspended while a search is active (the tree stays fully walkable and the caret goes inert), and a session revealed from the canvas, favorites, or rename unfolds only the branches above it — its own fold survives.
- **Richer compare cells, minimap fork tinting** — comparison cells render real markdown (links and code-copy buttons work; a click on plain space folds the card), each card's fold is its own so one column's expansion can never move the other's, and the minimap tints the selected session's nearest forked families.
- **Model quick access (Favorites / Recent)** — every model picker (pane composer, fork draft, compare sides) shows your high-frequency models first instead of making you search the catalog each time: ★ any row pins it into a Favorites group, hand-picks feed an automatic most-recent-first Recent group, and the full catalog stays below with search unchanged. Both lists persist per backend in the composer sidecar; keyboard navigation walks Default model → quick groups → catalog, and the highlight follows its model when starring reorders the rows.
- **Long runs survive the client's transport timeout** — a prompt whose run passed five minutes died client-side with a misleading "Cannot reach opencode server … (fetch failed)" toast while the server kept executing it. Deadline-less requests now ride an undici agent with the transport timers off, transport-timeout causes get their own message ("the server may still be processing it") instead of claiming the server is unreachable, and every reachability error names its underlying cause (ECONNREFUSED, …) instead of a bare "fetch failed".
- **One unreadable project no longer blanks the session list** — a worktree the backend cannot list (a macOS privacy denial under ~/Desktop makes the server answer 500) drops out of that refresh with a console warning instead of failing every listing.
- **Renaming keeps your caret** — the sidebar rename input no longer re-selects its whole text on every keystroke; the initial select-all is unchanged.
- **ZCode keeps pace with opencode** — the adapter matches opencode's model display, streaming, busy-state forks, and model catalog, speaks the 0.16.5 app-server protocol, runs the CLI under a plain node (not Electron-as-node), and passes `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` through to it.
- **Backend crashes name their cause** — codex, opencode, and zcode child processes capture stderr and the exit reason, so a dead backend reports what killed it instead of a bare failure.
- **Idle pi children go home** — a pooled `pi --mode rpc` child exits after two quiet minutes instead of living for the app's lifetime, and the timer only arms once a run settles, so a long run is never killed mid-flight. The pi summary index also re-reads just the session files that changed, and a plain refresh still picks up sessions an external pi CLI added or removed.
- **The window stays in the app** — `window.open` is denied and navigations away from the renderer are blocked; hash jumps and in-app history still work.
- **Updates don't orphan backends** — the macOS updater relaunch exits via `app.exit(0)`, which skips before-quit, so backend teardown now runs explicitly before the swap.
- **Line counts agree with the diff** — created/deleted file totals count lines with git's numstat rule (a single trailing newline opens no line), so the collapsed number equals what the expanded diff shows.
- **Terminal resume scripts clean up** — the scripts "open in terminal" writes delete themselves once the TUI exits instead of piling up in the temp dir.
- **Memory and internals** — opencode file-change recorders are released the moment a run settles; codex's memo of never-listed sessions expires after a day instead of haunting the sidebar forever; the SSE parser accepts CRLF frame boundaries; the canvas survives a hand-edited lineage that names a fork cycle; repeat message searches skip re-joining cached session text; the composer draft persists through a watch that no longer traverses the whole draft on every keystroke.

### Install

Installers are attached: `awefork-0.3.4-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.3.4-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.3.1

The canvas stops showing empty placeholders and starts offering a way out of awefork: a brand-new session stays off the graph until its first turn, a branch can be copied into a standalone native session any opencode client can continue, and screenshots no longer pile past 20/40 MB. Directory paths resolve once per listing so symlinked macOS spellings stop splitting projects — and the post-v0.3.0 port, archive, and settings races are closed.

### Highlights

- **Export a branch as a standalone session** — right-click a session or turn and copy it out as a plain root session with no awefork lineage, so the backend's own tools (opencode TUI, another machine) can keep working on it. Codex stays capability-gated off.
- **A clean canvas for empty roots** — a loaded session with no turns of its own draws nothing until the first prompt lands, instead of a stub card; fork stubs and loading placeholders still show.
- **Image attachment caps** — single images over 20 MB and batches over 40 MB are skipped with a note, so a folder drop cannot stampede long-lived message rows with huge base64 blobs.
- **One spelling per project** — session directories, archive keys, and hand-added sidebar directories canonicalize once per listing (macOS `/var` vs `/private/var`), so a project stays one group and archived paths stay archived.
- **Retry-as-fork attempt labels** — forks off the same turn that repeat the same first prompt are numbered as attempts of one family; deliberate parallel branches stay unlabeled.
- **Fresh sessions remember your last model** — a brand-new conversation with no turn of its own starts from the last model you hand-picked anywhere, not the agent default every time.
- **Mid-run outages settle** — when the backend stays unreachable for ~30 s, running sessions settle as failed instead of spinning “running” for the full watchdog cap.
- **Four races closed** — a cold opencode that has listen()ed but is not yet answering HTTP is adopted instead of spawning a duplicate on the next port; multi-port fallback kills the abandoned child instead of leaking it; pre-upgrade archive/dir symlink keys migrate on load so restore and remove work; `settings.json` patches serialize so a slow port write cannot drop a backend switch.

### Install

Installers are attached: `awefork-0.3.1-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.3.1-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.3.0

A session's important turns stop drowning in the scroll: star any conversation as a key turn and the mark follows it across the workbench — a rose ring on the card, a rose dot on the minimap, a jump panel that lists them all. Forks can now carry their parent's tags, a squatted port can no longer keep opencode from connecting, and the sidebar session menu learned pin/unpin.

### Highlights

- **Key turn marks** — star any turn with ★ (card chip, pane header, or the turn's right-click menu): the card wears a rose ring and glow, the minimap grows a rose dot, and a Key turns panel lists every mark in the graph for one-click jump. Marks are a pure overlay sidecar (`marks.json`) keyed by sessionId:messageId — agent storage is never touched.
- **Tags inherit on fork** — forking asks whether the new branch should carry the parent's tags, with a per-session "remember this choice" switch (changeable later in the tag menu); a tag-menu action can also paint tags onto a whole fork subtree in one write.
- **Pin/unpin in the session menu** — right-click a sidebar row for Pin / Unpin without hunting for the favorites shelf; the canvas right-click stays session-only.
- **Refresh beside search** — the reload control moved out of the directory header into the search row and shows a spinning state while the list refreshes.
- **opencode connects around a squatted port** — the hardcoded 4096 meant any other local tool holding it left awefork stuck at “opencode not connected”; discovery now walks the env override, the last-good port, classic candidates, and any local LISTEN port that answers like opencode, remembers the winner for the next boot, and reuses a manually started server on any port. Silent foreign listeners can no longer stall a cold boot either: reuse and readiness probes carry their own 2s deadline, candidates are probed concurrently, and a missing CLI aborts before the port walk (on Windows, where npm shims hide ENOENT, the error no longer blames the last port tried). Codex is untouched (stdio app-server, no port).

### Install

This release ships notes only — no installers attached yet. Build them yourself with `npm run dist` (unsigned macOS arm64) or `npm run dist:win` (Windows x64); on first launch on macOS, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.2.9

Every management operation you make now has a history. Pins, tags, archives, directories, session create/clone/rename/delete all journal their inverse, so a ⌘Z after a season of clicking walks the workspace backward exactly the way you built it forward — and the sidebar grew up around it: a search bar with explicit scopes, unfamiliar case-insensitive body scans, caps you set, a clear button, a one-click way back to defaults, and directory rows you add and remove yourself. Search no longer shrugs when a query has no local hits.

### Highlights

- **Operation history with undo/redo** — every management operation (pins, tags, archive, directories, session create/clone/rename/delete) appends to a journal with its inverse closure; sends, turn deletes, aborts, and incidents seal the history below them. ⌘⇧Z / ⌘Z — or the history panel (shift+⌘H) — walk the journal through a serialized queue, and entries carry their backend, so undo routes across opencode and codex.
- **Enhanced sidebar search** — an ✕ button clears a live query in one click (and refocuses the field), a search-limit selector (100 / 300 / 1000 / no cap) re-scopes body scans on the fly, and a "restore defaults" chip returns every boost option to its out-of-the-box value. Searches are case-insensitive across title, tag, and body, and can be restricted to a chosen project scope.
- **Body search after empty local hits** — a search that missed every available local term no longer gives up; if local misses occur, the result re-scans the message bodies before settling.
- **Hand-managed directories** — sidebar directory rows can be added and removed by hand, so the project list is no longer only what a server decides to surface.

### Install

Installers are attached: `awefork-0.2.9-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.2.9-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.2.8

The minimap stops being a postcard. ⌘/Ctrl+wheel over the map now magnifies the map's own view — cursor-anchored, like the canvas zoom you already know — so a graph with hundreds of nodes stops reading as a smear of 3×2 dots, and zooming back out returns the whole-world overview. Clicking the map flies the canvas to the spot with an ease instead of a jump, drags follow the cursor directly, and once zoomed in the map's view window trails the viewport through the middle band, so you never lose where you are. The canvas around it gets friendlier too: right-clicking a card opens the same session menu as its sidebar row, rows grow a one-click archive button, and the tag bands that used to paint a story's labels on every fork now stay on the session's own turns.

### Highlights

- **A magnifier on the map** — ⌘/Ctrl+wheel over the minimap zooms the map's own view, anchored at the cursor (plain wheel still zooms the canvas — that path is untouched); zooming back out returns the whole-world overview.
- **A viewfinder that trails** — once zoomed in, the map's view window follows the viewport through the middle band, so drifting across the canvas never loses it off-map.
- **Flying, not jumping** — clicking the minimap eases the canvas to the destination instead of teleporting, and drags follow directly on both navigation paths.
- **Overlaps that keep their states visible** — canvas nodes paint layered (plain → stub → subtree → hit → active path → running) and drop their 1px outline at low scale, so the states you're hunting stay readable in a dense graph.
- **A calm hand on the wheel** — the map renders through a single-layer transform with ⌘/Ctrl+wheel deltas coalesced to one zoom per frame, removing the re-render storm and trackpad-momentum jank on large graphs.
- **One menu, both surfaces** — canvas cards and sidebar rows now share a single session context menu: right-click a card and the menu opens at the click point, fixed over the canvas; Rename, which edits the row in place, first un-collapses the sidebar and opens the session's group so the edit is visible.
- **One-click archive** — session rows grow a 📦 button that archives the session with no confirm; the archive section is one click away as the undo path, so nothing is lost.
- **Tag bands stay on their story** — the selected session's tags were painting stripes onto every canvas card, so child forks looked like they inherited the label; the bands now mark only the session's own turns, while forks and the inherited parent prefix stay unmarked.

### Install

Installers are attached: `awefork-0.2.8-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.2.8-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.2.7

Sessions gain a second dimension: tags. A colored filter shelf turns a flat run of directories into something you can slice by purpose, and the canvas wears each story's labels as identity bands. The composer learns to write code — a markdown preview, Tab indentation, and a paste that fences itself — and three state bugs that only surfaced mid-flight are closed: a stale refresh landing after a backend switch, an archive pruned by a cold server's empty list, and a tag filter outliving its tag.

### Highlights

- **Session tags** — a pure overlay store (`tags-<backend>.json`, same architecture as pins) labels sessions with user-chosen names across directories: the sidebar grows a colored filter shelf (multi-select, AND), row-end chips capped at two plus an overflow count, tag-aware search, and a right-click editor that creates a tag in place.
- **The canvas wears the labels** — the selected story's tags each paint their own 3px stripe on a card's left edge, a stack rather than a first-tag-only band, so a multi-labeled story never hides behind an arbitrary pick; the pane header shows the session's own chips.
- **Tags are editable objects** — a color-dot palette (eight curated presets, plus reset to the tag's hash color) and a two-tier delete: right-click a shelf tag or hover a row, both with an inline confirm and an undo toast. Deleting strips the tag from every session, and the local state prunes before the write lands so a still-open menu cannot resurrect it from a stale snapshot.
- **Chips are filters** — clicking a session-row or favorite chip toggles that tag's filter, so a label you spot is one click from becoming the view.
- **The composer learns to write code** — a markdown preview toggle, Tab indent/outdent, and code-aware paste that wraps a multi-line snippet in a fence; attach and preview move to a head row above the textarea, leaving the footer to model + variant + send. User-authored markdown in bubbles and preview renders without reply styling.
- **A stale refresh cannot repaint a parked world** — a session fetch that resolves after a backend switch no longer paints the old backend's list into the new workspace, steals the selection back, or fires a message load for an id the new server does not know (the cross-backend 500 on switching); a failure from the parked world no longer flags the active backend offline.
- **A cold server's empty list does not wipe the archive** — an empty session list is a server answering before its scan finishes, not proof every session died, so the archive prune now skips it instead of deleting entries that are still alive.
- **A filter cannot outlive its tag** — a filter whose tag died (edited off its last session, or left behind on a backend switch) kept hiding the list with no chip left to click it off; filters now prune to the living set.
- **The flaky snapshot test pinned down** — the file-change recorder reads "before" asynchronously, and its adapter test guessed with a fixed 80 ms delay that lost the race once this release's new test files grew the suite's parallel load, taking the release gate down with it; the recorder's reader is now injectable, and the test waits for the baseline read to land instead of guessing.

### Install

Installers are attached: `awefork-0.2.7-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open, or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`) and `awefork-0.2.7-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.2.6

The pane gets kinder to both ends of a turn: your own prompts render as markdown, and a failed run grows an always-visible retry-with-different-model entry instead of a hover-only chip. The composer now follows the branch you're on — its model and thinking carry into the draft — and the canvas reads better, keeping the selected session's fork subtree readable and lighting only the turn's own children. Codex takes a round of hardening, spawned CLIs inherit the login shell's full environment, and deleting a whole session asks first.

### Highlights

- **Prompts render as markdown** — the user bubble printed prompts as plain pre-wrapped text, so pasted lists, code, and links read as one wall of characters; it now goes through the same markdown view as replies, with bubble-side tuning (white ink for text and links on the gradient; tables and code blocks keep their light panels).
- **Retry, visible** — the hover-only ↻ chip hid the retry-with-different-model flow most users never find after a run fails; failed turn cards and failed reply rows now carry an always-visible retry pill that opens the prefilled draft, where the model and reasoning effort can be swapped before resending.
- **The composer follows the branch** — selecting a session selects its setup with it: an explicit pick (including a deliberate Default model) always wins, otherwise the composer mirrors the turn the pane is on and shows the model and variant that wrote it — and a locked pane sends what the composer shows.
- **The selected session's fork subtree stays readable** — when the canvas dims everything off the active path, sessions forked from the selected one (its whole descendant subtree) keep full ink, so a branch that grew from the selection never reads as an unrelated story.
- **Highlighting stays in the family** — selecting a turn used to light its whole session's fork subtree, every branch and generation; the descendant tier now covers one generation only — the next turn on the same line plus the first card of each branch forked from the selection — a notch lighter than the active path.
- **Session deletes confirm** — a card's 🗑 removes the WHOLE session, fork-copied turns and all; one explicit confirm now says so and promises the undo window before the sweep.
- **Mint means success** — a settled run minted its session's tip even when it ended in error; failed runs (transport errors, prompts that never launched, errored last replies) now settle with no tint and clear any prior one, and the minted “just now” timestamp fades its green back to neutral ink as the tint does.
- **Codex hardening, six reviewed defects** — stdout decodes at the source so a UTF-8 character split across read chunks no longer garbles CJSON frames (CJK text); a missed handshake deadline kills the child instead of leaking a detached orphan app-server; non-directory day entries can't throw ENOTDIR into terminal-open; an imported session's account-home copy is deleted so it stays deleted instead of reappearing on the next list; reasoning summaries snapshot into their own `:summary` part instead of doubling inside the live reasoning part; a dead connection stops reading as "not logged in" and toasting an outage for a first spawn that never came up, and home subscriptions survive a re-subscribe.
- **The login shell's whole env** — spawned agent CLIs inherit the interactive shell's full export set (probed once per app session, best-effort, macOS), so provider credentials defined in rc files (`~/.zshrc`) work under a GUI launch; launcher identity, terminal cosmetics, and interpreter overrides (`NODE_OPTIONS`, `DYLD_*`) stay out.
- **A collapsed panel really collapses** — a border-box box cannot shrink below its own padding + border, so a collapsed sidebar still rendered 25px wide; padding and border zero out while collapsed and return on expand (new layout tests cover toggle round-trips, clamping, and persistence).
- **Windows CI leg green** — path-sensitive tests build their expected values from the same primitives the sources use (host `node:path` joins) instead of hardcoding POSIX separators, so they pin the real contract on every runner.

### Install

This release ships notes only — no installers attached yet. Build them yourself with `npm run dist` (unsigned macOS arm64) or `npm run dist:win` (Windows x64); on first launch on macOS, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.2.5

The sidebar reaches into the terminal — any session can jump into its agent's TUI — and a turn's real output, the files it touched, is now recorded and shown. Codex gets a round of honesty fixes (sessions that existed but never appeared, threads readable while another codex owns them), replies render math, and Windows gets its first real pass: CLI probes, PATH repair, and terminal scripts all work.

### Highlights

- **Open a session in the agent's TUI** — right-click a session → Open in terminal: a system terminal runs `opencode -s` / `codex resume` in the session's working directory — the registered `.command` handler (Warp “set as default”), else Warp when installed, else the system default on macOS; `cmd /k` on Windows; the common terminals in turn on Linux. Codex sessions from aweswitch account homes carry their CODEX_HOME so the TUI can see them, and a rollout whose recorded provider has since vanished from `config.toml` (profile switchers rewrite it wholesale) gets the config's current default forced with `-c model_provider=…` instead of dying at bootstrap.
- **Per-turn file changes** — opencode's edit/write tool parts stream through awefork's SSE connection; a per-session recorder snapshots the before/after content as frames arrive and settles modified/created/deleted entries with +N/−M counts, stored under userData so the diff survives restarts.
- **Codex sessions that were invisible** — codex 0.154's `thread/list` omits a thread until it writes a turn of its own, so a new conversation could not land and a just-cloned fork stayed hidden; the facade now memoizes created/forked sessions into the list until the server starts listing them. The multi-home merge also stopped letting a fast-answering foreign home claim a session id that also lives in the default home, and a duplicate row no longer drops the rest of its home.
- **Reading a codex thread no longer needs the writer lock** — messages load through `thread/read`, so a session another live codex owns (an aweswitch terminal, say) stays readable instead of failing with "already has an active writer". Prompting resumes the thread first and says plainly when another instance owns it; CLIs without `thread/read` fall back to resume, which predates the lock and cannot collide.
- **Math in replies** — inline and block TeX (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) render through KaTeX, with fail-safe handling so a bad formula degrades instead of throwing.
- **Login state, told straight** — `requiresOpenaiAuth` is no longer mistaken for logged-out; only a missing account is.
- **Windows works** — the switcher's CLI probes went through plain exec, which cannot run npm's `.cmd` shims, so both backends read as "not installed" on Windows; the opencode probe also lacked the PATH repair the server spawn uses, which made packaged builds misreport homebrew installs. Terminal batch scripts switch the console to UTF-8 before `cd`, so Chinese directory names survive cmd's ANSI codepage.

### Install

Installers are attached: `awefork-0.2.5-arm64.dmg` (macOS arm64, unsigned — on first launch right-click the app and choose Open) and `awefork-0.2.5-x64-setup.exe` (Windows x64 — SmartScreen may warn; choose More info → Run anyway).

## v0.2.2

The composer stops losing work: unsent drafts now survive restarts and backend switches, and a switch between opencode and codex repaints instantly from a parked workspace. Codex learns to see every account home, and the opencode adapter reads its wire facts from a descriptor instead of code.

### Highlights

- **Unsent drafts persist** — a draft anchors to its backend and its session through a per-backend overlay store, so it comes back on restart and on every backend switch. The sidecar flushes the moment a draft is sent (a crash can no longer resurrect a sent prompt as unsent), a send that straddles a backend switch aborts instead of firing an invisible run, and restore drops model picks whose sessions no longer exist.
- **Backend switches repaint instantly** — a backend you visited before repaints from its parked workspace the moment the switch lands: no handshake, no session refetch, no message reload, with a background refresh catching up what changed while it was away. The canvas's connect/offline/empty copy names the backend instead of hardcoding opencode.
- **Every codex home** — the codex backend keeps one app-server per discovered `CODEX_HOME` (the default plus each aweswitch account), merges the session list across them, and routes every call to the owning home. Prompting or forking a foreign session copies its rollout into the default home first, so the turn runs under the default account's login; interaction request ids are re-minted per facade so two homes can never collide on a pending approval.
- **The opencode adapter interprets a descriptor** — backend facts a version bump can rename (REST endpoints, SSE event names, field paths, part kinds, the fork cut, capabilities, the tested version range) now live in `src/shared/agents/opencode.json`. A closed-vocabulary validator rejects unknown keys at startup, so a descriptor typo fails loudly instead of degrading silently, and a CLI outside the compat range shows a ⚠ notice in the top bar.
- **Paths in replies open** — absolute POSIX paths — both codex's `[file](/abs/path.md:1)` link idiom and bare paths in prose — are clickable, and `openPath` now strips trailing punctuation (CJK included) and `:line`/`:line:col` suffixes for POSIX and Windows drive paths alike.
- **CI on the shared gate** — CI and release call the awecontrib `npm run verify` entry point, and checkout forces LF so biome passes on Windows.
- **The draft footer wraps** — long hints wrap instead of overflowing, and the keyboard hint gets its own row.

### Install

This release ships notes only — no installers attached yet. Build them yourself with `npm run dist` (unsigned macOS arm64) or `npm run dist:win` (Windows x64); on first launch on macOS, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.2.1

awefork grows a second backend: Codex joins opencode behind a top-bar switcher, and with it comes the whole approval dance — commands, file writes, permission escalations, and tool questions arrive as dialogs you answer before the turn may continue.

### Highlights

- **Codex as a second backend** — a backend registry keeps one adapter per agent and spawns lazily, so launch only boots your persisted selection. The switcher probes PATH without starting anything, a failed probe bounces back with the current view intact, and events from every spawned backend stream out as tagged envelopes — a run left cooking on codex keeps streaming while you work the opencode side.
- **Approvals you can actually answer** — codex's server-originated requests (command execution, file changes, permission escalation, tool user input, MCP elicitation) surface as a modal dialog with a 30-second auto-decline countdown. Unknown requests get an explicit method-not-found instead of a hang, and an unanswered dialog can never default to allow.
- **Auth trouble says so up front** — the connect-time account probe reports "run codex login" before your first prompt instead of after it, and a run-time auth failure re-checks the account to say the same thing.
- **Forks keep their shape on codex** — forking through a turn maps to `thread/fork lastTurnId` on codex 0.154+, with a fork-then-rollback fallback for older CLIs; per-backend overlay stores (`lineage-codex.json` and friends) keep the two agents' pins, trash, and lineage from ever colliding, while legacy bare files stay with opencode.
- **A dying codex can't take the app with it** — a JSON-RPC reply racing the child's exit used to write to the destroyed stdin pipe and crash the main process; in-flight server requests are now settled on disconnect, reply writes are guarded, and the initialize handshake reports the app's real version instead of a stale constant.

### Install

This release ships notes only — no installers attached yet. Build them yourself with `npm run dist` (unsigned macOS arm64) or `npm run dist:win` (Windows x64); on first launch on macOS, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.2.0

The timeline learns to stream a run part by part — thinking folded into collapsible Thought blocks — the sidebar grows a favorites shelf, and a round of quiet hardening lands: leaks plugged, watchdogs calmed, and a reused port that must prove it really is opencode.

### Highlights

- **Per-part streaming timeline** — a run no longer melts into one buffer: thinking and reply chunks interleave on the timeline keyed by part id, message.part snapshots reconcile to self-heal gaps, and unknown parts are dropped instead of smearing into their neighbors. Finished reasoning collapses into a Thought block with a title and duration, thinking renders as markdown, and a braille spinner ticks while the model works.
- **Favorites shelf** — starred sessions gather in their own sidebar shelf as plain bookmarks, while the canvas tells only the selected session's whole story. Esc dismisses a draft without tripping the IME, and delete/archive trade their modal confirmations for undo and toasts.
- **Leaks unplugged** — panel and canvas drags release their window listeners on unmount, the copy timer clears with its component, and every reconnect builds a fresh SSE parser so a half-frame from a dropped stream can't corrupt the next connection.
- **One pulse for the watchdogs** — completion watchdogs share a single poll interval; a settled run stops its watch instead of resurrecting itself, and a late `message.started` gets the watch it was missing.
- **The port proves itself** — before reusing a local port for the bundled opencode server, the app checks that the port really serves an opencode instead of trusting whatever happens to be listening.
- **Recent, then quiet** — a session that just settled takes a tint that fades over five minutes across the sidebar, canvas cards, and minimap; a still-loading canvas shows a connecting state instead of a false empty one.
- **The question stays on screen** — switching panes anchors the scroll at the turn's opening prompt (chain context above the fold), and the message list keeps your position when optimistic rows are replaced by real ones.

### Fixes

- **The selected session keeps its directory** — selecting a session now syncs its directory along with its id, instead of leaving the header pointed at the previous folder.
- **Documented opencode compatibility** — both READMEs now state which opencode versions awefork is built against.

### Install

This release ships notes only — no installers attached yet. Build them yourself with `npm run dist` (unsigned macOS arm64) or `npm run dist:win` (Windows x64); on first launch on macOS, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.1.9

v0.1.6 taught `archive.json` to survive racing clicks; this release gives every sidecar the same spine — and the dist folder learns to tidy up after itself.

### Highlights

- **Race-free sidecar writes, everywhere** — every read-modify-write on a sidecar file (pins, lineage, trash, archive) now flows through a per-file write queue, so concurrent updates line up and commit in order instead of interleaving and silently dropping the earlier change. The stores expose intent-named operations (`togglePin`, `addTrashEntry`, `removeTrashEntry`, …) and the IPC handlers call them straight through — no more read, mutate, and hope.
- **Adapter sleeps let go** — an aborted sleep in the opencode adapter now detaches its abort listener when the timer wins, instead of leaving it hanging off the signal.
- **Release builds sweep the floor** — `npm run dist` / `npm run dist:win` first move older installers out of `dist/` into `dist/archive/<version>/`, so the dist root only ever holds the current release while previous dmgs, exes, and blockmaps stay inspectable.

### Install

Download the unsigned arm64 dmg or the Windows x64 setup.exe straight from the [v0.1.9 release](https://github.com/wehuman01/awefork/releases/tag/v0.1.9). On first launch on macOS, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.1.8

awefork crosses to Windows, and the canvas learns to stay where you left it.

### Highlights

- **Windows, alongside macOS** — a win/nsis x64 build target (`npm run dist:win`), a Windows runner in CI, and the bundled opencode server that finds the binary wherever Windows hides it: `%APPDATA%\npm`, winget links, `~/.opencode/bin`, and scoop shims — spawned through the shell so npm `.cmd` shims resolve, with the PATH split on the platform's own delimiter.
- **Document attachments everywhere** — .docx (mammoth), .rtf (built-in reader), and legacy .doc (word-extractor) all convert in-process on every platform, replacing the macOS-only textutil detour; corrupt files fail with a readable message instead of a shrug.
- **The canvas keeps your place** — sending from a canvas draft no longer yanks the view: the composer floats in the branch's next free cell (exactly where the sent turn's card will land, joined by a dashed connector), so the new card materializes where you were already looking. Selecting a turn from the context chain now centers it on the canvas, while canvas clicks still leave the view untouched — and a jump aimed at a still-loading branch applies once its cards arrive.
- **Runs finish when they finish** — the backend's finish reason is tracked per assistant row, and the completion watchdog now watches the message list's shape for liveness and ignores tool-call pauses, so a run that pauses to call a tool no longer reads as done (or as stuck).

### Install

Download the unsigned arm64 dmg straight from the [v0.1.8 release](https://github.com/wehuman01/awefork/releases/tag/v0.1.8). On first launch, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`). Windows isn't attached this time — build the NSIS installer yourself with `npm run dist:win`.

## v0.1.7

Reasoning streams into the conversation, and awefork can start one itself: a release about seeing and starting the whole thought.

### Highlights

- **Streaming Thought blocks** — a run's reasoning now streams into a collapsible Thought block while you wait: open while the model thinks, auto-collapsed once the answer starts. Persisted replies keep their Thought in the final message, and canvas card previews stay reply-only. opencode 1.18 labels text and reasoning deltas alike, so the adapter resolves each part's real type before routing the stream.
- **New conversations in-app** — the sidebar's ＋ New conversation (or the palette's New conversation) starts a brand-new session in the open project through opencode's native API, lands you in it, and puts the caret in the composer for the first prompt. Demo mode keeps parity.
- **Startup & reconnect hardening** — the bundled opencode server now probes the login shell for its binary, waits for the SSE event endpoint (not just REST) before declaring ready, and retries the first session fetch until the cold-start scan finishes. A dropped event stream reports one outage toast, then refreshes everything on recovery.
- **In-app update checks** — a silent check a few seconds after startup plus a manual one from the topbar; a new release raises a banner with Release Notes, Skip this version, and dismiss.

### Install

This release ships notes only — no dmg attached. Build it yourself with `npm run dist` (unsigned arm64); on first launch, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.1.6

Retry gets its attachments back, and the archive sidecar learns to survive racing clicks.

### Highlights

- **Retry restores attachments** — retrying a turn (the ↻ on a card or pane header) now reopens the prompt with its original file parts pulled back from the backend and dropped into the composer as chips, alongside the text and model it already restored. The draft opens immediately; chips arrive once the fetch lands, and a failed fetch only costs the chips — the retried prompt still goes out.
- **Race-free archive writes** — rapid archive and restore clicks used to run overlapping read-modify-write cycles on `archive.json`, where the later write could read stale state and silently drop the earlier entry. Writes now serialize per sidecar file, and the shared empty sentinel is frozen so no caller can mutate it for everyone else.
- **Clean exit from an emptied project** — deleting or archiving the last visible session of the open directory now falls back to the fresh-install empty state instead of stranding the view on a project with nothing to show; the session refresh re-picks a directory as soon as one becomes visible again (e.g. after a restore).

### Fixes

- **Copy button on streaming code blocks** — a code block swapped out mid-stream no longer fires its stale copy-reset timer after unmount.

### Install

Download the unsigned arm64 dmg straight from the [v0.1.6 release](https://github.com/wehuman01/awefork/releases/tag/v0.1.6) (or build it yourself with `npm run dist`). On first launch, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.1.5

Archive what you set aside, retry what failed, and richer turns — plus awefork's first real app icon.

### Highlights

- **Archive** — right-click a session row to archive it, or a directory to archive the whole project. Archived items hide from every view (search, palette, canvas included) and restore from the archive section at the sidebar's bottom. Sessions created under an archived directory stay hidden until the directory comes back; archived state lives in a crash-safe `archive.json` sidecar.
- **Retry failed turns** — the ↻ on a failed turn (card or pane header) reopens its prompt prefilled with the original text and model; edit and resend. Mid-story turns retry as a fresh fork, so the failed original stays untouched.
- **Image attachments** — paste or drop images into either composer (capability-gated per model); sent rows carry 📎 chips.
- **Thinking effort variants** — pick the run's reasoning variant (minimal/low/medium/high…) next to the model; canvas cards show `model · variant` for what each turn actually used.
- **Markdown replies** — assistant replies render through a safe markdown pipeline (parser → vnodes, no HTML injection): headings, lists, code blocks with copy buttons, and shell-safe external links opened through a native IPC channel.
- **App icon & branding** — a peach-soda squircle: a cream branch that forks into butter and lavender candy nodes, built from the app's own theme palette. Ships as the packaged `icon.icns`, the dev-mode Dock icon, the topbar logo, the favicon, and the README logo.

### Install

`npm run dist` builds an unsigned arm64 dmg. On first launch, right-click the app and choose Open (or clear the quarantine flag with `xattr -d com.apple.quarantine /Applications/awefork.app`).

## v0.1.1

Canvas readability and daily-driver ergonomics on top of v0.1.0.

### Highlights

- **Canvas story search** — ⌘/Ctrl+F (or the search pill) searches every turn on the canvas: full prompt bodies (multi-line prompts included, not just the rendered first line), reply text, tool names, and failed-run errors. Every matching card gets a butter ring (minimap dots too), and the results list shows a snippet per hit; clicking one selects and centers the turn, across sessions if needed.
- **Branch digest** — the branch-summary pill lists one row per branch on the canvas: where it forked from (session + turn), its own turn count, token total, last topic, and an ⚠ for failed runs. When the canvas grows past readability, read the digest first, then click through to the branch tip.
- **Browser demo mode** — `npm run demo` serves the renderer on localhost:5180 with an in-memory fork story behind a mock adapter, so the canvas, search, and digests can be exercised without Electron or an opencode backend.
- **Context chain in the pane** — the branch-context pane now lists the turns that lead into the selected one (the same path the canvas highlights), numbered, with cross-session forks marked ⎇; click a card to jump to that turn. More than 12 ancestors collapse into an "earlier turns" note.
- **Delete from the sidebar** — right-click any session row (forks included) for Delete session; the same undo toast guards it as the canvas delete.
- **Undo delete** — deleting a session now hides it instantly with a “Deleted · Undo” toast; the real server delete only fires when the next operation flushes the pending queue (or the toast's Undo / ⌘Z cancels it first). Pending deletes persist in `trash.json` and flush on the next launch, so quitting mid-window still completes the deletion.
- **Delete stays in place** — after deleting, the selection moves to whatever session now occupies the deleted row's spot in the sidebar (next, else previous) instead of jumping back to the newest conversation.
- **Model picker scrolls** — the mouse wheel inside the searchable model list scrolls the list again instead of zooming the canvas underneath.
- **Active path highlight** — selecting a turn lights up the whole lineage from the story's root to that card (edges included); everything else dims. Branch-heavy canvases now answer "which line am I on".
- **Turn navigation** — ‹ › buttons in the right pane (or ←/→ keys) walk between turns without returning to the canvas; typing in an input never triggers them.
- **Turn stats** — cards and the pane header show each turn's wall time and output tokens, mapped from opencode's per-message `tokens` usage (no extra requests).
- **Smarter empty-prompt titles** — "(empty prompt)" cards fall back to the turn's first tool name, else the reply's first line.
- **Clone current branch** — one click forks the selected session at its latest state (a checkpoint), landing you in the copy.
- **Rename sessions** — right-click a sidebar row to rename; calls opencode's native `PATCH /session/{id}` through the adapter protocol.
- **Searchable model picker** — the native select became a combobox with search (70+ models); the right-pane composer also gained a per-session model picker that rides along with prompts.
- **Resizable shell** — drag the handles between columns to resize the sidebar and pane; double-click a handle to fold/unfold. Widths persist in localStorage.
- **Canvas minimap** — the minimap is always on while the canvas has nodes (it used to wait for a large working set), with a live viewport rectangle; click or drag it to pan.
- **Command palette** — ⌘K / Ctrl+K (or the topbar button) to jump between sessions and fire actions (fit view, clone, refresh, fold panels).

### Fixes

- **IME-safe Enter** — composing with an IME (Chinese input) no longer triggers actions: Enter confirms the candidate instead of sending a half-typed prompt, picking a palette/model item, or committing a rename; arrows and Esc during composition belong to the candidate window too.
- **Long runs stay running** — streamed deltas now count as proof of life: they keep the run state lit and reset its poll watchdog, so a run can no longer be force-settled (card flipping to “no text reply” mid-flight) while it is still streaming, and runs whose busy frame was missed heal on the first delta.
- **Fast failure without the opencode CLI** — a failed spawn (CLI not on PATH) now surfaces its error within a second instead of idling out the 30-second startup window.
- **API requests time out** — a half-dead opencode server (port open, never responding) now fails requests after 15s with a clear message instead of hanging the UI forever. The prompt endpoint deliberately stays untimed: its response only arrives when the whole run finishes.
- **No double event stream after a window reopen** — on macOS, closing the window and reopening it from the Dock used to subscribe to opencode's `/event` a second time; both loops then delivered every event, doubling streamed text and duplicate-refreshing. The subscription now happens exactly once at startup, and the closed window's reference is dropped so events can't fire into a destroyed webContents.
- **Scroll up while streaming** — the pane used to yank back to the bottom on every streamed frame; it now follows the stream only while the reader is already at the bottom (within 40px).
- **Faster session refreshes** — per-worktree session listings now run in parallel instead of serially, so a debounced refresh costs the slowest round-trip, not the sum of all of them.
- **Crash-safe sidecar writes** — `lineage.json`, `pins.json`, and `trash.json` are written via temp file + rename, so a crash mid-write can never leave a truncated file that silently resets to empty on the next read.

## v0.1.0

First release. Non-linear session workbench for opencode with node-level forking.

### Highlights

- **Fork any turn** — every user message has a "fork here" action; the new session keeps that full turn (question + answer), original untouched. Backed by opencode's native fork API (`POST /session/{id}/fork`), translated from its exclusive-cut semantics.
- **Session tree** — navigator groups all opencode sessions by project directory; forks nest under their parent via awefork's lineage sidecar; agent-spawned subagent sessions are hidden by default. Sessions are aggregated across every opencode project (`GET /project` + per-directory `GET /session?directory=`), not just the server's cwd, and fetched past the API's default 100-session page.
- **Continue in place** — send messages to the active session from awefork with live streaming (SSE `/event` normalized to a small event union), plus abort.
- **Server lifecycle** — reuses a running `opencode serve` on 127.0.0.1:4096 or spawns one as a child process, killed on quit. Spawned from the packaged app, PATH is extended with the user-level bin dirs (deskclaw, homebrew, ~/.local/bin, bun, ~/.opencode) so `opencode` resolves, and the child runs from the home directory.
- **AgentAdapter protocol** — `src/shared/types.ts` defines the multi-agent contract (listSessions / messages / fork / prompt / abort / subscribe); opencode is the first implementation, pi / Claude Code / Codex are planned.
- **Tested against a fake opencode server** — endpoint semantics (exclusive-cut fork, prompt_async, SSE) verified against a real opencode 1.18 instance and mirrored in `node:http` fakes.
- **macOS packaging** — `npm run dist` builds an unsigned arm64 dmg via electron-builder.
