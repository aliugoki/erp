'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Settings2, Wallet } from 'lucide-react';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import type { Account } from '@/lib/types';
import { type PharmacyConfig, type PharmacyGlConfig } from '@/components/pharmacy/pharm-ui';

const MODES = ['RETAIL', 'HOSPITAL', 'WHOLESALE'] as const;

const NONE = 'NONE';

const GL_FIELDS: { key: keyof PharmacyGlConfig; label: string }[] = [
  { key: 'revenueAccountId', label: 'Revenue' },
  { key: 'taxAccountId', label: 'Tax payable' },
  { key: 'discountAccountId', label: 'Discount' },
  { key: 'cogsAccountId', label: 'COGS' },
  { key: 'inventoryAccountId', label: 'Inventory' },
  { key: 'clearingAccountId', label: 'Clearing' },
  { key: 'receivableAccountId', label: 'Receivable (debtor)' },
  { key: 'writeoffAccountId', label: 'Write-off' },
];

interface ConfigForm {
  mode: string;
  controlledRegisterEnabled: boolean;
  nearExpiryDays: number;
  allowDispenseWithoutStock: boolean;
  defaultTaxBp: number;
  currency: string;
}

type GlForm = Record<keyof PharmacyGlConfig, string>;

const emptyGlForm = (): GlForm => ({
  inventoryAccountId: NONE,
  revenueAccountId: NONE,
  cogsAccountId: NONE,
  taxAccountId: NONE,
  discountAccountId: NONE,
  receivableAccountId: NONE,
  clearingAccountId: NONE,
  writeoffAccountId: NONE,
});

