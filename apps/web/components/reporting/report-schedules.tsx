'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, Mail, Play, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { ReportPreset, ReportSchedule, SavedReport } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORMATS = ['pdf', 'xlsx', 'csv'] as const;

function cadenceText(s: ReportSchedule): string {
  const t = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} UTC`;
  if (s.frequency === 'weekly') return `Weekly · ${DOW[s.dayOfWeek ?? 1]} ${t}`;
  if (s.frequency === 'monthly') return `Monthly · day ${s.dayOfMonth ?? 1} ${t}`;
  return `Daily · ${t}`;
}

const emptyForm = {
  name: '',
  source: '', // "preset:<key>" | "custom:<id>"
  format: 'pdf' as (typeof FORMATS)[number],
  recipients: '',
  frequency: 'daily' as ReportSchedule['frequency'],
  hour: 8,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
};

export function ReportSchedules() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const schedules = useQuery({ queryKey: ['report-schedules'], queryFn: () => apiGet<ReportSchedule[]>('/reports/schedules') });
  const presets = useQuery({ queryKey: ['rb-presets'], queryFn: () => apiGet<ReportPreset[]>('/reports/builder/presets') });
  const saved = useQuery({ queryKey: ['rb-saved'], queryFn: () => apiGet<SavedReport[]>('/reports/builder/custom') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });

  const create = useMutation({
    mutationFn: () => {
      const [kind, ...rest] = form.source.split(':');
      const id = rest.join(':');
      const recipients = form.recipients.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        format: form.format,
        recipients,
        frequency: form.frequency,
        hour: Number(form.hour),
        minute: Number(form.minute),
        ...(form.frequency === 'weekly' ? { dayOfWeek: Number(form.dayOfWeek) } : {}),
        ...(form.frequency === 'monthly' ? { dayOfMonth: Number(form.dayOfMonth) } : {}),
        ...(kind === 'preset' ? { presetKey: id } : { reportId: id }),
      };
      return apiPost('/reports/schedules', body);
    },
    onSuccess: () => { toast.success('Schedule created'); setForm(emptyForm); setOpen(false); invalidate(); },
    onError: (e) => toast.error('Could not create schedule', { description: e instanceof ApiError ? e.message : '' }),
  });

  const toggle = useMutation({
    mutationFn: (s: ReportSchedule) => apiPatch(`/reports/schedules/${s.id}`, { enabled: !s.enabled }),
    onSuccess: invalidate,
  });
  const del = useMutation({ mutationFn: (id: string) => apiDelete(`/reports/schedules/${id}`), onSuccess: invalidate });
  const run = useMutation({
    mutationFn: (id: string) => apiPost<{ delivered: number; bytes: number; format: string }>(`/reports/schedules/${id}/run`),
    onSuccess: (r) => { invalidate(); toast.success(r.delivered ? `Sent to ${r.delivered} recipient(s)` : 'Rendered (no recipients)', { description: `${r.format.toUpperCase()} · ${(r.bytes / 1024).toFixed(1)} KB` }); },
    onError: (e) => toast.error('Run failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  const rows = schedules.data ?? [];
  const valid = form.name.trim() && form.source && form.recipients.trim();

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium"><CalendarClock className="size-4" /> Scheduled reports</p>
        <Button size="sm" variant={open ? 'secondary' : 'default'} onClick={() => setOpen((o) => !o)}><Plus className="size-4" /> New schedule</Button>
      </div>

      {open ? (
        <div className="mb-4 grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input className="h-9" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Weekly stock list" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Report</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Pick a report" /></SelectTrigger>
              <SelectContent>
                {(presets.data ?? []).map((p) => <SelectItem key={`preset:${p.key}`} value={`preset:${p.key}`}>{p.name}</SelectItem>)}
                {(saved.data ?? []).map((s) => <SelectItem key={`custom:${s.id}`} value={`custom:${s.id}`}>★ {s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Format</Label>
            <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v as (typeof FORMATS)[number] })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{FORMATS.map((f) => <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs">Recipients (comma-separated)</Label>
            <Input className="h-9" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} placeholder="ops@acme.test, finance@acme.test" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Frequency</Label>
            <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as ReportSchedule['frequency'] })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Time (UTC)</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={23} className="h-9 w-16" value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} />
                <span>:</span>
                <Input type="number" min={0} max={59} className="h-9 w-16" value={form.minute} onChange={(e) => setForm({ ...form, minute: Number(e.target.value) })} />
              </div>
            </div>
            {form.frequency === 'weekly' ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Day</Label>
                <Select value={String(form.dayOfWeek)} onValueChange={(v) => setForm({ ...form, dayOfWeek: Number(v) })}>
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{DOW.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : null}
            {form.frequency === 'monthly' ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Day of month</Label>
                <Input type="number" min={1} max={28} className="h-9 w-20" value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })} />
              </div>
            ) : null}
          </div>
          <div className="flex items-end lg:col-span-3">
            <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />} Create schedule
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No schedules yet. Create one to email a report automatically.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{s.name}</span>
                <Badge variant="secondary" className="ml-2 uppercase">{s.format}</Badge>
                <span className="ml-2 text-xs text-muted-foreground">{cadenceText(s)} · next {new Date(s.nextRunAt).toLocaleString()}</span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3" /> {s.recipients.join(', ') || '—'}</div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={s.enabled} onCheckedChange={() => toggle.mutate(s)} />
                <Button size="sm" variant="outline" className="h-8" disabled={run.isPending} onClick={() => run.mutate(s.id)}><Play className="size-3.5" /> Run now</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-destructive" onClick={() => del.mutate(s.id)}><Trash2 className="size-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
