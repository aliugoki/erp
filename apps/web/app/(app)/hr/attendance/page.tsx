'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Save } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { AttendanceDayRow, AttendanceSummaryRow } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { HrTabs } from '@/components/hr/hr-tabs';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY'];
const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  PRESENT: 'success', ABSENT: 'destructive', LEAVE: 'warning', HALF_DAY: 'secondary',
};
const today = () => new Date().toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AttendancePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [year, setYear] = useState('2026');
  const [month, setMonth] = useState('6');

  const day = useQuery({ queryKey: ['attendance-day', date], queryFn: () => apiGet<AttendanceDayRow[]>(`/hr/attendance-day?date=${date}`) });
  const summary = useQuery({
    queryKey: ['attendance-summary', year, month],
    queryFn: () => apiGet<AttendanceSummaryRow[]>(`/hr/attendance-summary?year=${year}&month=${month}`),
  });

  // Seed the editable draft from whatever is already logged for the day.
  useEffect(() => {
    if (day.data) setDraft(Object.fromEntries(day.data.map((r) => [r.employeeId, r.status ?? 'PRESENT'])));
  }, [day.data]);

  const save = useMutation({
    mutationFn: () =>
      apiPost('/hr/attendance-bulk', {
        date,
        entries: Object.entries(draft).map(([employeeId, status]) => ({ employeeId, status })),
      }),
    onSuccess: () => {
      toast.success('Attendance saved', { description: date });
      qc.invalidateQueries({ queryKey: ['attendance-day', date] });
      qc.invalidateQueries({ queryKey: ['attendance-summary'] });
    },
    onError: (e) => toast.error('Could not save', { description: e instanceof ApiError ? e.message : '' }),
  });

  const rows = day.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="Human Resources" description="Log daily attendance — it feeds payroll proration." />
      <HrTabs />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-muted-foreground" />
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>
            <Button size="sm" disabled={save.isPending || rows.length === 0} onClick={() => save.mutate()}>
              <Save className="size-4" /> {save.isPending ? 'Saving…' : 'Save day'}
            </Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{r.employeeCode}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <Select value={draft[r.employeeId] ?? 'PRESENT'} onValueChange={(v) => setDraft((s) => ({ ...s, [r.employeeId]: v }))}>
                      <SelectTrigger className="ml-auto h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No active employees.</p> : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b p-4">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{['2025', '2026', '2027'].map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">monthly summary</span>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">P</TableHead><TableHead className="text-right">½</TableHead><TableHead className="text-right">L</TableHead><TableHead className="text-right">A</TableHead><TableHead className="text-right">Payable</TableHead></TableRow></TableHeader>
            <TableBody>
              {(summary.data ?? []).map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell className="text-right tabular-nums"><Badge variant={STATUS_VARIANT.PRESENT} className="text-[10px]">{r.present}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.halfDay}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.leave}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{r.absent}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{r.payableDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
