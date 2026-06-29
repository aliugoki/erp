'use client';
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, ScrollText, ShieldAlert, X } from 'lucide-react';
import { apiList } from '@/lib/api';
import type { AuditLogEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ANY = '__any__';
const ACTIONS = ['POST', 'PATCH', 'PUT', 'DELETE'];
const ACTION_TONE: Record<string, string> = {
  POST: 'bg-success/10 text-success',
  PATCH: 'bg-warning/10 text-warning',
  PUT: 'bg-warning/10 text-warning',
  DELETE: 'bg-destructive/10 text-destructive',
};

function qs(o: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function Json({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <pre className="max-h-60 overflow-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AuditLogPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const pageSize = 25;
  const hasFilter = !!(from || to || action || resource);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-logs', from, to, action, resource, page],
    queryFn: () => apiList<AuditLogEntry>(`/audit/logs${qs({ from, to, action, resource, page, pageSize })}`),
    staleTime: 15_000,
  });
  const rows = data?.data ?? [];
  const total = data?.meta.pagination.total ?? 0;
  const totalPages = data?.meta.pagination.totalPages ?? 1;

  const reset = () => { setFrom(''); setTo(''); setAction(''); setResource(''); setPage(1); };
  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="size-5 text-primary" />
        <div>
          <h2 className="font-semibold">Audit log</h2>
          <p className="text-xs text-muted-foreground">Tenant-scoped trail of changes — who did what, when, from where.</p>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{total.toLocaleString()} entries</span>
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5"><Label className="text-xs">From</Label>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => set(setFrom)(e.target.value)} className="h-9" /></div>
        <div className="space-y-1.5"><Label className="text-xs">To</Label>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => set(setTo)(e.target.value)} className="h-9" /></div>
        <div className="space-y-1.5"><Label className="text-xs">Action</Label>
          <Select value={action || ANY} onValueChange={(v) => set(setAction)(v === ANY ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ANY}>Any</SelectItem>{ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label className="text-xs">Resource</Label>
          <Input value={resource} onChange={(e) => set(setResource)(e.target.value)} placeholder="/finance/invoices" className="h-9" /></div>
        <div className="flex items-end">{hasFilter ? <Button variant="ghost" size="sm" className="h-9" onClick={reset}><X className="size-4" /> Clear</Button> : null}</div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="w-8 px-2 py-2" /><th className="px-3 py-2">When</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Resource</th><th className="px-3 py-2">IP</th></tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={6} className="py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-sm text-muted-foreground"><ShieldAlert className="mx-auto mb-2 size-5 opacity-50" />No audit entries match.</td></tr>
            ) : rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-accent/40" onClick={() => setOpen(isOpen ? null : r.id)}>
                    <td className="px-2 py-2 text-muted-foreground">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.userEmail ?? <span className="text-muted-foreground">system</span>}</td>
                    <td className="px-3 py-2"><span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', ACTION_TONE[r.action] ?? 'bg-muted text-muted-foreground')}>{r.action}</span></td>
                    <td className="max-w-[22rem] truncate px-3 py-2 font-mono text-xs">{r.resource}{r.resourceId ? <span className="text-muted-foreground"> · {r.resourceId.slice(0, 8)}</span> : null}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.ipAddress ?? '—'}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="bg-muted/20">
                      <td />
                      <td colSpan={5} className="px-3 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Before</p><Json value={r.oldValue} /></div>
                          <div><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">After</p><Json value={r.newValue} /></div>
                        </div>
                        {r.traceId ? <p className="mt-2 text-xs text-muted-foreground">trace: <span className="font-mono">{r.traceId}</span></p> : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{isFetching ? 'Loading…' : `Page ${page} of ${totalPages}`}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
