# opencode v2 Support — Design

Date: 2026-10-13
Status: implemented and verified live
Verification: every protocol fact below was checked against the local
`opencode v2.0.26` binary (`opencode serve` on 127.0.0.1, its `/openapi.json`
spec, and a live prompt run against the user's real provider) plus its bundled
web-UI client code, which is the authoritative consumer of the event stream.
The v1 (1.18.x) contract stays as the descriptor already encodes it. After
implementation the whole path was re-verified against the live background
service: registry boot (probe → v2 descriptor → service reuse → 1707 sessions),
awefork's own spawn with a pinned password (plus wrong-password rejection),
real forks/renames/deletes, and the full event stream.

## Goal

Drive opencode v2 (`/api`-prefixed REST, authenticated, new event family) with
the same awefork, selected at runtime from the probed CLI version. opencode
1.18.x–1.19.x keeps working untouched — two descriptors, one interpreter, one
adapter shell.

## Why this is cheap

The descriptor layer (`src/shared/agent-descriptor.ts`) already exists to make
"a renamed route is a data fix, not a code fix", and the adapter is already an
interpreter over it. Most of the v1→v2 delta is names and paths — new
descriptor data. What genuinely changed shape (auth, response envelope, cursor
pagination, the streaming event family, prompt/compact bodies) is expressed as
small, named protocol facts in the descriptor and interpreted by branches that
the descriptor's `protocol` field selects. No second adapter.

## v2 protocol surface (verified)

Auth: every `/api` route requires HTTP Basic `opencode:<password>`. The
password is random per server start and printed on stdout (`server password
…`), or fixed by spawning with `OPENCODE_SERVER_PASSWORD` / `OPENCODE_PASSWORD`.
The v2 CLI's own background service registers itself at
`$XDG_STATE_HOME/opencode/service.json` (default `~/.local/state/…`) with
`{url, pid, password}` — that is how any v2 client (including the TUI) finds
and authenticates to it.

Endpoints (all under `/api`, responses wrapped `{data: …}` except `/api/project`
which is a bare array; list endpoints paginate by cursor):

| awefork need | v1 | v2 |
| --- | --- | --- |
| list sessions | `GET /session` | `GET /api/session` (`?directory=`, `?limit=`, `?cursor=`) |
| get session | `GET /session/:id` | `GET /api/session/:id` |
| create session | `POST /session?directory=` | `POST /api/session` body `{location:{directory}}` |
| rename | `PATCH /session/:id` `{title}` | same path under `/api`, answers 204 |
| delete session | `DELETE /session/:id` | same under `/api` |
| messages | `GET /session/:id/message` | `GET /api/session/:id/message` (cursor pages, max 200; `?order=asc` on the first page — the default is newest-first, and a cursor already carries its order) |
| prompt | `POST /session/:id/message` `{parts,model,variant}` | `POST /api/session/:id/prompt` `{text,files:[{uri:"data:<mime>;base64,<data>",name}]}`; the model lives on the session (`POST /api/session/:id/model`) |
| fork | `POST /session/:id/fork` `{messageID}` | `POST /api/session/:id/fork` `{before}` |
| compress | `POST /session/:id/summarize` `{providerID,modelID,auto:false}` | `POST /api/session/:id/compact` `{}` (model from the session) |
| abort | `POST /session/:id/abort` | `POST /api/session/:id/interrupt` |
| models | `GET /config/providers` (nested maps) | `GET /api/model` (flat list, `variants` array, `capabilities.input`) |
| projects | `GET /project` | `GET /api/project` (bare array, `canonical` for the worktree) |
| events | `GET /event` | `GET /api/event` |
| delete message | `DELETE /session/:id/message/:mid` | **gone** → `capabilities.deleteMessage: false` |

Row shapes: a session carries `location.directory` (was `directory`) and
`fork.sessionID` + `fork.boundary.messageID` (was `parentID`); `time.created` /
`time.updated` survive. A message is flat: `{id, time, type}` where `type` is
`user`/`assistant`/`idle`/`synthetic`/`compaction`/…; user text is a `text`
field with `files:[{name,mime,data}]`; assistant rows carry
`model:{id,providerID,variant}`, `content:[…]`, `finish`, `tokens.output`,
`error:{type,message}`. Content items: `text` / `reasoning` (with
`time:{created,completed}`) / `tool` (`{id,name,state:{status,input,content,
metadata}}`, tool inputs spell the path `input.path`, not `input.filePath`) /
`compaction` (its own row type).

Events: SSE frames are `data: {"id","created","type","location","data"}` — the
payload moved from `properties` to `data`. The names awefork needs survive
(`session.created/updated/deleted/renamed/compacted`, `message.updated/removed`,
`session.error`), but a live run no longer emits `session.status`,
`session.idle`, `message.part.updated` or `message.part.delta`. It emits a new
family instead (verified end to end with a real run):

- run: `session.execution.started` → `session.execution.succeeded|failed|interrupted`
- step: `session.step.started|streamed|ended|failed` (`assistantMessageID`, `finish`, `tokens`)
- text: `session.text.started|delta|ended` (`assistantMessageID`, `ordinal`, `delta`, `text`)
- reasoning: `session.reasoning.started|delta|ended` (same, plus `state`)
- tools: `session.tool.input.started|ended` (`id`,`name`), `session.tool.called` (`id`,`input` parsed, `executed`), `session.tool.progress|success|failed` (`id`, `content`, `metadata`, `error`)

Text/reasoning parts are addressed by `(assistantMessageID, ordinal)`; tools by
their call `id`. The web UI's own reducer confirms the mapping (started pushes
an empty part, delta appends, ended replaces with the full text; tool.called
moves the part to `state.status:"running"` with the parsed input, tool.success
to `"completed"`).

