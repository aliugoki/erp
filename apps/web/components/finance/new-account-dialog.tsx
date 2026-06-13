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
  const [f, setF] = useState({ code: '', name: '', type: 'ASSET' as AccountType, parentId: 'NONE', isGroup: false });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const groups = accounts.filter((a) => a.isGroup);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/finance/accounts', {
        code: f.code,
        name: f.name,
        type: f.type,
        isGroup: f.isGroup,
        ...(f.parentId !== 'NONE' ? { parentId: f.parentId } : {}),
      }),
    onSuccess: () => {
      toast.success('Account created', { description: `${f.code} · ${f.name}` });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setOpen(false);
      setF({ code: '', name: '', type: 'ASSET', parentId: 'NONE', isGroup: false });
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
              <Label>Type</Label>
              <Select value={f.type} onValueChange={(v) => set('type', v as AccountType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Parent (group)</Label>
              <Select value={f.parentId} onValueChange={(v) => set('parentId', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— None (root) —</SelectItem>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} · {g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
            <div>
              <Label htmlFor="isGroup">Group account</Label>
              <p className="text-xs text-muted-foreground">A header you nest under — cannot be posted to.</p>
            </div>
            <Switch id="isGroup" checked={f.isGroup} onCheckedChange={(v) => set('isGroup', v)} />
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
