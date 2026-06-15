'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import type { Account, AccountType } from '@/lib/types';
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
import { Switch } from '@/components/ui/switch';

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

/** Create a chart-of-accounts entry: a postable leaf or a group header, optionally under a parent. */
export function NewAccountDialog({ accounts }: { accounts: Account[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    code: '', name: '', type: 'ASSET' as AccountType, parentId: 'NONE', isGroup: false,
    controlType: 'NONE' as 'NONE' | 'CASH' | 'BANK' | 'PAYABLE' | 'RECEIVABLE', bankName: '', accountNumber: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  // Only groups below the 4th level can be parents (a child must fit within 4 levels).
  const groups = accounts.filter((a) => a.isGroup && (a.level ?? 1) < 4);
  const parent = groups.find((g) => g.id === f.parentId);
  const level = parent ? (parent.level ?? 1) + 1 : 1;
  const effectiveType = parent ? parent.type : f.type;

  const create = useMutation({
    mutationFn: () =>
      apiPost('/finance/accounts', {
        code: f.code,
        name: f.name,
        type: f.type,
        isGroup: f.isGroup,
        controlType: f.controlType,
        ...(f.controlType === 'BANK' ? { bankName: f.bankName, accountNumber: f.accountNumber } : {}),
        ...(f.parentId !== 'NONE' ? { parentId: f.parentId } : {}),
      }),
    onSuccess: () => {
      toast.success('Account created', { description: `${f.code} · ${f.name}` });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setOpen(false);
      setF({ code: '', name: '', type: 'ASSET', parentId: 'NONE', isGroup: false, controlType: 'NONE', bankName: '', accountNumber: '' });
    },
    onError: (e) => toast.error('Could not create account', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>Group accounts organise the tree; leaf accounts are postable.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="1000" required />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Cash" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Parent (group)</Label>
              <Select value={f.parentId} onValueChange={(v) => set('parentId', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— None (level-1 head) —</SelectItem>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{'— '.repeat((g.level ?? 1) - 1)}{g.code} · {g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type {parent ? <span className="text-xs text-muted-foreground">(inherited)</span> : null}</Label>
              <Select value={effectiveType} onValueChange={(v) => set('type', v as AccountType)} disabled={Boolean(parent)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This will be a <span className="font-medium">level-{level}</span> account
            {level === 4 ? ' (detail — postable).' : ' (mark it a group to nest children under it).'}
          </p>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
            <div>
              <Label htmlFor="isGroup">Group account</Label>
              <p className="text-xs text-muted-foreground">A header you nest under — cannot be posted to.</p>
            </div>
            <Switch id="isGroup" checked={f.isGroup} onCheckedChange={(v) => setF((s) => ({ ...s, isGroup: v, controlType: 'NONE' }))} />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label>Control role</Label>
              <Select value={f.controlType} onValueChange={(v) => set('controlType', v as typeof f.controlType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Ordinary account</SelectItem>
                  {f.isGroup ? (
                    <>
                      <SelectItem value="PAYABLE">Payables control (vendors)</SelectItem>
                      <SelectItem value="RECEIVABLE">Receivables control (customers)</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="CASH">Cash account</SelectItem>
                      <SelectItem value="BANK">Bank account</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {f.isGroup
                  ? 'A Payables/Receivables control group is where new vendor/customer ledger sub-accounts are created.'
                  : 'Cash/Bank accounts drive voucher rules (BRV/BPV/CRV/CPV) and the cash & bank book.'}
              </p>
            </div>
            {!f.isGroup && f.controlType === 'BANK' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="bn">Bank name</Label>
                  <Input id="bn" value={f.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="HBL" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="an">Account #</Label>
                  <Input id="an" value={f.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} placeholder="0001-xxxxxxx" />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create account'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
