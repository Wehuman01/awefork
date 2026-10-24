import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { StagedCodexImages } from "../shared/codex-adapter.js";
import type { PromptAttachment } from "../shared/types.js";

/**
 * Stage image attachments as files codex's `localImage` turn input can read.
 *
 * codex takes a filesystem path, not a payload, so each image's base64 is
 * written under a fresh temp dir named after the attachment — the rollout
 * later echoes that path back, and its basename is what the session history
 * shows as the attachment name. `cleanup` removes the whole dir and is safe
 * to call more than once; the adapter calls it when the turn that read the
 * files ends (or on prompt failure, when nothing will read them).
 */
export function stageCodexImages(images: readonly PromptAttachment[]): StagedCodexImages {
  const dir = mkdtempSync(join(tmpdir(), "awefork-codex-att-"));
  let released = false;
  const cleanup = () => {
    if (released) return;
    released = true;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const taken = new Set<string>();
    const paths = images.map((image, index) => {
      const at = image.dataUrl.indexOf(",");
      const payload = at === -1 ? "" : image.dataUrl.slice(at + 1);
      const file = join(dir, uniqueName(safeName(image.filename, image.mime, index), taken));
      writeFileSync(file, Buffer.from(payload, "base64"));
      return file;
    });
    return { paths, cleanup };
  } catch (error) {
    // A half-written staging dir is worse than none: the caller's catch
    // reports the failure and the files never reached codex anyway.
    cleanup();
    throw error;
  }
}

/** Keep the basename, drop control characters, guarantee an extension. */
function safeName(filename: string, mime: string, index: number): string {
  const cleaned = [...basename(filename)]
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .trim();
  const named = cleaned === "" ? `image-${index + 1}` : cleaned;
  return /\.[^./\\]+$/.test(named) ? named : `${named}${extensionFor(mime)}`;
}

/** Dedupe within one staging batch: `photo.png`, `photo-2.png`, `photo-3.png`. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** Extension codex can sniff from, for attachments named without one. */
function extensionFor(mime: string): string {
  const subtype = mime.slice(mime.indexOf("/") + 1).toLowerCase();
  if (subtype === "jpeg") return ".jpg";
  if (subtype === "svg+xml") return ".svg";
  return /^[a-z0-9.+-]+$/.test(subtype) ? `.${subtype}` : ".png";
}