/** Pharmacy operating-mode policies + GL account mapping. Two cards in one scrolling body. */
export function PharmacySettings() {
  const qc = useQueryClient();

  const configQuery = useQuery({ queryKey: ['pharm-config'], queryFn: () => apiGet<PharmacyConfig>('/pharmacy/config') });
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => apiGet<Account[]>('/finance/accounts') });
  const glQuery = useQuery({ queryKey: ['pharm-gl-config'], queryFn: () => apiGet<PharmacyGlConfig>('/pharmacy/gl-config') });

  const [cfg, setCfg] = useState<ConfigForm>({
    mode: 'RETAIL',
    controlledRegisterEnabled: false,
    nearExpiryDays: 90,
    allowDispenseWithoutStock: false,
    defaultTaxBp: 0,
    currency: 'PKR',
  });
  const [gl, setGl] = useState<GlForm>(emptyGlForm);

  useEffect(() => {
    if (configQuery.data) {
      const d = configQuery.data;
      setCfg({
        mode: d.mode,
        controlledRegisterEnabled: d.controlledRegisterEnabled,
        nearExpiryDays: d.nearExpiryDays,
        allowDispenseWithoutStock: d.allowDispenseWithoutStock,
        defaultTaxBp: d.defaultTaxBp,
        currency: d.currency,
      });
    }
  }, [configQuery.data]);

  useEffect(() => {
    if (glQuery.data) {
      const d = glQuery.data;
      setGl({
        inventoryAccountId: d.inventoryAccountId ?? NONE,
        revenueAccountId: d.revenueAccountId ?? NONE,
        cogsAccountId: d.cogsAccountId ?? NONE,
        taxAccountId: d.taxAccountId ?? NONE,
        discountAccountId: d.discountAccountId ?? NONE,
        receivableAccountId: d.receivableAccountId ?? NONE,
        clearingAccountId: d.clearingAccountId ?? NONE,
        writeoffAccountId: d.writeoffAccountId ?? NONE,
      });
    }
  }, [glQuery.data]);

  const postable = (accountsQuery.data ?? []).filter((a) => !a.isGroup);

  const saveConfig = useMutation({
    mutationFn: () =>
      apiPut('/pharmacy/config', {
        mode: cfg.mode,
        controlledRegisterEnabled: cfg.controlledRegisterEnabled,
        nearExpiryDays: cfg.nearExpiryDays,
        allowDispenseWithoutStock: cfg.allowDispenseWithoutStock,
        defaultTaxBp: cfg.defaultTaxBp,
        currency: cfg.currency,
      }),
    onSuccess: () => {
      toast.success('Pharmacy settings saved');
      void qc.invalidateQueries({ queryKey: ['pharm-config'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save settings'),
  });

  const saveGl = useMutation({
    mutationFn: () => {
      const body: Partial<Record<keyof PharmacyGlConfig, string>> = {};
      for (const { key } of GL_FIELDS) {
        if (gl[key] && gl[key] !== NONE) body[key] = gl[key];
      }
      return apiPut('/pharmacy/gl-config', body);
    },
    onSuccess: () => {
      toast.success('GL accounts saved');
      void qc.invalidateQueries({ queryKey: ['pharm-gl-config'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save GL accounts'),
  });

  const loading = configQuery.isLoading || glQuery.isLoading || accountsQuery.isLoading;

  return (
    <>
      <PaneHeader>
        <span className="flex-1 truncate font-semibold">Pharmacy settings</span>
      </PaneHeader>
      <PaneBody className="p-5">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            {/* ── Operating mode & policies ─────────────────────────────── */}
            <section className="rounded-xl border">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Settings2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Operating mode &amp; policies</span>
              </div>
              <div className="grid max-w-xl gap-4 p-4">
                <div className="grid gap-1.5">
                  <Label>Operating mode</Label>
                  <Select value={cfg.mode} onValueChange={(v) => setCfg((s) => ({ ...s, mode: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                  <div className="min-w-0">
                    <Label htmlFor="controlled" className="block">Controlled-drug register</Label>
                    <p className="text-xs text-muted-foreground">Track narcotic / psychotropic movements.</p>
                  </div>
                  <Switch id="controlled" checked={cfg.controlledRegisterEnabled} onCheckedChange={(v) => setCfg((s) => ({ ...s, controlledRegisterEnabled: v }))} />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                  <div className="min-w-0">
                    <Label htmlFor="nostock" className="block">Allow dispense without stock</Label>
                    <p className="text-xs text-muted-foreground">Permit negative on-hand at dispense time.</p>
                  </div>
                  <Switch id="nostock" checked={cfg.allowDispenseWithoutStock} onCheckedChange={(v) => setCfg((s) => ({ ...s, allowDispenseWithoutStock: v }))} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="expiry">Near-expiry days</Label>
                    <Input id="expiry" type="number" min="0" inputMode="numeric" value={cfg.nearExpiryDays} onChange={(e) => setCfg((s) => ({ ...s, nearExpiryDays: Number(e.target.value) }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="currency">Currency</Label>
                    <Input id="currency" value={cfg.currency} onChange={(e) => setCfg((s) => ({ ...s, currency: e.target.value.toUpperCase() }))} placeholder="PKR" />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="tax">Default tax (basis points)</Label>
                  <Input id="tax" type="number" min="0" inputMode="numeric" value={cfg.defaultTaxBp} onChange={(e) => setCfg((s) => ({ ...s, defaultTaxBp: Number(e.target.value) }))} />
                  <p className="text-xs text-muted-foreground">e.g. 500 = 5%</p>
                </div>

                <div>
                  <Button disabled={saveConfig.isPending} onClick={() => saveConfig.mutate()}>
                    {saveConfig.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save settings
                  </Button>
                </div>
              </div>
            </section>

            {/* ── GL accounts ───────────────────────────────────────────── */}
            <section className="rounded-xl border">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Wallet className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-semibold">GL accounts</span>
              </div>
              <div className="grid max-w-xl gap-4 p-4">
                <p className="text-xs text-muted-foreground">
                  Dispenses post: Dr debtor / Cr revenue (+tax); Dr COGS / Cr inventory.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {GL_FIELDS.map(({ key, label }) => (
                    <div key={key} className="grid gap-1.5">
                      <Label>{label}</Label>
                      <Select value={gl[key]} onValueChange={(v) => setGl((s) => ({ ...s, [key]: v }))}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {postable.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div>
                  <Button disabled={saveGl.isPending} onClick={() => saveGl.mutate()}>
                    {saveGl.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save GL accounts
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </PaneBody>
    </>
  );
}
