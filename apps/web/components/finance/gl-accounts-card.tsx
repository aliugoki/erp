'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import type { Account } from '@/lib/types';
import type { FeatureModule } from '@/lib/nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export interface AccountSlot {
  key: string;
  label: string;
  /** Restrict the picker to these account types (default: all leaf accounts). */
  types?: AccountType[];
  required?: boolean;
}

/**
 * Generic "map automated postings to GL accounts" card. Fetches the module's config + the chart of
 * accounts, renders a leaf-account picker per slot, and PUTs the selection. Used by POS / Production /
 * (assets has its own variant).
 */
export function GlAccountsCard({
  title,
  description,
  getPath,
  putPath,
  queryKey,
  slots,
}: {
  title: string;
  description: string;
  getPath: string;
  putPath: string;
  queryKey: string;
  slots: AccountSlot[];
}) {
  const qc = useQueryClient();
  // Accounts integration is optional per company — hide the whole card unless the Finance module is on.
  const features = useQuery({ queryKey: ['features'], queryFn: () => apiGet<FeatureModule[]>('/tenant/features') });
  const financeOff = features.isSuccess && !features.data.some((m) => m.key === 'finance' && m.enabled);
  const cfg = useQuery({ queryKey: [queryKey], queryFn: () => apiGet<Record<string, string | null>>(getPath), enabled: !financeOff });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts'), retry: false, enabled: !financeOff });
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => {
    if (cfg.data) {
      const next: Record<string, string> = {};
      for (const s of slots) next[s.key] = cfg.data[s.key] ?? '';
      setVals(next);
    }
  }, [cfg.data, slots]);

  const leaves = (accounts.data ?? []).filter((a) => !a.isGroup);
  const requiredKeys = slots.filter((s) => s.required).map((s) => s.key);
  const configured = requiredKeys.length > 0 && requiredKeys.every((k) => cfg.data?.[k]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      for (const s of slots) if (vals[s.key]) body[s.key] = vals[s.key]!;
      return apiPut(putPath, body);
    },
    onSuccess: () => { toast.success('Posting accounts saved'); void qc.invalidateQueries({ queryKey: [queryKey] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  });

  if (financeOff) return null; // company doesn't run Finance — accounts integration is hidden

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium"><Landmark className="h-4 w-4" /> {title}</p>
        {configured ? <Badge variant="default" className="gap-1"><Check className="h-3 w-3" /> Configured</Badge> : <Badge variant="outline">Not configured</Badge>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      {accounts.isError ? (
        <p className="text-sm text-muted-foreground">Enable the Finance module to map these postings to the general ledger.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {slots.map((s) => {
            const opts = s.types ? leaves.filter((a) => s.types!.includes(a.type)) : leaves;
            return (
              <div key={s.key} className="grid gap-1">
                <Label className="text-xs">{s.label}{s.required ? ' *' : ''}</Label>
                <Select value={vals[s.key] ?? ''} onValueChange={(v) => setVals((m) => ({ ...m, [s.key]: v }))}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {opts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      )}
    </div>
  );
}
