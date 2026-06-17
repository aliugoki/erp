'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import type { Account, AssetGlConfig } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Configure which GL accounts a depreciation run posts to (Dr expense, Cr accumulated). When set, the
 * AssetGlConsumer posts a journal voucher per depreciation run. */
export function GlConfigCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['asset-gl-config'], queryFn: () => apiGet<AssetGlConfig>('/assets/gl-config') });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), retry: false });
  const [expense, setExpense] = useState('');
  const [accum, setAccum] = useState('');

  useEffect(() => {
    if (cfg.data) {
      setExpense(cfg.data.expenseAccountId ?? '');
      setAccum(cfg.data.accumulatedAccountId ?? '');
    }
  }, [cfg.data]);

  const leaves = (accounts.data ?? []).filter((a) => !a.isGroup);
  const expenseAccts = leaves.filter((a) => a.type === 'EXPENSE');
  const assetAccts = leaves.filter((a) => a.type === 'ASSET');
  const configured = !!(cfg.data?.expenseAccountId && cfg.data?.accumulatedAccountId);

  const save = useMutation({
    mutationFn: () => apiPut('/assets/gl-config', { ...(expense ? { expenseAccountId: expense } : {}), ...(accum ? { accumulatedAccountId: accum } : {}) }),
    onSuccess: () => { toast.success('Depreciation posting accounts saved'); void qc.invalidateQueries({ queryKey: ['asset-gl-config'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  });

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium"><Landmark className="h-4 w-4" /> GL posting accounts</p>
        {configured ? <Badge variant="default" className="gap-1"><Check className="h-3 w-3" /> Configured</Badge> : <Badge variant="outline">Not configured</Badge>}
      </div>
      {accounts.isError ? (
        <p className="text-sm text-muted-foreground">Enable the Finance module to map depreciation to the general ledger.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Depreciation expense (Dr)</Label>
            <Select value={expense} onValueChange={setExpense}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select expense account" /></SelectTrigger>
              <SelectContent>
                {expenseAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Accumulated depreciation (Cr)</Label>
            <Select value={accum} onValueChange={setAccum}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select asset account" /></SelectTrigger>
              <SelectContent>
                {assetAccts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={save.isPending || (!expense && !accum)} onClick={() => save.mutate()}>Save</Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">When set, each depreciation run posts a journal voucher (Dr expense / Cr accumulated). Requires background reactions enabled.</p>
    </div>
  );
}
