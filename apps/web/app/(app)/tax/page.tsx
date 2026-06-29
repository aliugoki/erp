'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CheckCircle2, Landmark, Loader2, Send, ShieldCheck } from 'lucide-react';
import { ApiError, apiGet, apiPost, apiPut } from '@/lib/api';
import type { FbrConfig, FbrInvoice, PosSale } from '@/lib/types';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

function QrImg({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(value, { width: 96, margin: 1 }).then(setSrc).catch(() => setSrc('')); }, [value]);
  return src ? <img src={src} alt="FBR QR" width={72} height={72} className="rounded-md border bg-white p-1" /> : <div className="size-[72px] rounded-md border" />;
}

const STATUS_TONE: Record<string, string> = {
  REPORTED: 'bg-success/10 text-success',
  FAILED: 'bg-destructive/10 text-destructive',
  PENDING: 'bg-muted text-muted-foreground',
};

export default function TaxPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['fbr-config'], queryFn: () => apiGet<FbrConfig>('/tax/fbr/config') });
  const invoices = useQuery({ queryKey: ['fbr-invoices'], queryFn: () => apiGet<FbrInvoice[]>('/tax/fbr/invoices') });
  const sales = useQuery({ queryKey: ['pos-sales-for-fbr'], queryFn: () => apiGet<PosSale[]>('/pos/sales') });

  // `cred` is the write-only API key input (kept blank after save).
  const [form, setForm] = useState<FbrConfig & { cred: string }>({ sellerNtn: '', sellerName: '', posId: '', environment: 'sandbox', enabled: false, hasToken: false, cred: '' });
  useEffect(() => { if (config.data) setForm((f) => ({ ...f, ...config.data, cred: '' })); }, [config.data]);

  const save = useMutation({
    mutationFn: () => apiPut('/tax/fbr/config', {
      sellerNtn: form.sellerNtn, sellerName: form.sellerName, posId: form.posId,
      environment: form.environment, enabled: form.enabled, ...(form.cred ? { apiToken: form.cred } : {}),
    }),
    onSuccess: () => { toast.success('FBR settings saved'); setForm((f) => ({ ...f, cred: '' })); qc.invalidateQueries({ queryKey: ['fbr-config'] }); },
    onError: (e) => toast.error('Could not save', { description: e instanceof ApiError ? e.message : '' }),
  });
  const report = useMutation({
    mutationFn: (saleId: string) => apiPost<FbrInvoice>(`/tax/fbr/report/${saleId}`),
    onSuccess: (inv) => { toast.success('Reported to FBR', { description: `Invoice ${inv.fbrInvoiceNumber}` }); qc.invalidateQueries({ queryKey: ['fbr-invoices'] }); },
    onError: (e) => toast.error('Report failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  const reportedSaleIds = new Set((invoices.data ?? []).filter((i) => i.status === 'REPORTED').map((i) => i.sourceId));
  const completedSales = (sales.data ?? []).filter((s) => s.status === 'COMPLETED' && !reportedSaleIds.has(s.id)).slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Tax / FBR" icon={Landmark} description="FBR (Pakistan) digital invoicing — report POS sales for an FBR invoice number + QR." />

      {/* Config */}
      <Card className="glass elevated p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <p className="font-medium">FBR connection</p>
          <Badge variant="secondary" className="ml-1 uppercase">{form.environment}</Badge>
          {config.data?.hasToken ? <Badge variant="secondary" className="bg-success/10 text-success">credentials set</Badge> : null}
          <div className="ml-auto flex items-center gap-2 text-sm"><span className="text-muted-foreground">Enabled</span><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5"><Label className="text-xs">Seller NTN / STRN</Label><Input value={form.sellerNtn} onChange={(e) => setForm({ ...form, sellerNtn: e.target.value })} placeholder="1234567-8" className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Business name</Label><Input value={form.sellerName} onChange={(e) => setForm({ ...form, sellerName: e.target.value })} placeholder="Acme (Pvt) Ltd" className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">POS registration ID</Label><Input value={form.posId} onChange={(e) => setForm({ ...form, posId: e.target.value })} placeholder="POS-001" className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Environment</Label>
            <Select value={form.environment} onValueChange={(v) => setForm({ ...form, environment: v as FbrConfig['environment'] })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="sandbox">Sandbox (simulated)</SelectItem><SelectItem value="production">Production (live)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">API token {config.data?.hasToken ? <span className="text-muted-foreground">(leave blank to keep)</span> : null}</Label>
            <Input type="password" value={form.cred} onChange={(e) => setForm({ ...form, cred: e.target.value })} placeholder="FBR API token" className="h-9" autoComplete="off" /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Save settings</Button>
          <p className="text-xs text-muted-foreground">Sandbox simulates FBR acknowledgements; add production credentials to report live.</p>
        </div>
      </Card>

      {/* Report a sale */}
      <Card className="p-4">
        <p className="mb-3 font-medium">Report a POS sale to FBR</p>
        {completedSales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed sales awaiting FBR reporting.</p>
        ) : (
          <ul className="space-y-2">
            {completedSales.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                <span><span className="font-medium">{s.saleNo}</span> <span className="text-xs text-muted-foreground">· {s.customerName || 'Walk-in'} · {formatMoney(s.total.amountMinor, s.total.currency)}</span></span>
                <Button size="sm" variant="outline" className="h-8" disabled={report.isPending} onClick={() => report.mutate(s.id)}><Send className="size-3.5" /> Report to FBR</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Reported invoices */}
      <Card className="p-4">
        <p className="mb-3 font-medium">FBR invoices <span className="text-xs text-muted-foreground">({(invoices.data ?? []).length})</span></p>
        {invoices.isLoading ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (invoices.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices reported yet.</p>
        ) : (
          <ul className="divide-y">
            {(invoices.data ?? []).map((inv) => (
              <li key={inv.id} className="flex items-center gap-4 py-3">
                {inv.qr ? <QrImg value={inv.qr} /> : <div className="size-[72px] rounded-md border" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{inv.invoiceRef}</span>
                    <Badge className={cn('text-[11px] font-semibold', STATUS_TONE[inv.status])}>{inv.status}</Badge>
                    {inv.environment ? <Badge variant="secondary" className="uppercase text-[10px]">{inv.environment}</Badge> : null}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{inv.fbrInvoiceNumber ?? inv.error ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">{formatMoney(inv.amountMinor, 'PKR')} · {inv.reportedAt ? new Date(inv.reportedAt).toLocaleString() : new Date(inv.createdAt).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
