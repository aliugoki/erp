'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import type { HdAgent, HdTicket } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function NewTicketDialog({ agents, onClose }: { agents: HdAgent[]; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ subject: '', requesterName: '', requesterEmail: '', priority: 'MEDIUM', channel: 'WEB', category: '', assignedTo: '', body: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () => apiPost<HdTicket>('/helpdesk/tickets', {
      subject: f.subject, body: f.body, requesterName: f.requesterName, requesterEmail: f.requesterEmail,
      priority: f.priority, channel: f.channel, category: f.category || undefined, assignedTo: f.assignedTo || undefined,
    }),
    onSuccess: (t) => {
      toast.success(`Ticket ${t.ticketNo} created`);
      void qc.invalidateQueries({ queryKey: ['hd-tickets'] });
      void qc.invalidateQueries({ queryKey: ['hd-overview'] });
      router.push(`/helpdesk/${t.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const valid = f.subject.trim() && f.requesterName.trim() && /.+@.+\..+/.test(f.requesterEmail) && f.body.trim();

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New ticket</DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          <Field label="Subject"><Input value={f.subject} onChange={set('subject')} placeholder="Brief summary of the issue" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Requester name"><Input value={f.requesterName} onChange={set('requesterName')} /></Field>
            <Field label="Requester email"><Input value={f.requesterEmail} onChange={set('requesterEmail')} type="email" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Priority">
              <select value={f.priority} onChange={set('priority')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Channel">
              <select value={f.channel} onChange={set('channel')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                {['WEB', 'EMAIL', 'PHONE', 'CHAT'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Category"><Input value={f.category} onChange={set('category')} placeholder="(optional)" /></Field>
          </div>
          <Field label="Assign to">
            <select value={f.assignedTo} onChange={set('assignedTo')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea value={f.body} onChange={set('body')} rows={4} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="What does the customer need help with?" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create ticket</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}
