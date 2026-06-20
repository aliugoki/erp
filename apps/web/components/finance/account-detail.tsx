'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPatch } from '@/lib/api';
import type { Account } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { AccountTypeBadge } from './fin-ui';

const CONTROL_TYPES = ['NONE', 'CASH', 'BANK', 'PAYABLE', 'RECEIVABLE'];

export function AccountDetail({ account, onBack }: { account: Account; onBack?: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', controlType: 'NONE', bankName: '', accountNumber: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    setF({ name: account.name, controlType: account.controlType, bankName: account.bankName ?? '', accountNumber: account.accountNumber ?? '' });
  }, [account]);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');
  const save = useMutation({
    mutationFn: () => apiPatch(`/finance/accounts/${account.id}`, {
      name: f.name,
      controlType: f.controlType,
      bankName: f.bankName || undefined,
      accountNumber: f.accountNumber || undefined,
    }),
    onSuccess: () => { toast.success('Account saved'); void qc.invalidateQueries({ queryKey: ['accounts'] }); },
    onError: onErr,
  });

  return (
    <>
      <PaneHeader>
        {onBack ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button> : null}
        <span className="font-mono text-xs text-muted-foreground">{account.code}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate font-semibold">{account.name}</span><AccountTypeBadge type={account.type} /></div>
      </PaneHeader>

      <PaneBody className="space-y-6 p-5">
        <section className="grid max-w-2xl grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Control type"><select value={f.controlType} onChange={set('controlType')} className="h-10 w-full rounded-md border bg-background px-2 text-sm">{CONTROL_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Bank name"><Input value={f.bankName} onChange={set('bankName')} /></Field>
          <Field label="Account number" className="col-span-2"><Input value={f.accountNumber} onChange={set('accountNumber')} /></Field>
          <div className="col-span-2 flex items-center gap-3">
            <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save</Button>
            {account.isGroup ? <span className="text-xs text-muted-foreground">Group account</span> : null}
          </div>
        </section>
        <p className="text-xs text-muted-foreground">Code and type are fixed after creation.</p>
      </PaneBody>
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid gap-1 text-sm ${className ?? ''}`}><span className="text-muted-foreground">{label}</span>{children}</label>;
}
