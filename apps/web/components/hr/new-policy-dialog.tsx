'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { CustomField } from '@/lib/types';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const CATEGORIES = ['LEAVE', 'ATTENDANCE', 'CONDUCT', 'BENEFITS', 'PAYROLL', 'OTHER'];

/** Create a policy. Renders the company's custom fields dynamically so each tenant captures exactly
 * the policy attributes it needs. */
export function NewPolicyDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [description, setDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: fields } = useQuery({ queryKey: ['custom-fields'], queryFn: () => apiGet<CustomField[]>('/hr/custom-fields') });

  const create = useMutation({
    mutationFn: () =>
      apiPost('/hr/policies', {
        name, category,
        description: description || undefined,
        effectiveDate: effectiveDate || undefined,
        fields: (fields ?? []).filter((fd) => values[fd.id] !== undefined && values[fd.id] !== '')
          .map((fd) => ({ fieldId: fd.id, value: values[fd.id] })),
      }),
    onSuccess: () => {
      toast.success('Policy created', { description: name });
      qc.invalidateQueries({ queryKey: ['policies'] });
      setOpen(false);
      setName(''); setCategory('OTHER'); setDescription(''); setEffectiveDate(''); setValues({});
    },
    onError: (e) => toast.error('Could not create policy', { description: e instanceof ApiError ? e.message : '' }),
  });

  const setVal = (id: string) => (v: string) => setValues((s) => ({ ...s, [id]: v }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> New policy</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New policy</DialogTitle>
          <DialogDescription>Custom fields below are defined by your company.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="pn">Name</Label><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="space-y-2">
              <Label htmlFor="pc">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="pc"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label htmlFor="pd">Description</Label><Input id="pd" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="pe">Effective date</Label><Input id="pe" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>

          {(fields ?? []).length > 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium text-muted-foreground">Custom fields</p>
              {(fields ?? []).map((fd) => (
                <div key={fd.id} className="space-y-2">
                  <Label htmlFor={fd.id}>{fd.label}{fd.required ? ' *' : ''}</Label>
                  {fd.fieldType === 'BOOLEAN' ? (
                    <div><Switch checked={values[fd.id] === 'true'} onCheckedChange={(c) => setVal(fd.id)(c ? 'true' : 'false')} /></div>
                  ) : fd.fieldType === 'SELECT' ? (
                    <Select value={values[fd.id] ?? ''} onValueChange={setVal(fd.id)}>
                      <SelectTrigger id={fd.id}><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{(fd.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Input id={fd.id} type={fd.fieldType === 'NUMBER' ? 'number' : fd.fieldType === 'DATE' ? 'date' : 'text'}
                      value={values[fd.id] ?? ''} onChange={(e) => setVal(fd.id)(e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>{create.isPending ? 'Creating…' : 'Create policy'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
