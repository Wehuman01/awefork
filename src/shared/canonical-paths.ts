import { realpath } from "node:fs/promises";
import type { SessionSummary } from "./types.js";

/**
 * Directory canonicalization for everything that groups or matches sessions
 * by path. The classic trap is macOS reporting one project as /var/folders/…
 * and another as /private/var/folders/… — the same directory under a symlinked
 * prefix — which splits sidebar groups and silently unhides archives. Rules:
 * resolve each distinct path exactly once per listing (never per row), and a
 * path that no longer resolves (deleted project) keeps its string as-is.
 * `resolve` is injectable so tests can play a symlinked filesystem.
 */
export type RealpathFn = (path: string) => Promise<string>;

/** Original → canonical for every distinct directory in the input. */
export async function canonicalDirectories(
  directories: Iterable<string>,
  resolve: RealpathFn = realpath,
): Promise<Map<string, string>> {
  const distinct = [...new Set(directories)];
  const map = new Map<string, string>();
  await Promise.all(
    distinct.map(async (dir) => {
      try {
        map.set(dir, await resolve(dir));
      } catch {
        map.set(dir, dir);
      }
    }),
  );
  return map;
}

/** Rewrite session rows onto their canonical directories, one realpath each. */
export async function canonicalizeSessionDirectories(
  sessions: SessionSummary[],
  resolve: RealpathFn = realpath,
): Promise<SessionSummary[]> {
  const map = await canonicalDirectories(
    sessions.map((s) => s.directory),
    resolve,
  );
  return sessions.map((session) => {
    const canonical = map.get(session.directory);
    return canonical !== undefined && canonical !== session.directory
      ? { ...session, directory: canonical }
      : session;
  });
}

/** Canonicalize one path (a hand-added directory, an archive key). */
export async function canonicalDirectory(
  dir: string,
  resolve: RealpathFn = realpath,
): Promise<string> {
  try {
    return await resolve(dir);
  } catch {
    return dir;
  }
}
