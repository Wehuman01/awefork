import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  openSessionInTerminal,
  readDefaultTerminalBundleId,
  type SessionTerminalDeps,
  type SessionTerminalRequest,
  sessionBatchBody,
  sessionScriptBody,
  sessionScriptPath,
  shellQuote,
} from "../src/main/session-terminal.js";

type ExecCall = { file: string; args: string[] };

/** Recording exec: canned stdout per command, ENOENT per blacklisted binary. */
function fakeExec(options: {
  stdout?: (file: string) => string;
  missing?: string[];
  failOn?: (call: ExecCall) => boolean;
}) {
  const calls: ExecCall[] = [];
  const exec = async (file: string, args: readonly string[]) => {
    calls.push({ file, args: [...args] });
    if (options.missing?.includes(file)) {
      const error = new Error("spawn ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    if (options.failOn?.({ file, args: [...args] })) throw new Error("boom");
    return { stdout: options.stdout?.(file) ?? "", stderr: "" };
  };
  return { calls, exec };
}

/** In-memory write/chmod/exists deps; nothing touches the real filesystem. */
function recordingDeps(overrides?: Partial<SessionTerminalDeps>) {
  const files = new Map<string, string>();
  const chmods: Array<{ path: string; mode: number }> = [];
  const deps: SessionTerminalDeps = {
    write: (path, content) => void files.set(path, content),
    chmod: (path, mode) => void chmods.push({ path, mode }),
    exists: () => false,
    tempDir: () => "/tmp/awefork-test",
    userHome: () => "/Users/tester",
    defaultTerminalBundleId: async () => null,
    ...overrides,
  };
  return { files, chmods, deps };
}

const OPENCODE: SessionTerminalRequest = {
  backend: "opencode",
  sessionId: "ses_abc123",
  directory: "/Users/tester/repo",
  codexHome: null,
};

const CODEX_FOREIGN: SessionTerminalRequest = {
  backend: "codex",
  sessionId: "6f0e9b28-1111-2222-3333-444455556666",
  directory: "/Users/tester/repo",
  codexHome: "/Users/tester/.config/aweswitch/accounts/codex/cxo-peng",
};

const PI: SessionTerminalRequest = {
  backend: "pi",
  sessionId: "6f0e9b28-1111-2222-3333-444455556666",
  directory: "/Users/tester/repo",
  codexHome: null,
  sessionFile: "/Users/tester/.local/share/pi/sessions/6f0e9b28-1111-2222-3333-444455556666.jsonl",
};

const ZCODE: SessionTerminalRequest = {
  backend: "zcode",
  sessionId: "sess_abcdef1234567890",
  directory: "/Users/tester/repo",
  codexHome: null,
  zcodeCli: "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs",
};

describe("shellQuote", () => {
  it("wraps a plain path", () => {
    expect(shellQuote("/repo/path")).toBe("'/repo/path'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("/it's")).toBe("'/it'\\''s'");
  });
});

describe("sessionScriptBody", () => {
  it("runs opencode with -s in the session directory", () => {
    expect(sessionScriptBody(OPENCODE)).toBe(
      [
        "#!/bin/sh",
        'rm -f -- "$0"',
        "cd '/Users/tester/repo' || exit 1",
        "exec opencode -s 'ses_abc123'",
        "",
      ].join("\n"),
    );
  });

  it("resumes codex and exports the owning home only for foreign homes", () => {
    const foreign = sessionScriptBody(CODEX_FOREIGN);
    expect(foreign).toContain("exec codex resume '");
    expect(foreign).toContain(
      "export CODEX_HOME='/Users/tester/.config/aweswitch/accounts/codex/cxo-peng'",
    );

    const local = sessionScriptBody({ ...CODEX_FOREIGN, codexHome: null });
    expect(local).not.toContain("CODEX_HOME");
  });

  it("forces the fallback provider after the session id", () => {
    const body = sessionScriptBody({ ...CODEX_FOREIGN, codexProviderOverride: "openai" });
    expect(body).toContain(
      "exec codex resume '6f0e9b28-1111-2222-3333-444455556666' -c model_provider=openai",
    );
  });

  it("drops a provider override that could smuggle script characters", () => {
    const body = sessionScriptBody({ ...CODEX_FOREIGN, codexProviderOverride: "x; rm -rf /" });
    expect(body).toContain("exec codex resume '6f0e9b28-1111-2222-3333-444455556666'\n");
  });

  it("resumes pi via --session with the JSONL path shell-quoted", () => {
    expect(sessionScriptBody(PI)).toBe(
      [
        "#!/bin/sh",
        'rm -f -- "$0"',
        "cd '/Users/tester/repo' || exit 1",
        "exec pi --session '/Users/tester/.local/share/pi/sessions/6f0e9b28-1111-2222-3333-444455556666.jsonl'",
        "",
      ].join("\n"),
    );
  });

  it("resumes zcode via node --resume with the CLI path and session id", () => {
    expect(sessionScriptBody(ZCODE)).toBe(
      [
        "#!/bin/sh",
        'rm -f -- "$0"',
        "cd '/Users/tester/repo' || exit 1",
        "exec node '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs' --resume 'sess_abcdef1234567890'",
        "",
      ].join("\n"),
    );
  });

  it("escapes single quotes in the pi session file path", () => {
    const body = sessionScriptBody({
      ...PI,
      sessionFile: "/Users/tester/it's/session.jsonl",
    });
    expect(body).toContain("exec pi --session '/Users/tester/it'\\''s/session.jsonl'\n");
  });
});

describe("sessionBatchBody", () => {
  it("cds with quoting, runs the TUI, then self-deletes", () => {
    expect(sessionBatchBody(OPENCODE)).toBe(
      [
        "@echo off",
        "setlocal DisableDelayedExpansion",
        "@chcp 65001 >nul",
        'cd /d "/Users/tester/repo"',
        "if errorlevel 1 exit /b 1",
        "opencode -s ses_abc123",
        '(goto) 2>nul & del "%~f0"',
        "",
      ].join("\r\n"),
    );
  });

  it("switches the console to UTF-8 before any path can appear", () => {
    // The file is written UTF-8; cmd would decode it as GBK on Chinese
    // Windows and mangle a non-ASCII directory unless chcp ran first.
    const body = sessionBatchBody({ ...CODEX_FOREIGN, directory: "C:\\Users\\鹏\\项目" });
    expect(body.indexOf("@chcp 65001 >nul")).toBeLessThan(body.indexOf("cd /d"));
  });

  it("sets CODEX_HOME before codex resume for foreign homes", () => {
    expect(sessionBatchBody(CODEX_FOREIGN)).toContain(
      'set "CODEX_HOME=/Users/tester/.config/aweswitch/accounts/codex/cxo-peng"',
    );
    expect(sessionBatchBody(CODEX_FOREIGN)).toContain(
      "codex resume 6f0e9b28-1111-2222-3333-444455556666",
    );
  });

  it("forces the fallback provider after the session id", () => {
    expect(sessionBatchBody({ ...CODEX_FOREIGN, codexProviderOverride: "openai" })).toContain(
      "codex resume 6f0e9b28-1111-2222-3333-444455556666 -c model_provider=openai",
    );
  });

  it("resumes pi via --session with the JSONL path quoted in batch", () => {
    expect(sessionBatchBody(PI)).toBe(
      [
        "@echo off",
        "setlocal DisableDelayedExpansion",
        "@chcp 65001 >nul",
        'cd /d "/Users/tester/repo"',
        "if errorlevel 1 exit /b 1",
        'pi --session "/Users/tester/.local/share/pi/sessions/6f0e9b28-1111-2222-3333-444455556666.jsonl"',
        '(goto) 2>nul & del "%~f0"',
        "",
      ].join("\r\n"),
    );
  });

  it("resumes zcode via node --resume with the CLI path quoted and the session id bare", () => {
    expect(sessionBatchBody(ZCODE)).toBe(
      [
        "@echo off",
        "setlocal DisableDelayedExpansion",
        "@chcp 65001 >nul",
        'cd /d "/Users/tester/repo"',
        "if errorlevel 1 exit /b 1",
        'node "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" --resume sess_abcdef1234567890',
        '(goto) 2>nul & del "%~f0"',
        "",
      ].join("\r\n"),
    );
  });

  it("quotes pi and zcode paths that contain spaces in batch", () => {
    // A home directory with a space must not split the resume command.
    const spacedPi = sessionBatchBody({
      ...PI,
      sessionFile: "/Users/Some Body/pi/sessions/6f0e9b28.jsonl",
    });
    expect(spacedPi).toContain('pi --session "/Users/Some Body/pi/sessions/6f0e9b28.jsonl"');
    const spacedZcode = sessionBatchBody({
      ...ZCODE,
      zcodeCli: "/Applications/ZCode App.app/Contents/Resources/glm/zcode.cjs",
    });
    expect(spacedZcode).toContain(
      'node "/Applications/ZCode App.app/Contents/Resources/glm/zcode.cjs" --resume sess_abcdef1234567890',
    );
  });

  it("escapes percent signs in batch paths and CODEX_HOME", () => {
    const body = sessionBatchBody({
      ...CODEX_FOREIGN,
      directory: "C:\\Users\\100%done%\\repo",
      codexHome: "C:\\Users\\100%done%\\codex",
    });

    expect(body).toContain('cd /d "C:\\Users\\100%%done%%\\repo"');
    expect(body).toContain('set "CODEX_HOME=C:\\Users\\100%%done%%\\codex"');
  });

  it("disables delayed expansion before writing user-controlled batch paths", () => {
    expect(sessionBatchBody({ ...OPENCODE, directory: "C:\\Users\\hello!\\repo" })).toContain(
      "setlocal DisableDelayedExpansion",
    );
  });
});

describe("sessionScriptPath", () => {
  it("sanitizes characters that do not belong in a filename", () => {
    // Expected paths are built with the host's own join, so the assertion
    // pins directory + filename on every CI platform (win32 join differs).
    expect(sessionScriptPath({ ...OPENCODE, sessionId: "we/ird id" }, "/tmp", ".command")).toBe(
      join("/tmp", "awefork-session-we_ird_id.command"),
    );
  });
});

describe("openSessionInTerminal (darwin)", () => {
  it("writes an executable .command and opens it with plain open", async () => {
    const { calls, exec } = fakeExec({});
    const { files, chmods, deps } = recordingDeps({ exec });
    const result = await openSessionInTerminal(OPENCODE, { ...deps, platform: "darwin" });
    expect(result).toEqual({ ok: true });
    const file = join("/tmp/awefork-test", "awefork-session-ses_abc123.command");
    expect(files.get(file)).toBe(sessionScriptBody(OPENCODE));
    expect(chmods).toEqual([{ path: file, mode: 0o755 }]);
    expect(calls).toEqual([{ file: "open", args: [file] }]);
  });

  it("prefers Warp when it is installed and no default was registered", async () => {
    const { calls, exec } = fakeExec({});
    const { deps } = recordingDeps({
      exec,
      exists: (path) => path === "/Applications/Warp.app",
    });
    await openSessionInTerminal(OPENCODE, { ...deps, platform: "darwin" });
    expect(calls[0]?.args[0]).toBe("-a");
    expect(calls[0]?.args[1]).toBe("Warp");
  });

  it("honors the registered default-terminal bundle id first", async () => {
    const { calls, exec } = fakeExec({});
    const { deps } = recordingDeps({
      exec,
      exists: () => true,
      defaultTerminalBundleId: async () => "com.googlecode.iterm2",
    });
    await openSessionInTerminal(OPENCODE, { ...deps, platform: "darwin" });
    expect(calls).toEqual([
      {
        file: "open",
        args: [
          "-b",
          "com.googlecode.iterm2",
          join("/tmp/awefork-test", "awefork-session-ses_abc123.command"),
        ],
      },
    ]);
  });

  it("falls back to plain open when the registered app fails to launch", async () => {
    const { calls, exec } = fakeExec({
      failOn: (call) => call.args[0] === "-b",
    });
    const { deps } = recordingDeps({
      exec,
      defaultTerminalBundleId: async () => "com.dead.app",
    });
    const result = await openSessionInTerminal(OPENCODE, { ...deps, platform: "darwin" });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args[0]).not.toBe("-b");
  });
});

describe("openSessionInTerminal (win32)", () => {
  it("writes a .cmd file and starts cmd /k on it", async () => {
    const { calls, exec } = fakeExec({});
    const { files, chmods, deps } = recordingDeps({ exec });
    const result = await openSessionInTerminal(OPENCODE, { ...deps, platform: "win32" });
    expect(result).toEqual({ ok: true });
    const file = join("/tmp/awefork-test", "awefork-session-ses_abc123.cmd");
    expect(files.get(file)).toBe(sessionBatchBody(OPENCODE));
    expect(chmods).toEqual([]);
    expect(calls).toEqual([{ file: "cmd.exe", args: ["/c", "start", "", "cmd", "/k", file] }]);
  });
});

describe("openSessionInTerminal (linux)", () => {
  it("tries terminals until one exists", async () => {
    const { calls, exec } = fakeExec({ missing: ["gnome-terminal", "konsole"] });
    const { deps } = recordingDeps({ exec });
    const result = await openSessionInTerminal(OPENCODE, { ...deps, platform: "linux" });
    expect(result).toEqual({ ok: true });
    expect(calls.map((call) => call.file)).toEqual(["gnome-terminal", "konsole", "xfce4-terminal"]);
    expect(calls[2]?.args).toEqual([
      "-x",
      "bash",
      join("/tmp/awefork-test", "awefork-session-ses_abc123.sh"),
    ]);
  });

  it("reports an error when no known terminal is installed", async () => {
    const { exec } = fakeExec({
      missing: [
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "kitty",
        "alacritty",
        "wezterm",
        "xterm",
      ],
    });
    const { deps } = recordingDeps({ exec });
    const result = await openSessionInTerminal(OPENCODE, { ...deps, platform: "linux" });
    expect(result.ok).toBe(false);
  });
});

describe("openSessionInTerminal (guards)", () => {
  it("refuses session ids that could smuggle script characters", async () => {
    const { deps } = recordingDeps();
    const result = await openSessionInTerminal(
      { ...OPENCODE, sessionId: "ses'; rm -rf /" },
      { ...deps, platform: "darwin" },
    );
    expect(result.ok).toBe(false);
  });

  it("refuses sessions without a working directory", async () => {
    const { deps } = recordingDeps();
    const result = await openSessionInTerminal(
      { ...OPENCODE, directory: "" },
      { ...deps, platform: "darwin" },
    );
    expect(result.ok).toBe(false);
  });

  it("wraps a failed launch as {ok:false}", async () => {
    const { exec } = fakeExec({ failOn: () => true });
    const { deps } = recordingDeps({ exec });
    const result = await openSessionInTerminal(OPENCODE, { ...deps, platform: "darwin" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("打开终端失败");
  });

  it("refuses pi sessions without a session file", async () => {
    const { deps } = recordingDeps();
    const result = await openSessionInTerminal(
      { ...PI, sessionFile: null },
      { ...deps, platform: "darwin" },
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("找不到该会话的记录文件，无法在终端打开");
  });

  it("refuses zcode sessions without a CLI path", async () => {
    const { deps } = recordingDeps();
    const result = await openSessionInTerminal(
      { ...ZCODE, zcodeCli: null },
      { ...deps, platform: "darwin" },
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("未找到 zcode CLI 路径，无法在终端打开");
  });
});

describe("readDefaultTerminalBundleId", () => {
  const home = () => "/Users/tester";
  const securePlist =
    "/Users/tester/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist";

  it("returns the app registered for .command files", async () => {
    const { exec } = fakeExec({
      stdout: () =>
        JSON.stringify({
          LSHandlers: [
            { LSHandlerURLScheme: "zoomphonecall", LSHandlerRoleAll: "us.zoom.xos" },
            { LSHandlerContentTag: "command", LSHandlerRoleAll: "dev.warp.Warp-Stable" },
          ],
        }),
    });
    const id = await readDefaultTerminalBundleId(exec, home, () => true);
    expect(id).toBe("dev.warp.Warp-Stable");
  });

  it("matches the shell-script UTI too", async () => {
    const { exec } = fakeExec({
      stdout: () =>
        JSON.stringify({
          LSHandlers: [
            {
              LSHandlerContentType: "com.apple.terminal.shell-script",
              LSHandlerRoleAll: "com.googlecode.iterm2",
            },
          ],
        }),
    });
    const id = await readDefaultTerminalBundleId(exec, home, () => true);
    expect(id).toBe("com.googlecode.iterm2");
  });

  it("yields null when no override exists", async () => {
    const { exec } = fakeExec({ stdout: () => JSON.stringify({ LSHandlers: [] }) });
    expect(await readDefaultTerminalBundleId(exec, home, () => true)).toBeNull();
    const { exec: exec2 } = fakeExec({});
    expect(await readDefaultTerminalBundleId(exec2, home, () => false)).toBeNull();
  });
});
