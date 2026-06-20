'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiPatch } from '@/lib/api';
import type { PosRegister } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { PosBadge } from './pos-ui';

/** Edit a single register's settings (name/code/location/status + card-terminal wiring) or delete it. */
export function RegisterDetail({ register, onBack, onDeleted }: { register: PosRegister; onBack?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [cardTerminalProvider, setCardTerminalProvider] = useState('NONE');
  const [cardTerminalUrl, setCardTerminalUrl] = useState('');

  useEffect(() => {
    setName(register.name);
    setCode(register.code ?? '');
    setLocation(register.location ?? '');
    setStatus(register.status);
    setCardTerminalProvider(register.cardTerminalProvider);
    setCardTerminalUrl(register.cardTerminalUrl ?? '');
  }, [register]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['pos-registers'] }); };

  const save = useMutation({
    mutationFn: () => apiPatch(`/pos/registers/${register.id}`, { name, code, location, status, cardTerminalProvider, cardTerminalUrl: cardTerminalUrl || undefined }),
    onSuccess: () => { toast.success('Register saved'); invalidate(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/pos/registers/${register.id}`),
    onSuccess: () => { toast.success('Register deleted'); invalidate(); onDeleted?.(); },
    onError: onErr,
  });

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-semibold">{register.name}</span>
          <PosBadge status={register.status} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm('Delete this register? (only if it has no open shift)')) remove.mutate(); }} disabled={remove.isPending} title="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </Field>
          <Field label="Card terminal">
            <select value={cardTerminalProvider} onChange={(e) => setCardTerminalProvider(e.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="NONE">NONE</option>
              <option value="SIMULATED">SIMULATED</option>
              <option value="BRIDGE">BRIDGE</option>
            </select>
          </Field>
          <Field label="Card terminal URL" className="col-span-2"><Input value={cardTerminalUrl} onChange={(e) => setCardTerminalUrl(e.target.value)} placeholder="https://…" /></Field>
          <div className="col-span-2"><Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button></div>
        </section>
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2 text-sm">
          <span className="text-muted-foreground">Currency</span>
          <span className="tabular-nums">{register.currency}</span>
        </div>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
