'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiPatch } from '@/lib/api';
import type { AssetCategory } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { AssetBadge } from './asset-ui';

export function CategoryDetail({ category, onBack, onDeleted }: { category: AssetCategory; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', method: 'STRAIGHT_LINE', usefulLifeMonths: '', salvagePct: '', status: 'ACTIVE' });

  useEffect(() => {
    setF({
      name: category.name,
      code: category.code ?? '',
      method: category.method,
      usefulLifeMonths: String(category.usefulLifeMonths),
      salvagePct: String(category.salvagePct),
      status: category.status,
    });
  }, [category]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['asset-categories'] }); };

  const save = useMutation({
    mutationFn: () => apiPatch(`/assets/categories/${category.id}`, {
      name: f.name,
      code: f.code || undefined,
      method: f.method,
      usefulLifeMonths: Number(f.usefulLifeMonths),
      salvagePct: Number(f.salvagePct),
      status: f.status,
    }),
    onSuccess: () => { toast.success('Category saved'); invalidate(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/assets/categories/${category.id}`),
    onSuccess: () => { toast.success('Category deleted'); invalidate(); onDeleted?.(); },
    onError: onErr,
  });

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{category.name}</span>
          <AssetBadge status={category.status} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this category?')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
          <Field label="Code"><Input value={f.code} onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))} /></Field>
          <Field label="Method">
            <select value={f.method} onChange={(e) => setF((s) => ({ ...s, method: e.target.value }))} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="STRAIGHT_LINE">Straight line</option>
              <option value="DECLINING_BALANCE">Declining balance</option>
              <option value="NONE">No depreciation</option>
            </select>
          </Field>
          <Field label="Useful life (months)"><Input value={f.usefulLifeMonths} onChange={(e) => setF((s) => ({ ...s, usefulLifeMonths: e.target.value }))} type="number" min={0} /></Field>
          <Field label="Salvage %"><Input value={f.salvagePct} onChange={(e) => setF((s) => ({ ...s, salvagePct: e.target.value }))} type="number" min={0} max={100} /></Field>
          <Field label="Status">
            <select value={f.status} onChange={(e) => setF((s) => ({ ...s, status: e.target.value }))} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
          <div className="col-span-2"><Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
