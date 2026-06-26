import { formatMoney } from '@/lib/utils';

interface Col {
  key: string;
  label: string;
  money?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Open a clean, print-styled window for any report result and trigger the browser print dialog.
 * Works regardless of on-screen layout — the report is rendered standalone. */
export function printReport(title: string, columns: Col[], rows: Record<string, unknown>[], currency = 'PKR'): void {
  const head = columns.map((c) => `<th class="${c.money ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const bodyRows = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => {
            const raw = r[c.key];
            const text = c.money ? formatMoney(Number(raw ?? 0), currency) : esc(String(raw ?? '—'));
            return `<td class="${c.money ? 'num' : ''}">${text}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box}
    body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;margin:32px}
    h1{font-size:20px;margin:0 0 2px}
    .meta{color:#64748b;font-size:12px;margin:0 0 18px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:7px 10px;text-align:left;border-bottom:1px solid #e2e8f0}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f8fafc}
    td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
    tbody tr:nth-child(even){background:#fafafa}
    @media print{body{margin:12mm} thead{display:table-header-group}}
  </style></head><body>
    <h1>${esc(title)}</h1>
    <p class="meta">${rows.length} row${rows.length === 1 ? '' : 's'} · generated ${esc(new Date().toLocaleString())}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${bodyRows || `<tr><td colspan="${columns.length}">No data.</td></tr>`}</tbody></table>
  </body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}
