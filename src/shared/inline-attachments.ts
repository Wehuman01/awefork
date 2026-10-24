import type { PromptAttachment } from "./types.js";

/**
 * Append non-image attachments to the prompt text as named sections. A
 * backend whose prompt has no file part to hang them on (pi, codex) inlines
 * them here instead: silently dropping a staged document would be worse than
 * a slightly verbose message.
 */
export function withInlineFiles(text: string, files: readonly PromptAttachment[]): string {
  if (files.length === 0) return text;
  const sections = files.map((file) => {
    const at = file.dataUrl.indexOf(",");
    const payload = at === -1 ? "" : file.dataUrl.slice(at + 1);
    return `--- ${file.filename} ---\n${decodeBase64Utf8(payload)}`;
  });
  return [text, ...sections].join("\n\n");
}

/**
 * base64 → UTF-8, without node's Buffer: this module is shared with the
 * renderer build (which has no node types), so the decoder is hand-rolled.
 * A malformed payload decodes to "" — the caller's error path then names the
 * failure rather than silently shipping a truncated document.
 */
export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
