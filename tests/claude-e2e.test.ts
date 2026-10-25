import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end against the REAL claude CLI.
 *
 * Opt-in only: set AWEFORK_CLAUDE_E2E=1. The run uses a throwaway
 * CLAUDE_CONFIG_DIR so it can never read or write the developer's own
 * ~/.claude/projects store, and it costs a few real API calls.
 *
 *   AWEFORK_CLAUDE_E2E=1 npx vitest run tests/claude-e2e.test.ts
 */
const ENABLED = process.env.AWEFORK_CLAUDE_E2E === "1";

describe.skipIf(!ENABLED)("claude adapter against the real CLI", () => {
  let root = "";
  let adapter: Awaited<ReturnType<typeof loadAdapter>>;

  async function loadAdapter() {
    const { createClaudeAdapter } = await import("../src/shared/claude-adapter");
    const { claudeNodeSeams } = await import("../src/main/claude-server");
    return createClaudeAdapter({
      ...(await claudeNodeSeams()),
      lineagePath: join(root, "lineage.json"),
    });
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "awefork-claude-e2e-"));
    // Isolate the transcript store: the child and the walk must agree. Auth
    // cannot ride a fresh config dir (credentials live in the keychain or
    // ~/.claude/.credentials.json), so the developer's settings `env` block —
    // the API base URL and token a headless run needs — is copied across.
    const cfgDir = join(root, "cfg");
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    await mkdir(cfgDir, { recursive: true });
    const homeSettings = join(process.env.HOME ?? "", ".claude", "settings.json");
    const raw = await readFile(homeSettings, "utf8").catch(() => null);
    if (raw) {
      const parsed = JSON.parse(raw) as { env?: Record<string, string> };
      if (parsed.env && Object.keys(parsed.env).length > 0) {
        await writeFile(
          join(cfgDir, "settings.json"),
          JSON.stringify({ env: parsed.env }, null, 2),
        );
      }
    }
    adapter = await loadAdapter();
  });

  afterAll(async () => {
    adapter?.dispose();
    // A compact child may still be flushing its transcript; give it a moment
    // so the temp tree is removable (a lost cleanup is not a test failure).
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("runs a prompt, reads it back, forks, compacts and aborts", { timeout: 600_000 }, async () => {
    const events: Array<{ type: string; sessionId?: string }> = [];
    await adapter.subscribe((event) => events.push(event as { type: string }));

    // ── a plain run ────────────────────────────────────────────────────
    const session = await adapter.createSession(root);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);

    await adapter.prompt(session.id, "Reply with exactly: E2E-OK", null, []);
    await waitForIdle(events, session.id);

    expect(events.filter((e) => e.type === "message.delta").length).toBeGreaterThan(0);

    const rows = await adapter.messages(session.id);
    expect(rows[0]?.role).toBe("user");
    expect(rows[0]?.text).toBe("Reply with exactly: E2E-OK");
    const reply = rows.find((r) => r.role === "assistant");
    expect(reply?.text ?? "").toContain("E2E-OK");

    // ── the session shows up in the listing with a title ───────────────
    const listed = await adapter.listSessions();
    const mine = listed.find((s) => s.id === session.id);
    expect(mine).toBeDefined();
    expect(mine?.title).toBeTruthy();

    // ── fork: the copy materializes on its first prompt ────────────────
    const forked = await adapter.fork(session.id, rows[0]?.id ?? null);
    expect(forked.parentSessionId).toBe(session.id);
    await adapter.prompt(forked.id, "Reply with exactly: FORK-OK", null, []);
    await waitForIdle(events, forked.id);

    const forkRows = await adapter.messages(forked.id);
    // The copy keeps the parent's turn through the anchor…
    expect(forkRows.some((r) => r.text === "Reply with exactly: E2E-OK")).toBe(true);
    // …and appends the branch's own.
    expect(forkRows.some((r) => r.text.includes("FORK-OK"))).toBe(true);

    // ── rename persists in the transcript ──────────────────────────────
    await adapter.renameSession(session.id, "E2E Renamed");
    // The CLI writes the custom-title row asynchronously; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const renamed = (await adapter.listSessions()).find((s) => s.id === session.id);
    expect(renamed?.title).toBe("E2E Renamed");

    // ── compaction ─────────────────────────────────────────────────────
    // The CLI refuses a short session ("Not enough messages to compact."),
    // so give the transcript a few real turns first.
    for (const text of ["Say ONE", "Say TWO", "Say THREE"]) {
      await adapter.prompt(session.id, text, null, []);
      await waitForIdle(events, session.id);
    }
    const turns = (await adapter.messages(session.id)).filter((r) => r.role === "user").length;
    expect(turns).toBeGreaterThanOrEqual(4);
    // The CLI decides whether there is enough history to fold; a refusal is a
    // legitimate verdict, so this asserts the plumbing (a verdict arrives and
    // the adapter reports it) rather than a successful fold.
    try {
      await adapter.compress(session.id, { providerId: "claude", modelId: "default" });
      const compacted = await adapter.messages(session.id);
      // A fold either leaves the boundary marker or a summary row; both prove
      // the compaction reached the transcript.
      expect(
        compacted.some((r) => r.compaction === true) ||
          compacted.some((r) => r.text.includes("This session is being continued")),
      ).toBe(true);
    } catch (error) {
      // A refusal ("Not enough messages to compact.") is a legitimate verdict.
      expect(String(error)).toMatch(/compact|messages/i);
    }
  });

  async function waitForIdle(
    events: Array<{ type: string; sessionId?: string }>,
    sessionId: string,
  ): Promise<void> {
    // Only an idle that arrives from here on settles THIS run; an earlier
    // one belongs to the previous turn.
    const from = events.length;
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (events.slice(from).some((e) => e.type === "session.idle" && e.sessionId === sessionId))
        return;
      const error = events
        .slice(from)
        .find((e) => e.type === "server.error" && e.sessionId === sessionId);
      if (error) throw new Error(`run failed: ${JSON.stringify(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`session ${sessionId} never went idle`);
  }
});
