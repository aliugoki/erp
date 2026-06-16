'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import type { CustomField } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'];
const EMPTY = { label: '', fieldKey: '', fieldType: 'TEXT', options: '' };

/** Manage the company's custom policy fields — add and remove field definitions. */
export function ManageCustomFieldsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: fields } = useQuery({ queryKey: ['custom-fields'], queryFn: () => apiGet<CustomField[]>('/hr/custom-fields') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/hr/custom-fields', {
        label: f.label,
        fieldKey: f.fieldKey || f.label.toLowerCase().replace(/\s+/g, '_'),
        fieldType: f.fieldType,
        options: f.fieldType === 'SELECT' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      }),
    onSuccess: () => {
      toast.success('Field added', { description: f.label });
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      setF(EMPTY);
    },
    onError: (e) => toast.error('Could not add field', { description: e instanceof ApiError ? e.message : '' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Settings2 className="size-4" /> Custom fields</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Policy custom fields</DialogTitle>
          <DialogDescription>Define the fields your policies need — they appear on every policy form.</DialogDescription>
        </DialogHeader>
        {(fields ?? []).length > 0 ? (
          <ul className="space-y-1">
            {(fields ?? []).map((fd) => (
              <li key={fd.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <span>{fd.label} <Badge variant="secondary" className="ml-1 text-[10px]">{fd.fieldType}</Badge></span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(fd.id)}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-3 border-t pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="fl">Label</Label><Input id="fl" value={f.label} onChange={(e) => set('label')(e.target.value)} placeholder="Notice period" required /></div>
            <div className="space-y-2">
              <Label htmlFor="ft">Type</Label>
              <Select value={f.fieldType} onValueChange={set('fieldType')}>
                <SelectTrigger id="ft"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t.toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {f.fieldType === 'SELECT' ? (
            <div className="space-y-2"><Label htmlFor="fo">Options (comma-separated)</Label><Input id="fo" value={f.options} onChange={(e) => set('options')(e.target.value)} placeholder="Low, Medium, High" /></div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !f.label.trim()}>{create.isPending ? 'Adding…' : 'Add field'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
