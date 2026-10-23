/**
 * Read-only local file access for the renderer's file browser: directory
 * listings, metadata, bounded previews, project-relative paths and a
 * project-scoped quick search.
 *
 * Boundaries the handoff fixes, enforced here rather than trusted to the
 * renderer: nothing executes a file, nothing writes, a directory's size is
 * never computed recursively, and a symlink keeps the path the user clicked
 * (the entry describes the link itself, not its target). Only absolute
 * paths are served; the renderer gets results, never a Node handle.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isHiddenName } from "../shared/file-paths.js";
import type {
  DirListing,
  FileEntry,
  FileError,
  FileStat,
  FsResult,
  ImagePreview,
  SearchOptions,
  TextPreview,
} from "../shared/file-types.js";
import { MAX_ENTRIES } from "../shared/file-types.js";

/** Text previews stop here; the UI says what was cut instead of hanging. */
export const MAX_PREVIEW_BYTES = 512 * 1024;
/** Image previews come back as data URLs, so they get their own smaller cap. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Quick search visits at most this many entries before giving up. */
const SEARCH_BUDGET = 50_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/**
 * Build output and VCS metadata a quick search never descends into — a
 * project's own source is the target, not its dependencies or history.
 */
const SEARCH_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".idea",
  ".vscode",
]);

function ok<T>(value: T): FsResult<T> {
  return { ok: true, value };
}

function fail(error: FileError): FsResult<never> {
  return { ok: false, error };
}

function fsError(error: unknown): FileError {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return { code: "not-found" };
  if (code === "ENOTDIR") return { code: "not-a-directory" };
  if (code === "EACCES" || code === "EPERM") return { code: "permission" };
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Only absolute, NUL-free paths are served. Normalizing here also collapses
 * the ".." a hand-typed path may carry, so listings never walk sideways.
 */
function usablePath(target: unknown): string | null {
  if (typeof target !== "string" || target === "" || target.includes("\0")) return null;
  const normalized = path.normalize(target);
  return path.isAbsolute(normalized) ? normalized : null;
}

async function entryOf(dir: string, name: string): Promise<FileEntry> {
  const entryPath = path.join(dir, name);
  let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    // lstat, not stat: the entry describes the link itself, never the target.
    stat = await fs.lstat(entryPath);
  } catch {
    // An unreadable entry still lists — with null metadata — so the row can
    // say "no access" instead of vanishing from the folder.
  }
  return {
    name,
    path: entryPath,
    isDir: stat?.isDirectory() ?? false,
    isSymlink: stat?.isSymbolicLink() ?? false,
    size: stat?.isFile() ? stat.size : null,
    mtime: stat ? stat.mtimeMs : null,
    hidden: isHiddenName(name),
  };
}

/** Directories first, then files, each case-insensitive by name. */
function byName(a: FileEntry, b: FileEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export async function listDirectory(target: string): Promise<FsResult<DirListing>> {
  const dir = usablePath(target);
  if (!dir) return fail({ code: "unknown", message: "not an absolute path" });
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    return fail(fsError(error));
  }
  const capped = names.length > MAX_ENTRIES;
  const wanted = capped ? names.slice(0, MAX_ENTRIES) : names;
  const entries = await Promise.all(wanted.map((name) => entryOf(dir, name)));
  return ok({ path: dir, entries: entries.sort(byName), capped });
}

export async function statPath(target: string): Promise<FsResult<FileStat>> {
  const file = usablePath(target);
  if (!file) return fail({ code: "unknown", message: "not an absolute path" });
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      // A deleted file is a state the info dialog and preview both show,
      // not a failure of the request.
      return ok({
        path: file,
        exists: false,
        isDir: false,
        isSymlink: false,
        size: null,
        mtime: null,
        hidden: isHiddenName(path.basename(file)),
        childCount: null,
      });
    }
    return fail(fsError(error));
  }
  let childCount: number | null = null;
  if (stat.isDirectory()) {
    try {
      // One level, counted — never a recursive size.
      childCount = (await fs.readdir(file)).length;
    } catch {
      childCount = null;
    }
  }
  return ok({
    path: file,
    exists: true,
    isDir: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
    size: stat.isFile() ? stat.size : null,
    mtime: stat.mtimeMs,
    hidden: isHiddenName(path.basename(file)),
    childCount,
  });
}

/** Binary sniff: a NUL byte in the head means no text preview. */
function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  return head.includes(0);
}

