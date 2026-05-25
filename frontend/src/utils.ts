/** Parse a server timestamp as UTC regardless of whether it carries a Z suffix. */
export function utcMs(ts: string): number {
  return new Date(
    ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z",
  ).getTime();
}

export function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0 || !isFinite(bytesPerSec)) return "—";
  if (bytesPerSec >= 1024 * 1024 * 1024)
    return `${(bytesPerSec / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
  if (bytesPerSec >= 1024 * 1024)
    return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  // Append Z if no timezone marker so the browser treats it as UTC, not local time.
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(utc).toLocaleString();
}
