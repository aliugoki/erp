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

/** Create a work center (a machine/station with an hourly labour+overhead cost rate). */
export function NewWorkCenterDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', rate: '' });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/production/work-centers', {
        name: form.name,
        ...(form.code ? { code: form.code } : {}),
        costPerHourMinor: Math.round((Number(form.rate) || 0) * 100),
      }),
    onSuccess: () => {
      toast.success('Work center created');
      qc.invalidateQueries({ queryKey: ['prod-work-centers'] });
      setOpen(false);
      setForm({ name: '', code: '', rate: '' });
    },
    onError: (e) => toast.error('Could not create', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Plus className="mr-1 h-4 w-4" /> Work center</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New work center</DialogTitle>
          <DialogDescription>A station whose run time drives operation cost.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wcn">Name</Label>
              <Input id="wcn" value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Assembly line" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wcc">Code</Label>
              <Input id="wcc" value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wcr">Cost per hour (PKR)</Label>
            <Input id="wcr" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => set('rate')(e.target.value)} placeholder="0.00" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
