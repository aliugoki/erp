'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Play, Save, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { ReportDataset, ReportPreset, ReportResult, SavedReport } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const NONE = '__none__';

export default function ReportingPage() {
  const qc = useQueryClient();
  const [source, setSource] = useState('');
  const [cols, setCols] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState(NONE);
  const [name, setName] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [title, setTitle] = useState('');

  const datasets = useQuery({ queryKey: ['rb-datasets'], queryFn: () => apiGet<ReportDataset[]>('/reports/builder/datasets') });
  const presets = useQuery({ queryKey: ['rb-presets'], queryFn: () => apiGet<ReportPreset[]>('/reports/builder/presets') });
  const saved = useQuery({ queryKey: ['rb-saved'], queryFn: () => apiGet<SavedReport[]>('/reports/builder/custom') });

  const ds = datasets.data?.find((d) => d.key === source);

  const show = (t: string) => (r: ReportResult) => { setResult(r); setTitle(t); };
  const fail = (e: unknown) => toast.error('Report failed', { description: e instanceof ApiError ? e.message : '' });

  const runAdHoc = useMutation({
    mutationFn: () => apiPost<ReportResult>('/reports/builder/run', { source, columns: cols, groupBy: groupBy === NONE ? undefined : groupBy }),
    onSuccess: show('Ad-hoc report'), onError: fail,
  });
  const runPreset = useMutation({ mutationFn: (p: ReportPreset) => apiGet<ReportResult>(`/reports/builder/presets/${p.key}/run`), onSuccess: () => {}, onError: fail });
  const runSaved = useMutation({ mutationFn: (r: SavedReport) => apiGet<ReportResult>(`/reports/builder/custom/${r.id}/run`), onError: fail });
  const create = useMutation({
    mutationFn: () => apiPost('/reports/builder/custom', { name, source, columns: cols, groupBy: groupBy === NONE ? undefined : groupBy }),
    onSuccess: () => { toast.success('Report saved', { description: name }); qc.invalidateQueries({ queryKey: ['rb-saved'] }); setName(''); },
    onError: fail,
  });
  const del = useMutation({ mutationFn: (id: string) => apiDelete(`/reports/builder/custom/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['rb-saved'] }) });

  const toggleCol = (key: string) => setCols((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Reporting" description="Preset reports and a custom report builder." />

      <Card className="p-4">
        <p className="mb-3 flex items-center gap-2 font-medium"><BarChart3 className="size-4" /> Preset reports</p>
        <div className="flex flex-wrap gap-2">
          {(presets.data ?? []).map((p) => (
            <Button key={p.key} variant="outline" size="sm"
              onClick={() => runPreset.mutate(p, { onSuccess: show(p.name) })}>
              {p.name}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-3 font-medium">Build a custom report</p>
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Data source</Label>
              <Select value={source} onValueChange={(v) => { setSource(v); setCols([]); setGroupBy(NONE); }}>
                <SelectTrigger><SelectValue placeholder="Select dataset" /></SelectTrigger>
                <SelectContent>{(datasets.data ?? []).map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {ds && ds.groupable.length > 0 ? (
              <div className="space-y-2">
                <Label>Group by</Label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No grouping (list)</SelectItem>
                    {ds.groupable.map((g) => <SelectItem key={g} value={g}>{ds.columns.find((c) => c.key === g)?.label ?? g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {ds && groupBy === NONE ? (
              <div className="space-y-2">
                <Label>Columns</Label>
                <div className="space-y-1 rounded-lg border p-2">
                  {ds.columns.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" disabled={!source || runAdHoc.isPending} onClick={() => runAdHoc.mutate()}><Play className="size-4" /> Run</Button>
            </div>
            <div className="flex gap-2 border-t pt-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Save as…" className="h-9" />
              <Button size="sm" variant="outline" disabled={!source || !name.trim() || create.isPending} onClick={() => create.mutate()}><Save className="size-4" /></Button>
            </div>
          </div>

          <div className="min-w-0">
            {result ? (
              <Card className="overflow-x-auto">
                <p className="border-b p-3 text-sm font-medium">{title} <Badge variant="secondary" className="ml-2">{result.rows.length} rows</Badge></p>
                <Table>
                  <TableHeader><TableRow>{result.columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {result.rows.map((row, i) => (
                      <TableRow key={i}>
                        {result.columns.map((c) => (
                          <TableCell key={c.key} className="tabular-nums">
                            {c.money ? formatMoney(Number(row[c.key] ?? 0), 'PKR') : String(row[c.key] ?? '—')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {result.rows.length === 0 ? <TableRow><TableCell colSpan={result.columns.length} className="text-sm text-muted-foreground">No data.</TableCell></TableRow> : null}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
                Run a preset or build a report to see results.
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-3 font-medium">Saved reports</p>
        {(saved.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved reports yet — build one and click save.</p>
        ) : (
          <ul className="space-y-2">
            {(saved.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground">· {r.source}{r.groupBy ? ` · by ${r.groupBy}` : ''}</span></span>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => runSaved.mutate(r, { onSuccess: show(r.name) })}><Play className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => del.mutate(r.id)}><Trash2 className="size-3.5" /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
