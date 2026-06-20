'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { AttendanceDayRow, AttendanceSummaryRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { HrStatusBadge, MONTHS } from './hr-ui';

const STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY'];
const today = () => new Date().toISOString().slice(0, 10);

interface DraftRow { status: string; late: boolean; checkIn: string; checkOut: string }

export function AttendancePanel() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));

  const day = useQuery({ queryKey: ['attendance-day', date], queryFn: () => apiGet<AttendanceDayRow[]>(`/hr/attendance-day?date=${date}`) });
  const summary = useQuery({ queryKey: ['attendance-summary', year, month], queryFn: () => apiGet<AttendanceSummaryRow[]>(`/hr/attendance-summary?year=${year}&month=${month}`) });

  useEffect(() => {
    if (day.data) {
      setDraft(Object.fromEntries(day.data.map((r) => [r.employeeId, { status: r.status ?? 'PRESENT', late: r.late ?? false, checkIn: r.checkIn ?? '', checkOut: r.checkOut ?? '' }])));
    }
  }, [day.data]);

  const setRow = (id: string, patch: Partial<DraftRow>) => setDraft((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const save = useMutation({
    mutationFn: () => apiPost('/hr/attendance-bulk', {
      date: new Date(date).toISOString(),
      entries: Object.entries(draft).map(([employeeId, d]) => ({
        employeeId,
        status: d.status,
        late: d.late,
        checkIn: d.checkIn ? new Date(`${date}T${d.checkIn}:00`).toISOString() : undefined,
        checkOut: d.checkOut ? new Date(`${date}T${d.checkOut}:00`).toISOString() : undefined,
      })),
    }),
    onSuccess: () => { toast.success('Attendance saved', { description: date }); void qc.invalidateQueries({ queryKey: ['attendance-day', date] }); void qc.invalidateQueries({ queryKey: ['attendance-summary'] }); },
    onError: onErr,
  });

  const rows = day.data ?? [];

  return (
    <>
      <PaneHeader>
        <CalendarCheck className="size-4 shrink-0 text-muted-foreground" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" />
        <div className="ml-auto flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {['2024', '2025', '2026', '2027'].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily grid</h3>
            <Button size="sm" disabled={save.isPending || rows.length === 0} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save day
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-center">Late</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const d = draft[r.employeeId] ?? { status: 'PRESENT', late: false, checkIn: '', checkOut: '' };
                  return (
                    <tr key={r.employeeId}>
                      <td className="px-3 py-2"><p className="font-medium">{r.employeeName}</p><p className="font-mono text-xs text-muted-foreground">{r.employeeCode}</p></td>
                      <td className="px-3 py-2">
                        <select value={d.status} onChange={(e) => setRow(r.employeeId, { status: e.target.value })} className="h-8 w-28 rounded-md border bg-background px-2 text-sm">
                          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center"><input type="checkbox" checked={d.late} onChange={(e) => setRow(r.employeeId, { late: e.target.checked })} className="h-4 w-4 align-middle" /></td>
                      <td className="px-3 py-2"><Input type="time" value={d.checkIn} onChange={(e) => setRow(r.employeeId, { checkIn: e.target.value })} className="h-8 w-28" /></td>
                      <td className="px-3 py-2"><Input type="time" value={d.checkOut} onChange={(e) => setRow(r.employeeId, { checkOut: e.target.value })} className="h-8 w-28" /></td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No active employees.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly summary · {MONTHS[Number(month) - 1]} {year}</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Present</th><th className="px-3 py-2 text-right">Half</th><th className="px-3 py-2 text-right">Leave</th><th className="px-3 py-2 text-right">Absent</th><th className="px-3 py-2 text-right">Payable days</th></tr></thead>
              <tbody className="divide-y">
                {(summary.data ?? []).map((r) => (
                  <tr key={r.employeeId}>
                    <td className="px-3 py-2 font-medium">{r.employeeName}</td>
                    <td className="px-3 py-2 text-right"><HrStatusBadge status="PRESENT" /> <span className="tabular-nums">{r.present}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.halfDay}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.leave}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">{r.absent}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.payableDays}</td>
                  </tr>
                ))}
                {(summary.data ?? []).length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No data for this period.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </PaneBody>
    </>
  );
}
