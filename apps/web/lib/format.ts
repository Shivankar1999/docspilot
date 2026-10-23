// Number and date formatting shared by dashboard pages. Dates are formatted in UTC
// so server and browser render identical text (usage days are UTC days).

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US');

export const formatCompact = (n: number) => compact.format(n);
export const formatNumber = (n: number) => whole.format(n);

/** $0.0042 for tiny amounts (typical per-day AI spend), $12.50 otherwise. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';
  return `$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "2026-10-03" or an ISO timestamp → "Oct 3". */
export function formatShortDate(date: string): string {
  const value = date.length === 10 ? `${date}T00:00:00Z` : date;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}
