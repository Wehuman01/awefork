import { describe, expect, it } from "vitest";
import { t } from "../src/renderer/src/i18n";
import { isMacPlatform, modKey, modWith } from "../src/renderer/src/platform-key";

describe("platform-key", () => {
  it("names the platform's own modifier", () => {
    // The suite runs on the host, so the expectation follows the host.
    if (isMacPlatform) {
      expect(modKey).toBe("⌘");
      expect(modWith("K")).toBe("⌘K");
    } else {
      expect(modKey).toBe("Ctrl+");
      expect(modWith("K")).toBe("Ctrl+K");
    }
  });
});

describe("i18n {mod} placeholder", () => {
  it("resolves {mod} to the platform modifier without a call-site change", () => {
    const hint = t("compare.hint");
    expect(hint).not.toContain("{mod}");
    if (isMacPlatform) {
      expect(hint).toContain("⌘↵");
    } else {
      expect(hint).toContain("Ctrl+↵");
      // A Windows user must never be told to press a key they do not have.
      expect(hint).not.toContain("⌘");
    }
  });

  it("resolves {mod} in the code-fence notice too", () => {
    const notice = t("input.codeFenceNotice");
    expect(notice).not.toContain("{mod}");
    if (!isMacPlatform) expect(notice).not.toContain("⌘");
  });

  it("resolves {mod} in the canvas map hint", () => {
    const hint = t("canvas.mmHint");
    expect(hint).not.toContain("{mod}");
    if (!isMacPlatform) expect(hint).not.toContain("⌘");
  });

  it("still interpolates explicit vars", () => {
    expect(t("canvas.toolCount", { n: 3 })).toContain("3");
  });
});
