/**
 * Splitting an arriving drop or paste batch: directories become absolute
 * path text, everything else stays a file for attachment staging. Pure, so
 * the rule stays testable — telling a directory from a file (the DOM half)
 * is the caller's job.
 */
import { joinPaths } from "./path-insert";

/** One item arriving from a drop or a paste. */
export interface ArrivingItem {
  file: File;
  /** What the OS said: true/false, or null when it would not say. */
  isDirectory: boolean | null;
}

export interface SplitArriving {
  /** Absolute paths of the directories, one per line; "" when there are none. */
  pathText: string;
  /** Everything else, still bound for attachment staging. */
  files: File[];
}

/**
 * A directory whose real path the bridge cannot name stays a file: it then
 * takes the ordinary attachment route, with its honest notice, rather than
 * inventing a path.
 */
export function splitArrivingItems(
  items: readonly ArrivingItem[],
  resolvePath: (file: File) => string | null,
): SplitArriving {
  const folders: string[] = [];
  const files: File[] = [];
  for (const item of items) {
    const path = item.isDirectory === true ? resolvePath(item.file) : null;
    if (path !== null && path !== "") folders.push(path);
    else files.push(item.file);
  }
  return { pathText: joinPaths(folders), files };
}