export async function readTextPreview(
  target: string,
  maxBytes: number = MAX_PREVIEW_BYTES,
): Promise<FsResult<TextPreview>> {
  const file = usablePath(target);
  if (!file) return fail({ code: "unknown", message: "not an absolute path" });
  const cap = Math.min(Math.max(Math.trunc(maxBytes) || MAX_PREVIEW_BYTES, 1), MAX_PREVIEW_BYTES);
  let handle: fs.FileHandle | null = null;
  try {
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) return fail({ code: "not-a-directory" });
    handle = await fs.open(file, "r");
    // One byte past the cap tells us the file was longer without reading it all.
    const buffer = Buffer.allocUnsafe(cap + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    if (looksBinary(head)) return fail({ code: "binary" });
    const truncated = bytesRead > cap;
    const text = new TextDecoder("utf-8").decode(truncated ? head.subarray(0, cap) : head);
    return ok({ path: file, text, truncated, bytes: stat.size });
  } catch (error) {
    return fail(fsError(error));
  } finally {
    void handle?.close();
  }
}

export async function readImagePreview(
  target: string,
  maxBytes: number = MAX_IMAGE_BYTES,
): Promise<FsResult<ImagePreview>> {
  const file = usablePath(target);
  if (!file) return fail({ code: "unknown", message: "not an absolute path" });
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) return fail({ code: "unsupported" });
  // The renderer's preference may lower the cap but never raise it: the data
  // URL holds the bytes twice (raw + base64), so MAX_IMAGE_BYTES is the
  // ceiling this process is willing to pay.
  const cap = Math.min(Math.max(Math.trunc(maxBytes) || MAX_IMAGE_BYTES, 1), MAX_IMAGE_BYTES);
  try {
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) return fail({ code: "not-a-directory" });
    if (stat.size > cap) return fail({ code: "too-large" });
    const bytes = await fs.readFile(file);
    return ok({
      path: file,
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      bytes: stat.size,
    });
  } catch (error) {
    return fail(fsError(error));
  }
}

/**
 * The project-relative path behind copy/insert. Equal paths answer "."; a
 * target on another Windows drive answers null — no relative path exists
 * there, and the caller says so instead of inventing one. The result keeps
 * the platform's own separators.
 */
export async function relativeToRoot(
  root: string,
  target: string,
): Promise<FsResult<string | null>> {
  const from = usablePath(root);
  const to = usablePath(target);
  if (!from || !to) return fail({ code: "unknown", message: "not an absolute path" });
  const relative = path.relative(from, to);
  if (relative === "") return ok(".");
  // path.relative falls back to an absolute path across Windows drives;
  // that is not a relative path and must not be handed out as one.
  if (path.isAbsolute(relative)) return ok(null);
  return ok(relative);
}

/**
 * Quick search inside one project root: breadth-first, bounded by an entry
 * budget, skipping build output and VCS metadata. Matches on the file name
 * or its path below the root; hidden entries join only when asked. Used by
 * the quick-open box — never a background index of the whole disk.
 */
export async function searchFiles(
  root: string,
  query: string,
  options: SearchOptions = {},
): Promise<FsResult<FileEntry[]>> {
  const base = usablePath(root);
  const needle = query.trim().toLowerCase();
  if (!base) return fail({ code: "unknown", message: "not an absolute path" });
  if (needle === "") return ok([]);
  const includeHidden = options.includeHidden === true;
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50) || 50, 1), 200);
  const results: FileEntry[] = [];
  const queue: string[] = [base];
  let budget = SEARCH_BUDGET;
  while (queue.length > 0 && results.length < limit && budget > 0) {
    const dir = queue.shift() as string;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      budget -= 1;
      continue;
    }
    for (const name of names) {
      if (budget-- <= 0 || results.length >= limit) break;
      const hidden = isHiddenName(name);
      if (hidden && !includeHidden) continue;
      const entryPath = path.join(dir, name);
      let isDir = false;
      try {
        isDir = (await fs.lstat(entryPath)).isDirectory();
      } catch {
        // A vanishing entry mid-walk simply stops matching; nothing to show.
      }
      // Only directories are skipped — a file named "build" or "out" is a
      // perfectly good search hit.
      if (isDir && SEARCH_SKIP_DIRS.has(name)) continue;
      const relative = path.relative(base, entryPath).toLowerCase();
      const hit = name.toLowerCase().includes(needle) || relative.includes(needle);
      if (isDir) {
        // A matching directory is itself a result (jump straight into it)
        // and stays walkable unless the budget runs out.
        if (hit) results.push(await entryOf(dir, name));
        queue.push(entryPath);
        continue;
      }
      if (hit) results.push(await entryOf(dir, name));
    }
  }
  return ok(results.sort(byName));
}
