import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCodexJsonRpc } from "../src/main/codex-jsonrpc";
import { type AgentEvent, createCodexAdapter } from "../src/shared/codex-adapter";

/**
 * End-to-end against the REAL codex CLI.
 *
 * Opt-in only: set AWEFORK_CODEX_E2E=1. The run uses a throwaway CODEX_HOME
 * so it never writes to the developer's own ~/.codex, and it costs a few real
 * API calls.
 *
 *   AWEFORK_CODEX_E2E=1 npx vitest run tests/codex-provider-change.e2e.test.ts
 *
 * What it proves: codex pins a chat to the model provider it was created
 * with, so a chat recorded with provider=openai cannot be resumed in a home
 * whose config names another provider ("This chat uses openai, but your
 * current provider is magpie"). The adapter must not fail the run — it
 * continues on a fork under the current provider, with the history along.
 */
const ENABLED = process.env.AWEFORK_CODEX_E2E === "1";

const REAL_HOME = `${process.env.HOME}/.codex`;
const CODEX_BIN = `${process.env.HOME}/.deskclaw/node/bin/codex`;
// A real root rollout recorded with provider=openai (written while codex's
// default provider was openai). A root thread has no parent rollout, so the
// scratch home needs this one file alone.
const ROLLOUT_REL =
  "2026/10/30/rollout-2026-10-30T08-42-02-01a18a41-acbf-7c92-aa58-620b66b4ad90.jsonl";
const THREAD_ID = "01a18a41-acbf-7c92-aa58-620b66b4ad90";
const MODEL = "stepfun-cn/step-5-preview";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true, maxRetries: 5 })),
  );
});

/** A scratch CODEX_HOME holding the real config and one real openai chat. */
async function scratchHome(forceProvider?: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "awefork-codex-e2e-"));
  dirs.push(home);
  const config = await readFile(`${REAL_HOME}/config.toml`, "utf8");
  // The provider the config names is the whole point of the test, so pin it
  // rather than inherit whatever magpie wrote last.
  const patched = forceProvider
    ? /^\s*model_provider\s*=.*$/m.test(config)
      ? config.replace(/^\s*model_provider\s*=.*$/m, `model_provider = "${forceProvider}"`)
      : `model_provider = "${forceProvider}"\n${config}`
    : config;
  await writeFile(join(home, "config.toml"), patched);
  await copyFile(`${REAL_HOME}/auth.json`, join(home, "auth.json"));
  await mkdir(join(home, "sessions", "2026", "10", "30"), { recursive: true });
  await copyFile(join(REAL_HOME, "sessions", ROLLOUT_REL), join(home, "sessions", ROLLOUT_REL));
  // The catalog the config names has to travel with it.
  const catalog = config.match(/model_catalog_json\s*=\s*"([^"]+)"/)?.[1];
  if (catalog) {
    try {
      await copyFile(catalog, join(home, catalog.replace(/^.*\//, "")));
    } catch {
      // No catalog (magpie disconnected): the turn cannot name a model, and
      // the fork assertions below still hold.
    }
  }
  return home;
}

async function startCodex(home: string) {
  const child = spawn(CODEX_BIN, ["app-server"], {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const stdin = child.stdin;
  const stdout = child.stdout;
  if (!stdin || !stdout) throw new Error("codex app-server has no stdio");
  const rpc = createCodexJsonRpc(stdin, stdout, {
    onNotification: () => {},
    onDisconnect: () => {},
  });
  await rpc.request("initialize", {
    clientInfo: { name: "awefork-test", title: "awefork-test", version: "0.0.1" },
  });
  return { child, rpc };
}

describe.skipIf(!ENABLED)("codex adapter against the real CLI", () => {
  it("continues an openai-recorded chat on a fork under the current provider", async () => {
    // The config names magpie while the chat was recorded with openai.
    const home = await scratchHome("magpie");
    const { child, rpc } = await startCodex(home);

    const adapter = createCodexAdapter({
      client: rpc,
      lineagePath: join(home, "lineage.json"),
      cliVersion: "0.167.0",
    });
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await adapter.prompt(THREAD_ID, "reply with the single word: OK", {
      providerId: "codex",
      modelId: MODEL,
    });

    // The run moved to a branch instead of failing.
    const continued = events.find((e) => e.type === "session.branchContinued") as
      | { forkedSessionId: string; message: string }
      | undefined;
    expect(continued).toBeDefined();
    expect(continued?.message).toContain("provider");
    expect(events.find((e) => e.type === "server.error")).toBeUndefined();
    const forkId = continued?.forkedSessionId ?? "";

    // The fork runs under the CURRENT provider — the whole point of the move.
    const fork = (await rpc.request<{ thread?: { modelProvider?: string } }>("thread/read", {
      threadId: forkId,
    })) as { thread?: { modelProvider?: string } };
    expect(fork.thread?.modelProvider).toBe("magpie");

    // The fork is a real branch of the old chat, not a new empty one.
    const lineage = JSON.parse(await readFile(join(home, "lineage.json"), "utf8"));
    expect(lineage[forkId]).toMatchObject({ parentId: THREAD_ID });

    rpc.dispose();
    child.kill();
  }, 240_000);

  it("leaves a chat alone when the configured provider still matches", async () => {
    // The healthy path: the config names the provider the chat was recorded
    // with, so the run stays on the chat it started on.
    const home = await scratchHome("openai");
    const { child, rpc } = await startCodex(home);

    const adapter = createCodexAdapter({
      client: rpc,
      lineagePath: join(home, "lineage.json"),
      cliVersion: "0.167.0",
    });
    const events: AgentEvent[] = [];
    await adapter.subscribe((event) => events.push(event));

    await adapter.prompt(THREAD_ID, "reply with the single word: OK", {
      providerId: "codex",
      modelId: MODEL,
    });

    expect(events.find((e) => e.type === "server.error")).toBeUndefined();
    // No fork: the chat itself took the turn.
    expect(events.find((e) => e.type === "session.branchContinued")).toBeUndefined();

    rpc.dispose();
    child.kill();
  }, 240_000);
});
