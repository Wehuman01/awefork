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

/** Compact age of a timestamp for sidebar rows: 刚刚 / 5分钟前 / 3小时前 / 2天前. */
export function relTime(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}个月前`;
}

/** Last two segments of a directory for compact display ("/" and "\\" both split). */
export function shortPath(directory: string): string {
  const parts = directory.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || directory || "…";
}
