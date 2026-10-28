import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagnostics,
  type Diagnostics,
  hookUnhandledRejections,
  installConsoleTee,
} from "../src/main/diagnostics.js";

/**
 * The diagnostics ring buffer: what the status panel reads when the user
 * asks what the background commands said. Pure module, no electron — the
 * buffer, its cap, and its subscription are all the panel's contract.
 */
describe("diagnostics buffer", () => {
  it("records entries with an increasing sequence and a timestamp", () => {
    const clock = () => 1_000;
    const diagnostics = createDiagnostics({ now: clock });

    const first = diagnostics.record("error", "opencode serve exited (code=1)");
    const second = diagnostics.record("warn", "subscribing to codex events failed");

    expect(first).toEqual({
      seq: 1,
      at: 1_000,
      level: "error",
      text: "opencode serve exited (code=1)",
    });
    expect(second.seq).toBe(2);
    expect(second.at).toBe(1_000);
    expect(second.level).toBe("warn");
  });

  it("caps the buffer at its limit, dropping the oldest entry", () => {
    const diagnostics = createDiagnostics({ limit: 3 });

    for (let i = 1; i <= 5; i++) diagnostics.record("error", `boom ${i}`);

    expect(diagnostics.snapshot().map((entry) => entry.text)).toEqual([
      "boom 3",
      "boom 4",
      "boom 5",
    ]);
  });

  it("truncates over-long entry text, keeping the head", () => {
    const diagnostics = createDiagnostics({ maxEntryChars: 10 });

    const entry = diagnostics.record("error", "x".repeat(50));

    expect(entry.text).toBe("xxxxxxxxxx");
    expect(entry.text.length).toBe(10);
  });

  it("clear empties the buffer", () => {
    const diagnostics = createDiagnostics();

    diagnostics.record("error", "gone soon");
    diagnostics.clear();

    expect(diagnostics.snapshot()).toEqual([]);
  });
});

describe("diagnostics subscription", () => {
  it("delivers every new entry to subscribers in order", () => {
    const diagnostics = createDiagnostics();
    const seen: string[] = [];
    diagnostics.subscribe((entry) => seen.push(entry.text));

    diagnostics.record("error", "first");
    diagnostics.record("warn", "second");

    expect(seen).toEqual(["first", "second"]);
  });

  it("stops delivering after unsubscribe", () => {
    const diagnostics = createDiagnostics();
    const seen: string[] = [];
    const unsubscribe = diagnostics.subscribe((entry) => seen.push(entry.text));

    diagnostics.record("error", "before");
    unsubscribe();
    diagnostics.record("error", "after");

    expect(seen).toEqual(["before"]);
  });

  it("hands out a snapshot the caller cannot mutate into the buffer", () => {
    const diagnostics = createDiagnostics();
    diagnostics.record("error", "keep");

    const snapshot = diagnostics.snapshot();
    snapshot.push({ seq: 99, at: 0, level: "error", text: "injected" });

    expect(diagnostics.snapshot()).toHaveLength(1);
    expect(diagnostics.snapshot()[0]?.text).toBe("keep");
  });
});

/**
 * The console tee is the whole point: every existing console.error/warn in
 * the main process (backend children dying, spawns failing, subscriptions
 * collapsing) flows into the buffer without touching any of those call
 * sites — and the terminal still sees its output in dev.
 */
describe("diagnostics console tee", () => {
  let diagnostics: Diagnostics;
  let uninstall: (() => void) | null = null;
  const originalError = console.error;
  const originalWarn = console.warn;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    console.error = originalError;
    console.warn = originalWarn;
    vi.restoreAllMocks();
  });

  function tee(handle: Diagnostics = createDiagnostics()): Diagnostics {
    diagnostics = handle;
    uninstall = installConsoleTee(diagnostics, console);
    return handle;
  }

  it("records console.error and console.warn but not console.log", () => {
    const handle = tee();

    console.error("opencode serve exited (code=1)");
    console.warn("subscribing to codex events failed");
    console.log("chatty line the panel must not keep");

    expect(handle.snapshot().map((entry) => [entry.level, entry.text])).toEqual([
      ["error", "opencode serve exited (code=1)"],
      ["warn", "subscribing to codex events failed"],
    ]);
  });

  it("still calls through to the original console", () => {
    const errorSpy = vi.fn();
    const warnSpy = vi.fn();
    console.error = errorSpy as unknown as typeof console.error;
    console.warn = warnSpy as unknown as typeof console.warn;
    tee();

    console.error("boom");
    console.warn("careful");

    expect(errorSpy).toHaveBeenCalledWith("boom");
    expect(warnSpy).toHaveBeenCalledWith("careful");
  });

  it("formats multiple arguments the way the terminal would", () => {
    const handle = tee();

    console.error("zcode app-server spawn error:", new Error("ENOENT"));

    expect(handle.snapshot()[0]?.text).toContain("zcode app-server spawn error:");
    expect(handle.snapshot()[0]?.text).toContain("Error: ENOENT");
  });

  it("records the entry even when the original console method throws", () => {
    console.error = (() => {
      throw new Error("console is broken");
    }) as unknown as typeof console.error;
    const handle = tee();

    expect(() => console.error("still captured")).toThrow("console is broken");
    expect(handle.snapshot()[0]?.text).toBe("still captured");
  });

  it("installing twice over one console records once", () => {
    const handle = tee();
    installConsoleTee(handle, console);

    console.error("counted once");

    expect(handle.snapshot()).toHaveLength(1);
  });

  it("uninstall restores the original methods", () => {
    const errorSpy = vi.fn();
    console.error = errorSpy as unknown as typeof console.error;
    const handle = tee();

    uninstall?.();
    uninstall = null;
    console.error("after uninstall");

    expect(errorSpy).toHaveBeenCalledWith("after uninstall");
    expect(handle.snapshot()).toEqual([]);
  });
});

describe("diagnostics unhandled-rejection hook", () => {
  it("records an unhandled rejection and stops after uninstall", () => {
    // A fake process: emitting the real event with no listener left would
    // surface as a genuine unhandled rejection and fail the run.
    const listeners = new Set<(reason: unknown) => void>();
    const fakeProcess = {
      on: (_event: string, listener: (reason: unknown) => void) => {
        listeners.add(listener);
      },
      off: (_event: string, listener: (reason: unknown) => void) => {
        listeners.delete(listener);
      },
    } as unknown as NodeJS.Process;
    const emit = (reason: unknown): void => {
      for (const listener of [...listeners]) listener(reason);
    };

    const handle = createDiagnostics();
    const uninstall = hookUnhandledRejections(handle, fakeProcess);

    emit(new Error("floating promise"));
    expect(handle.snapshot()[0]?.text).toContain("floating promise");

    uninstall();
    emit(new Error("second"));
    expect(handle.snapshot()).toHaveLength(1);
  });
});
