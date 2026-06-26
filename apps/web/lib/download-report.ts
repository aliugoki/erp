import { apiDownloadBlob } from '@/lib/api';

export type ReportFormat = 'pdf' | 'xlsx' | 'csv';
const EXT: Record<ReportFormat, string> = { pdf: 'pdf', xlsx: 'xlsx', csv: 'csv' };

function slugify(s: string): string {
  return (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
}

/** Re-fetch a report run as a downloadable file and trigger a browser save. `path` may already carry
 * a query string (e.g. a date range); the `format` param is appended with the right separator. */
export async function downloadReport(
  spec: { method?: 'GET' | 'POST'; path: string; body?: unknown; title: string },
  format: ReportFormat,
): Promise<void> {
  const sep = spec.path.includes('?') ? '&' : '?';
  const init: RequestInit =
    spec.method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec.body) }
      : { method: 'GET' };
  const blob = await apiDownloadBlob(`${spec.path}${sep}format=${format}`, init);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(spec.title)}.${EXT[format]}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
