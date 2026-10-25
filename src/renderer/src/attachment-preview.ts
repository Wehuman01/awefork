/**
 * Attachment preview for sent prompts. A message row's chips carry display
 * names only, so the bytes behind a name are fetched on demand: backends that
 * keep what was sent (opencode's file parts, claude's transcript image
 * blocks) answer that fetch, while the ones that drop the bytes (codex, pi,
 * zcode) fall back to the copy kept here at send time. That is why a
 * just-sent image previews on every backend and an older one only where the
 * backend still holds it. When neither source has the bytes the overlay says
 * so, rather than opening onto nothing.
 */
import { reactive } from "vue";
import type { BackendId } from "../../shared/backend";
import type { PromptAttachment } from "../../shared/types";
import { t } from "./i18n";

export interface AttachmentPreviewState {
  open: boolean;
  loading: boolean;
  name: string;
  /** The image's data URL once resolved; null while loading or unavailable. */
  dataUrl: string | null;
  /** Why no image is showing, phrased for the reader. */
  error: string | null;
}

export const attachmentPreview = reactive<AttachmentPreviewState>({
  open: false,
  loading: false,
  name: "",
  dataUrl: null,
  error: null,
});

export function closeAttachmentPreview(): void {
  attachmentPreview.open = false;
  attachmentPreview.loading = false;
  attachmentPreview.dataUrl = null;
  attachmentPreview.error = null;
}

/** A composer chip previews straight from the bytes it already stages. */
export function openLocalAttachmentPreview(name: string, dataUrl: string): void {
  attachmentPreview.open = true;
  attachmentPreview.loading = false;
  attachmentPreview.name = name;
  attachmentPreview.dataUrl = dataUrl;
  attachmentPreview.error = null;
}

// ── the send-time copy ────────────────────────────────────────────────
// One entry per session: the attachments of that session's most recent
// send, in the order its chips render them. Capped so a long session cannot
// grow the map without bound; the least recently sent session drops first.

interface SentAttachments {
  names: readonly string[];
  dataUrls: readonly string[];
}

const RECENT_SEND_LIMIT = 16;

const recentSends = new Map<string, SentAttachments>();

function recentKey(backend: BackendId, sessionId: string): string {
  return `${backend}:${sessionId}`;
}

export function rememberSentAttachments(
  backend: BackendId,
  sessionId: string,
  attachments: readonly PromptAttachment[],
): void {
  if (attachments.length === 0) return;
  const key = recentKey(backend, sessionId);
  // Re-insert so a repeat send counts as the freshest entry.
  recentSends.delete(key);
  recentSends.set(key, {
    names: attachments.map((attachment) => attachment.filename),
    dataUrls: attachments.map((attachment) => attachment.dataUrl),
  });
  while (recentSends.size > RECENT_SEND_LIMIT) {
    const oldest = recentSends.keys().next();
    if (oldest.done) break;
    recentSends.delete(oldest.value);
  }
}

/**
 * The send-time copy for one chip, but only while the name still lines up:
 * a row whose chips shifted must not borrow another image's bytes.
 */
function recentImageFor(
  backend: BackendId,
  sessionId: string,
  index: number,
  name: string,
): string | null {
  const entry = recentSends.get(recentKey(backend, sessionId));
  if (!entry) return null;
  if (entry.names[index] !== name) return null;
  const dataUrl = entry.dataUrls[index];
  return dataUrl?.startsWith("data:image/") ? dataUrl : null;
}

/** The image at `index` among a message's fetched attachments, if any. */
function imageAt(attachments: readonly PromptAttachment[], index: number): PromptAttachment | null {
  const attachment = attachments[index];
  if (!attachment) return null;
  return attachment.mime.startsWith("image/") ? attachment : null;
}

export interface SentAttachmentTarget {
  backend: BackendId;
  sessionId: string | undefined;
  messageId: string;
  /** The row's chips in render order; the index must line up with them. */
  names: readonly string[];
  index: number;
}

// A newer click supersedes an in-flight fetch: two quick clicks on different
// chips must not let the slower reply land on the newer overlay.
let previewRequestId = 0;

/**
 * Preview one chip of a sent prompt. The bytes are fetched per click rather
 * than per render — a row of twenty image prompts would otherwise pull every
 * payload down the moment the pane opens.
 */
export async function previewSentAttachment(target: SentAttachmentTarget): Promise<void> {
  const requestId = ++previewRequestId;
  const name = target.names[target.index] ?? "";
  attachmentPreview.open = true;
  attachmentPreview.loading = true;
  attachmentPreview.name = name;
  attachmentPreview.dataUrl = null;
  attachmentPreview.error = null;

  const cached = target.sessionId
    ? recentImageFor(target.backend, target.sessionId, target.index, name)
    : null;
  if (cached) {
    if (previewRequestId !== requestId) return;
    attachmentPreview.loading = false;
    attachmentPreview.dataUrl = cached;
    return;
  }
  if (!target.sessionId) {
    attachmentPreview.loading = false;
    attachmentPreview.error = t("attachments.previewUnavailable");
    return;
  }
  try {
    const attachments = await window.awefork.messageAttachments(
      target.backend,
      target.sessionId,
      target.messageId,
    );
    if (previewRequestId !== requestId) return;
    const image = imageAt(attachments, target.index);
    attachmentPreview.loading = false;
    if (image) attachmentPreview.dataUrl = image.dataUrl;
    else attachmentPreview.error = t("attachments.previewUnavailable");
  } catch {
    if (previewRequestId !== requestId) return;
    attachmentPreview.loading = false;
    attachmentPreview.error = t("attachments.previewUnavailable");
  }
}
