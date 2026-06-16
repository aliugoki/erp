'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
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

const TYPES = ['TASK', 'CALL', 'MEETING', 'EMAIL', 'NOTE'];
const EMPTY = { type: 'TASK', subject: '', body: '', dueAt: '' };

/** Log an activity / schedule a task. Optionally pre-linked to a deal/lead/account via the props. */
export function NewActivityDialog({ dealId, leadId, clientId }: { dealId?: string; leadId?: string; clientId?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      apiPost('/crm/activities', {
        type: f.type,
        subject: f.subject,
        body: f.body || undefined,
        dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : undefined,
        dealId,
        leadId,
        clientId,
      }),
    onSuccess: () => {
      toast.success('Activity logged', { description: f.subject });
      for (const k of ['activities', 'open-tasks']) qc.invalidateQueries({ queryKey: [k] });
      setOpen(false);
      setF(EMPTY);
    },
    onError: (e) => toast.error('Could not log activity', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New activity
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>A call, meeting, email, task or note on the timeline.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ty">Type</Label>
              <Select value={f.type} onValueChange={set('type')}>
                <SelectTrigger id="ty"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="du">Due</Label>
              <Input id="du" type="datetime-local" value={f.dueAt} onChange={(e) => set('dueAt')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="su">Subject</Label>
            <Input id="su" value={f.subject} onChange={(e) => set('subject')(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bo">Notes</Label>
            <Input id="bo" value={f.body} onChange={(e) => set('body')(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !f.subject.trim()}>
              {create.isPending ? 'Saving…' : 'Log activity'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
