'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'];

/** Define a custom attribute (preset + customized fields) shown on every production order. */
export function NewAttributeDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ attrKey: '', label: '', dataType: 'TEXT', options: '', required: false });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/production/attributes', {
        attrKey: form.attrKey,
        label: form.label,
        dataType: form.dataType,
        ...(form.dataType === 'SELECT' && form.options ? { options: form.options } : {}),
        required: form.required,
      }),
    onSuccess: () => {
      toast.success('Attribute added');
      qc.invalidateQueries({ queryKey: ['prod-attributes'] });
      setOpen(false);
      setForm({ attrKey: '', label: '', dataType: 'TEXT', options: '', required: false });
    },
    onError: (e) => toast.error('Could not add', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Plus className="mr-1 h-4 w-4" /> Attribute</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom attribute</DialogTitle>
          <DialogDescription>A tenant-defined field captured on every production order.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ak">Key</Label>
              <Input id="ak" value={form.attrKey} onChange={(e) => set('attrKey', e.target.value)} placeholder="batch_no" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="al">Label</Label>
              <Input id="al" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Batch number" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.dataType} onValueChange={(v) => set('dataType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={form.required} onCheckedChange={(v) => set('required', v)} id="req" />
              <Label htmlFor="req">Required</Label>
            </div>
          </div>
          {form.dataType === 'SELECT' ? (
            <div className="space-y-2">
              <Label htmlFor="ao">Options (comma-separated)</Label>
              <Input id="ao" value={form.options} onChange={(e) => set('options', e.target.value)} placeholder="A, B, C" />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add attribute'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
