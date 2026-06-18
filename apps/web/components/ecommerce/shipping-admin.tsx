'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { EcShippingZone } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatMoney } from '@/lib/utils';

const toMinor = (s: string): number => Math.round((Number(s) || 0) * 100);

/** Shipping zones: per-destination rates. A zone with no countries is the catch-all ("rest of world").
 * Checkout picks the zone by the destination country (specific first, then catch-all, else store default). */
export function ShippingAdmin() {
  const qc = useQueryClient();
  const zones = useQuery({ queryKey: ['ec-shipping-zones'], queryFn: () => apiGet<EcShippingZone[]>('/ecommerce/shipping-zones') });
  const [f, setF] = useState({ name: '', countries: '', rate: '', freeOver: '' });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ec-shipping-zones'] });

  const create = useMutation({
    mutationFn: () => apiPost('/ecommerce/shipping-zones', {
      name: f.name,
      countries: f.countries.split(',').map((c) => c.trim()).filter(Boolean),
      rateMinor: toMinor(f.rate),
      freeOverMinor: f.freeOver ? toMinor(f.freeOver) : undefined,
    }),
    onSuccess: () => { setF({ name: '', countries: '', rate: '', freeOver: '' }); toast.success('Zone added'); void invalidate(); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => apiPatch(`/ecommerce/shipping-zones/${id}`, { enabled }),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/ecommerce/shipping-zones/${id}`),
    onSuccess: () => { toast.success('Removed'); void invalidate(); },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Globe className="h-4 w-4" /> Add a shipping zone</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto_auto]">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Domestic" /></Field>
          <Field label="Countries (comma-sep; blank = rest of world)"><Input value={f.countries} onChange={(e) => setF((s) => ({ ...s, countries: e.target.value }))} placeholder="Pakistan, India" /></Field>
          <Field label="Rate"><Input value={f.rate} onChange={(e) => setF((s) => ({ ...s, rate: e.target.value }))} inputMode="decimal" className="w-24" /></Field>
          <Field label="Free over"><Input value={f.freeOver} onChange={(e) => setF((s) => ({ ...s, freeOver: e.target.value }))} inputMode="decimal" placeholder="—" className="w-24" /></Field>
          <div className="flex items-end"><Button onClick={() => create.mutate()} disabled={!f.name || create.isPending}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button></div>
        </div>
      </div>

      <div className="rounded-xl border divide-y">
        {(zones.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No zones — orders use the store’s default shipping rate.</p>
        ) : (
          zones.data!.map((z) => (
            <div key={z.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{z.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{z.countries.length ? z.countries.join(', ') : 'Rest of world'}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {z.rate.amountMinor === 0 ? 'Free' : formatMoney(z.rate.amountMinor, z.rate.currency)}
                  {z.freeOver ? ` · free over ${formatMoney(z.freeOver.amountMinor, z.freeOver.currency)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={z.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: z.id, enabled })} />
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(z.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs text-muted-foreground">{label}{children}</label>;
}
