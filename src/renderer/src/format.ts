import { t } from "./i18n";

/** Compact render of a run's wall time: 4.2s / 2m05s / 1h30m. */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m${restSeconds.toString().padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${(minutes % 60).toString().padStart(2, "0")}m`;
}

/** Compact render of an output-token count: 830 tok / 12.4k tok. */
export function formatTokens(count: number): string {
  if (count < 1000) return `${count} tok`;
  return `${(count / 1000).toFixed(1)}k tok`;
}

/**
 * Compact unitless token count for the composer's context meter:
 * 830 / 12.4k / 182k / 1M. Trailing ".0" is dropped so 1.0M reads 1M.
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  const compact = (value: number): string => `${Number(value.toFixed(1))}`;
  if (count < 1_000_000) return `${compact(count / 1000)}k`;
  return `${compact(count / 1_000_000)}M`;
}

/** Compact age of a timestamp for sidebar rows: just now / 5 min ago / 3 h ago / 2 d ago. */
export function relTime(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return t("format.justNow");
  if (minutes < 60) return t("format.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("format.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("format.daysAgo", { n: days });
  return t("format.monthsAgo", { n: Math.floor(days / 30) });
}

/** Last two segments of a directory for compact display ("/" and "\\" both split). */
export function shortPath(directory: string): string {
  const parts = directory.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || directory || "…";
}

/** File size for the file browser: 812 B / 4.2 KB / 1.1 MB (binary units). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Absolute timestamp for the file browser's info dialog (locale-formatted). */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
