'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { ConvertResult, Currency, ExchangeRate } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { FinanceTabs } from '@/components/finance/finance-tabs';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function CurrenciesPage() {
  const qc = useQueryClient();
  const { data: currencies } = useQuery({ queryKey: ['currencies'], queryFn: () => apiGet<Currency[]>('/finance/currencies') });
  const { data: rates } = useQuery({ queryKey: ['exchange-rates'], queryFn: () => apiGet<ExchangeRate[]>('/finance/exchange-rates') });
  const list = currencies ?? [];

  const [cur, setCur] = useState({ code: '', name: '', symbol: '', isBase: false });
  const [rate, setRate] = useState({ currencyCode: '', rate: '' });
  const [conv, setConv] = useState({ amount: '', from: '', to: '' });
  const [result, setResult] = useState<ConvertResult | null>(null);

  const addCurrency = useMutation({
    mutationFn: () => apiPost('/finance/currencies', { code: cur.code.toUpperCase(), name: cur.name, symbol: cur.symbol || undefined, isBase: cur.isBase }),
    onSuccess: () => { toast.success('Currency added'); qc.invalidateQueries({ queryKey: ['currencies'] }); setCur({ code: '', name: '', symbol: '', isBase: false }); },
    onError: (e) => toast.error('Could not add currency', { description: e instanceof ApiError ? e.message : '' }),
  });
  const addRate = useMutation({
    mutationFn: () => apiPost('/finance/exchange-rates', { currencyCode: rate.currencyCode.toUpperCase(), rate: Number(rate.rate) }),
    onSuccess: () => { toast.success('Rate saved'); qc.invalidateQueries({ queryKey: ['exchange-rates'] }); setRate({ currencyCode: '', rate: '' }); },
    onError: (e) => toast.error('Could not save rate', { description: e instanceof ApiError ? e.message : '' }),
  });
  const doConvert = useMutation({
    mutationFn: () => apiGet<ConvertResult>(`/finance/convert?amountMinor=${Math.round(Number(conv.amount) * 100)}&from=${conv.from}&to=${conv.to}`),
    onSuccess: (r) => setResult(r),
    onError: (e) => { setResult(null); toast.error('Convert failed', { description: e instanceof ApiError ? e.message : '' }); },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader title="Finance" description="Currencies & exchange rates." />
      <FinanceTabs />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-4">
          <p className="font-medium">Currencies</p>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); addCurrency.mutate(); }} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label className="text-xs">Code</Label><Input className="w-20" maxLength={3} value={cur.code} onChange={(e) => setCur((s) => ({ ...s, code: e.target.value }))} placeholder="USD" required /></div>
            <div className="space-y-1"><Label className="text-xs">Name</Label><Input className="w-36" value={cur.name} onChange={(e) => setCur((s) => ({ ...s, name: e.target.value }))} placeholder="US Dollar" required /></div>
            <div className="space-y-1"><Label className="text-xs">Symbol</Label><Input className="w-16" value={cur.symbol} onChange={(e) => setCur((s) => ({ ...s, symbol: e.target.value }))} placeholder="$" /></div>
            <Button type="submit" size="sm" disabled={addCurrency.isPending}><Plus className="size-4" /> Add</Button>
          </form>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="size-3.5 accent-primary" checked={cur.isBase} onChange={(e) => setCur((s) => ({ ...s, isBase: e.target.checked }))} /> Base currency (rate 1.0)
          </label>
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}{c.symbol ? ` (${c.symbol})` : ''}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.isBase ? <Badge variant="success">Base</Badge> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="space-y-4 p-4">
          <p className="font-medium">Exchange rates <span className="text-xs text-muted-foreground">(1 unit → base)</span></p>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); addRate.mutate(); }} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Select value={rate.currencyCode} onValueChange={(v) => setRate((s) => ({ ...s, currencyCode: v }))}>
                <SelectTrigger className="w-28"><SelectValue placeholder="USD" /></SelectTrigger>
                <SelectContent>{list.filter((c) => !c.isBase).map((c) => <SelectItem key={c.id} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Rate to base</Label><Input className="w-32" type="number" step="0.0001" value={rate.rate} onChange={(e) => setRate((s) => ({ ...s, rate: e.target.value }))} placeholder="278.50" required /></div>
            <Button type="submit" size="sm" disabled={addRate.isPending}><Plus className="size-4" /> Save</Button>
          </form>
          <Table>
            <TableHeader><TableRow><TableHead>Currency</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>As of</TableHead></TableRow></TableHeader>
            <TableBody>
              {(rates ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.currencyCode}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rate.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{String(r.asOf).slice(0, 10)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card className="space-y-4 p-4">
        <p className="font-medium">Converter</p>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); doConvert.mutate(); }} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-xs">Amount</Label><Input className="w-32" type="number" step="0.01" value={conv.amount} onChange={(e) => setConv((s) => ({ ...s, amount: e.target.value }))} required /></div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Select value={conv.from} onValueChange={(v) => setConv((s) => ({ ...s, from: v }))}>
              <SelectTrigger className="w-24"><SelectValue placeholder="USD" /></SelectTrigger>
              <SelectContent>{list.map((c) => <SelectItem key={c.id} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <ArrowRight className="mb-2 size-4 text-muted-foreground" />
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Select value={conv.to} onValueChange={(v) => setConv((s) => ({ ...s, to: v }))}>
              <SelectTrigger className="w-24"><SelectValue placeholder="PKR" /></SelectTrigger>
              <SelectContent>{list.map((c) => <SelectItem key={c.id} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!conv.from || !conv.to || doConvert.isPending}>Convert</Button>
          {result ? (
            <span className="mb-1 text-sm">
              = <span className="font-semibold tabular-nums">{formatMoney(result.result.amountMinor, result.result.currency)}</span>
              <span className="ml-2 text-xs text-muted-foreground">@ {(result.fromRate / result.toRate).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            </span>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
