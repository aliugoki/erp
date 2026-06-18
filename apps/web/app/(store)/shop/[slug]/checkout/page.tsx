'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Loader2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import { type SfOrder, type SfPaymentSession, clearCartToken, getCartToken, sfPath } from '@/lib/storefront';
import { accentStyle, useCart, useCustomer, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

export default function CheckoutPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const { cart, loading } = useCart(slug);
  const { customer } = useCustomer(slug);
  const router = useRouter();
  const qc = useQueryClient();

  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '', shippingAddress: '', shippingCity: '', shippingCountry: '' });
  // Prefill the contact fields for a signed-in shopper (only while still blank, so edits stick).
  useEffect(() => {
    if (customer) setForm((f) => (f.customerName || f.customerEmail ? f : { ...f, customerName: customer.name, customerEmail: customer.email }));
  }, [customer]);
  const [method, setMethod] = useState<'COD' | 'CARD'>('COD');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const place = useMutation({
    mutationFn: () => {
      const tok = getCartToken(slug);
      return apiPost<SfOrder & { payment?: SfPaymentSession }>(sfPath(slug, '/checkout'), { cartToken: tok, paymentMethod: method, ...form });
    },
    onSuccess: (order) => {
      clearCartToken(slug);
      qc.setQueryData(['sf-cart', slug], null);
      void qc.invalidateQueries({ queryKey: ['sf-my-orders', slug] });
      const pay = order.payment;
      if (pay) {
        // Card order — go to the payment step (or the external gateway).
        if (pay.redirectUrl) { window.location.href = pay.redirectUrl; return; }
        sessionStorage.setItem(`mx_pay_${pay.paymentId}`, pay.clientSecret);
        router.push(sfPath(slug, `/pay/${pay.paymentId}`));
        return;
      }
      toast.success('Order placed!');
      router.push(sfPath(slug, `/order/${order.orderNo}`));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Checkout failed'),
  });

  // Re-quote shipping for the entered destination (zones can override the store default).
  const [quotedShip, setQuotedShip] = useState<number | null>(null);
  const quote = useMutation({
    mutationFn: (country: string) =>
      apiPost<{ shippingMinor: number }>(sfPath(slug, '/shipping/quote'), { country, subtotalMinor: cart?.totals.subtotalMinor ?? 0 }),
    onSuccess: (r) => setQuotedShip(r.shippingMinor),
  });

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;

  const items = cart?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-28 text-center text-zinc-500">
        <p>Your cart is empty.</p>
        <Link href={sfPath(slug, '/products')} className="mt-3 inline-block text-sm font-medium" style={{ color: store.accentColor }}>Continue shopping</Link>
      </div>
    );
  }

  const t = cart!.totals;
  const cur = cart!.currency;
  const shipMinor = quotedShip ?? t.shippingMinor;
  const totalMinor = t.subtotalMinor - t.discountMinor + t.taxMinor + shipMinor;
  const valid = form.customerName.trim() && /.+@.+\..+/.test(form.customerEmail);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-zinc-900">Checkout</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Form */}
        <div className="space-y-6">
          <Card title="Contact">
            <Field label="Full name" required><input value={form.customerName} onChange={set('customerName')} className={inputCls} placeholder="Jane Doe" /></Field>
            <Field label="Email" required><input value={form.customerEmail} onChange={set('customerEmail')} type="email" className={inputCls} placeholder="jane@example.com" /></Field>
            <Field label="Phone"><input value={form.customerPhone} onChange={set('customerPhone')} className={inputCls} placeholder="+92 300 1234567" /></Field>
          </Card>

          <Card title="Shipping">
            <Field label="Address"><input value={form.shippingAddress} onChange={set('shippingAddress')} className={inputCls} placeholder="123 Market Road" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City"><input value={form.shippingCity} onChange={set('shippingCity')} className={inputCls} placeholder="Lahore" /></Field>
              <Field label="Country"><input value={form.shippingCountry} onChange={set('shippingCountry')} onBlur={(e) => e.target.value.trim() && quote.mutate(e.target.value.trim())} className={inputCls} placeholder="Pakistan" /></Field>
            </div>
          </Card>

          <Card title="Payment">
            <div className="grid gap-3 sm:grid-cols-2">
              <Pay active={method === 'COD'} onClick={() => setMethod('COD')} icon={<Truck className="h-5 w-5" />} title="Cash on delivery" desc="Pay when it arrives" />
              <Pay active={method === 'CARD'} onClick={() => setMethod('CARD')} icon={<CreditCard className="h-5 w-5" />} title="Card" desc="Pay now (simulated)" />
            </div>
          </Card>
        </div>

        {/* Summary */}
        <div className="h-fit rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Your order</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {items.map((it) => (
              <li key={it.productId + (it.variantId ?? '')} className="flex justify-between gap-2">
                <span className="line-clamp-1 text-zinc-600">{it.quantity}× {it.title}{it.variantLabel ? ` (${it.variantLabel})` : ''}</span>
                <span className="tabular-nums text-zinc-900">{formatMoney(it.lineTotalMinor, cur)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-zinc-200 pt-4 text-sm">
            <Row label="Subtotal" value={formatMoney(t.subtotalMinor, cur)} />
            {t.discountMinor > 0 ? <Row label="Discount" value={`−${formatMoney(t.discountMinor, cur)}`} /> : null}
            {t.taxMinor > 0 ? <Row label="Tax" value={formatMoney(t.taxMinor, cur)} /> : null}
            <Row label="Shipping" value={shipMinor > 0 ? formatMoney(shipMinor, cur) : 'Free'} />
            <div className="border-t border-zinc-200 pt-2"><Row label="Total" value={formatMoney(totalMinor, cur)} bold /></div>
          </dl>
          <button
            type="button"
            disabled={!valid || place.isPending}
            onClick={() => place.mutate()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40"
            style={accentStyle(store)}
          >
            {place.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Place order · {formatMoney(totalMinor, cur)}
          </button>
          <p className="mt-3 text-center text-xs text-zinc-400">By placing this order you agree to {store.name}’s terms.</p>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-5">
      <h2 className="mb-4 text-base font-semibold text-zinc-900">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-600">{label}{required ? <span className="text-rose-500"> *</span> : null}</span>
      {children}
    </label>
  );
}
function Pay({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition ${active ? 'border-zinc-900 bg-white' : 'border-zinc-200 hover:border-zinc-300'}`}>
      <span className="text-zinc-700">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-zinc-900">{title}</span>
        <span className="block text-xs text-zinc-500">{desc}</span>
      </span>
    </button>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={bold ? 'font-semibold text-zinc-900' : 'text-zinc-600'}>{label}</dt>
      <dd className={`tabular-nums ${bold ? 'text-base font-bold text-zinc-900' : 'text-zinc-900'}`}>{value}</dd>
    </div>
  );
}