## Architecture

- `agents/opencode-v2.json` — the v2 descriptor. Same vocabulary plus new
  optional sections: `protocol`, `auth`, `envelope`, `pagination` (with the
  first-page `order`), `prompt`, `sessions.create`, `messages.partsPath` /
  `textPath` / `attachments`, `parts.compaction.rowTypeField`,
  `partTimeKeys`. The frame payload's move from `properties` to `data` is
  normalized in `sse.ts` instead — both spellings reach the adapters as one
  shape.
- `agent-descriptor.ts` — parses both files, exposes
  `selectOpencodeDescriptor(version)` (exact compat hit, else the closest
  known protocol) and `opencodeVersionWarning(version)` (union of tested
  ranges). `opencodeDescriptor()` keeps returning the bundled v1 descriptor as
  the default for callers without a version.
- `opencode-client.ts` — one client, protocol branches named by descriptor
  facts: Basic auth header, `{data}` unwrapping (with per-endpoint `bare`
  exceptions), cursor pagination, prompt/fork/compact/create bodies, and the
  flat model list. Returns raw server rows; interpretation stays in the adapter.
- `opencode-adapter.ts` — mapping becomes fully descriptor-driven (parts path,
  row-level text/attachments/compaction marker, part time keys, fork-adoption
  field reads), and `subscribe` dispatches frame translation by
  `descriptor.protocol`.
- `opencode-v2-events.ts` — the v2 frame translator: ordinal-scoped
  text/reasoning streams → `message.part`/`message.delta` (partId
  `messageId#ordinal`), execution lifecycle → `message.started`/`session.idle`,
  tool lifecycle → file-change recorder frames (path from `tool.called`'s
  parsed `input`, state `running`→`completed`/`error`).
- `opencode-server.ts` — spawns with `OPENCODE_SERVER_PASSWORD` (generated,
  returned to the registry) and probes readiness with the selected protocol;
  adds `reuseRegisteredOpencodeService()` for the background-service file.
- `backend-registry.ts` — caches the CLI probe, selects the descriptor, passes
  descriptor + password into the adapter, computes capabilities from the
  selected descriptor (async, since it needs the probe).
- `backend.ts` — `backendCapabilities(backend, opencodeVersion?)`.
- renderer — local capability computation passes the version it already has
  from the backend list.

## Non-goals

- No v1→v2 session migration UI (v2 migrates v1 storage itself on first run).
- No password UI for foreign servers: a manually started `opencode serve`
  (v2) cannot be adopted — its password is unknowable. awefork reuses the
  background service (registration file) or spawns its own.
- Message delete stays off on v2 (no endpoint exists).
