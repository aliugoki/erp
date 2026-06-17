'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfOrder, sfPath } from '@/lib/storefront';
import { accentStyle, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

export default function OrderConfirmation({ params }: { params: { slug: string; orderNo: string } }) {
  const { slug, orderNo } = params;
  const { store } = useStore();
  const order = useQuery({ queryKey: ['sf-order', slug, orderNo], queryFn: () => apiGet<SfOrder>(sfPath(slug, `/orders/${orderNo}`)) });

  if (order.isLoading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (order.isError || !order.data) {
    return <div className="mx-auto max-w-md px-4 py-28 text-center text-zinc-500">Order not found.</div>;
  }

  const o = order.data;
  const cur = o.total.currency;
  const paid = o.paymentStatus === 'PAID';
  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14" style={{ color: store.accentColor }} />
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900">Thank you, {o.customerName.split(' ')[0]}!</h1>
        <p className="mt-2 text-zinc-600">
          Your order <span className="font-semibold text-zinc-900">{o.orderNo}</span> is confirmed.
          {paid ? ' Payment received.' : ' Pay on delivery.'}
        </p>
        <p className="mt-1 text-sm text-zinc-500">A confirmation was noted for {o.customerEmail}.</p>
      </div>

      <div className="mt-10 overflow-hidden rounded-2xl border border-zinc-200">
        <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-3 text-sm font-semibold text-zinc-700">Order summary</div>
        <ul className="divide-y divide-zinc-100">
          {o.lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="text-zinc-700">{l.quantity}× {l.title}</span>
              <span className="tabular-nums text-zinc-900">{formatMoney(l.lineTotal.amountMinor, cur)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-zinc-100 px-5 py-4 text-sm">
          <Row label="Subtotal" value={formatMoney(o.subtotal.amountMinor, cur)} />
          {o.discount.amountMinor > 0 ? <Row label="Discount" value={`−${formatMoney(o.discount.amountMinor, cur)}`} /> : null}
          {o.tax.amountMinor > 0 ? <Row label="Tax" value={formatMoney(o.tax.amountMinor, cur)} /> : null}
          <Row label="Shipping" value={o.shipping.amountMinor > 0 ? formatMoney(o.shipping.amountMinor, cur) : 'Free'} />
          <div className="border-t border-zinc-100 pt-2"><Row label="Total" value={formatMoney(o.total.amountMinor, cur)} bold /></div>
        </dl>
      </div>

      <div className="mt-8 text-center">
        <Link href={sfPath(slug, '/products')} className="inline-block rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90" style={accentStyle(store)}>
          Continue shopping
        </Link>
      </div>
    </div>
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
