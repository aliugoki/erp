'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface PaymentConfig {
  provider: 'SIMULATED' | 'HTTP';
  gatewayUrl: string | null;
  publishableKey: string | null;
  enabled: boolean;
  hasWebhookSecret: boolean;
}

/** Choose how card payments are processed: a built-in simulated provider, or an external HTTP gateway
 * (the storefront sends the buyer there and a signed webhook confirms the order). */
export function PaymentConfigCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ec-payment-config'], queryFn: () => apiGet<PaymentConfig>('/ecommerce/payment-config') });
  const [provider, setProvider] = useState<'SIMULATED' | 'HTTP'>('SIMULATED');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [publishableKey, setPublishableKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const c = q.data;
    if (!c) return;
    setProvider(c.provider);
    setGatewayUrl(c.gatewayUrl ?? '');
    setPublishableKey(c.publishableKey ?? '');
    setEnabled(c.enabled);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => apiPut<PaymentConfig>('/ecommerce/payment-config', {
      provider, gatewayUrl: gatewayUrl || undefined, publishableKey: publishableKey || undefined,
      webhookSecret: webhookSecret || undefined, enabled,
    }),
    onSuccess: () => { setWebhookSecret(''); toast.success('Payment settings saved'); void qc.invalidateQueries({ queryKey: ['ec-payment-config'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed'),
  });

  return (
    <div className="rounded-xl border p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4" /> Card payments</div>
      <p className="mb-4 text-sm text-muted-foreground">
        Orders are created pending and marked paid only once payment is confirmed. The simulated provider is self-hosted; an external gateway plugs in over HTTP with a signed webhook.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Provider</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as 'SIMULATED' | 'HTTP')} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="SIMULATED">Simulated (built-in)</option>
            <option value="HTTP">External gateway (HTTP)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-7 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} /> Card payments enabled</label>
        {provider === 'HTTP' ? (
          <>
            <label className="grid gap-1 text-sm sm:col-span-2"><span className="text-muted-foreground">Gateway URL</span><Input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} placeholder="https://gateway.example.com/sessions" /></label>
            <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Publishable / API key</span><Input value={publishableKey} onChange={(e) => setPublishableKey(e.target.value)} placeholder="pk_..." /></label>
            <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Webhook secret {q.data?.hasWebhookSecret ? '(set — leave blank to keep)' : ''}</span><Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} type="password" placeholder={q.data?.hasWebhookSecret ? '••••••••' : 'auto-generated if left blank'} /></label>
          </>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save payment settings
        </Button>
      </div>
    </div>
  );
}
