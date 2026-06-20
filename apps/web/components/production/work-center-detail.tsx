'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiPatch } from '@/lib/api';
import type { WorkCenter } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ProdBadge } from './prod-ui';

export function WorkCenterDetail({ workCenter, onBack, onDeleted }: { workCenter: WorkCenter; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', costPerHour: '', status: 'ACTIVE', notes: '' });

  useEffect(() => {
    setF({ name: workCenter.name, code: workCenter.code ?? '', costPerHour: String(workCenter.costPerHour.amountMinor / 100), status: workCenter.status, notes: workCenter.notes ?? '' });
  }, [workCenter]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['prod-work-centers'] }); };

  const save = useMutation({
    mutationFn: () => apiPatch(`/production/work-centers/${workCenter.id}`, { name: f.name, code: f.code || undefined, costPerHourMinor: Math.round(Number(f.costPerHour) * 100), status: f.status, notes: f.notes || undefined }),
    onSuccess: () => { toast.success('Work center saved'); invalidate(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/production/work-centers/${workCenter.id}`),
    onSuccess: () => { toast.success('Work center deleted'); invalidate(); onDeleted?.(); },
    onError: onErr,
  });

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{workCenter.name}</span>
          <ProdBadge status={workCenter.status} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this work center?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Code"><Input value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))} /></Field>
          <Field label="Cost / hour"><Input value={f.costPerHour} onChange={(e) => setF((s) => ({ ...s, costPerHour: e.target.value }))} type="number" min={0} step="0.01" /></Field>
          <Field label="Status">
            <select value={f.status} onChange={(e) => setF((s) => ({ ...s, status: e.target.value }))} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </Field>
          <Field label="Notes" className="col-span-2"><textarea value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} rows={3} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" /></Field>
          <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
