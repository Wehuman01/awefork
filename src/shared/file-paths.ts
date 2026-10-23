/**
 * Pure path-string helpers for the file browser's UI: breadcrumb segments,
 * display names, and the "same path" test. No Node `path` here — this
 * module is imported by the renderer, where the platform path library
 * does not exist. Anything that must be platform-exact (relative paths
 * against the project root, joins for the OS) is computed in the main
 * process instead.
 */

/** True when the path uses a Windows drive prefix ("C:\…" or "C:/…"). */
export function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Split an absolute path into breadcrumb segments: "/a/b" → ["/", "a", "b"]
 * and "C:\a\b" → ["C:", "a", "b"]. Either separator splits, so a pasted
 * "C:/a/b" still works. joinSegments(segments) rebuilds the original.
 */
export function pathSegments(value: string): string[] {
  const body = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = body.split("/").filter((part) => part !== "");
  if (parts.length === 0) return [isWindowsPath(value) ? value.slice(0, 2) : "/"];
  if (body.startsWith("//")) {
    // UNC: \\server\share is the root crumb, not two levels of hierarchy.
    const [server, share] = parts;
    return [`\\\\${server}\\${share ?? ""}`, ...parts.slice(2)];
  }
  if (isWindowsPath(value)) {
    // "C:/a/b" → parts ["C:", "a", "b"]; the drive letter is its own crumb.
    const [drive, ...rest] = parts;
    return [drive ?? "", ...rest];
  }
  // POSIX: the leading slash is the root crumb, not an empty segment.
  return ["/", ...parts];
}

/** Rebuild a path from pathSegments output. */
export function joinSegments(segments: readonly string[]): string {
  const root = segments[0];
  if (root === undefined) return "";
  const rest = segments.slice(1);
  if (root.startsWith("\\\\") || isWindowsPath(`${root}\\`)) return [root, ...rest].join("\\");
  return rest.length === 0 ? root : `${root}${rest.join("/")}`;
}

/** The parent directory, or null when the path is already a filesystem root. */
export function parentOf(value: string): string | null {
  const segments = pathSegments(value);
  return segments.length <= 1 ? null : joinSegments(segments.slice(0, -1));
}

/** The last segment, or the root marker for a bare root path. */
export function displayName(value: string): string {
  const segments = pathSegments(value);
  return segments[segments.length - 1] ?? value;
}

/**
 * Same path, tolerating a trailing separator and (on Windows) drive-letter
 * case — enough for "am I already browsing this directory" checks. Anything
 * stricter (symlinks, "..", 8.3 names) is the main process's job.
 */
export function samePath(a: string, b: string): boolean {
  const trim = (value: string): string => {
    const cut = value.length > 1 ? value.replace(/[\\/]+$/, "") : value;
    return isWindowsPath(cut) ? cut.toLowerCase() : cut;
  };
  return trim(a) === trim(b);
}

/** True for a name the OS treats as hidden (dot-prefixed on POSIX and macOS). */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/**
 * True for an absolute path on either platform: "/x", "C:\x" or a UNC
 * "\\server\share". A relative string ("docs", "~") is not one — the path
 * input must not silently root it at "/".
 */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || isWindowsPath(value);
}
