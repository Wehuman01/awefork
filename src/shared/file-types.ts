/**
 * Types for the local file browser and the path-text drop into canvas
 * drafts. Shared by the main process (which enumerates and reads), the
 * preload bridge and the renderer (which browses, previews, and inserts
 * paths as plain text).
 *
 * Two boundaries live here by design: directories never carry a recursive
 * size, and every fallible operation answers with a coded FsResult instead
 * of throwing across IPC — the UI phrases each code per locale.
 */

/** Why a file operation failed; the UI maps these to localized messages. */
export type FileErrorCode =
  /** The path does not exist (or was deleted mid-session). */
  | "not-found"
  /** A directory was expected (or a file operation hit a directory). */
  | "not-a-directory"
  /** The OS refused access. */
  | "permission"
  /** The file is past the preview cap; the UI says so instead of hanging. */
  | "too-large"
  /** The bytes are not decodable text (images and binaries take another route). */
  | "binary"
  /** The operation is meaningless here — e.g. a relative path across Windows drives. */
  | "unsupported"
  /** Anything else, with the OS message attached. */
  | "unknown";

export interface FileError {
  code: FileErrorCode;
  /** Raw OS message; only set for "unknown", as detail under the localized line. */
  message?: string;
}

export type FsResult<T> = { ok: true; value: T } | { ok: false; error: FileError };

/** One entry of a directory listing. */
export interface FileEntry {
  name: string;
  /**
   * Absolute path as listed. A symlink keeps its own path — never the
   * resolved target — so what the user right-clicked is what they copy.
   */
  path: string;
  isDir: boolean;
  /** The entry itself is a symlink; its target is not resolved for display. */
  isSymlink: boolean;
  /** Bytes for files; null for directories (never computed recursively). */
  size: number | null;
  /** mtime in epoch ms; null when the OS would not tell us. */
  mtime: number | null;
  /** Dot-prefixed name; hidden files get their own filter in the UI. */
  hidden: boolean;
}

export interface DirListing {
  /** The directory that was listed, normalized absolute. */
  path: string;
  entries: FileEntry[];
  /** True when the listing stopped at the entry cap (giant folder). */
  capped: boolean;
}

export interface FileStat {
  path: string;
  /** False (with ok:true) when the path is gone — a deleted file is a state, not an error. */
  exists: boolean;
  isDir: boolean;
  isSymlink: boolean;
  /** Bytes for files; null for directories. */
  size: number | null;
  mtime: number | null;
  hidden: boolean;
  /** Direct children count for directories; null for files or unreadable dirs. */
  childCount: number | null;
}

/** A bounded read of a text-like file for the preview pane. */
export interface TextPreview {
  path: string;
  text: string;
  /** The read stopped at the cap; the rest of the file is not shown. */
  truncated: boolean;
  /** Full file size in bytes, so the UI can say what was cut. */
  bytes: number;
}

/** A bounded read of an image, as a data URL the <img> can show directly. */
export interface ImagePreview {
  path: string;
  dataUrl: string;
  bytes: number;
}

export interface SearchOptions {
  /** Include dot-prefixed entries in matches (default false). */
  includeHidden?: boolean;
  /** Result cap (default 50, hard max 200). */
  limit?: number;
}
