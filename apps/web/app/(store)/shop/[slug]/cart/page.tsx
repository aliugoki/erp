'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingBag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { type SfCart, getCartToken, productImageUrl, sfPath } from '@/lib/storefront';
import { QtyStepper, StoreImage, accentStyle, useCart, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

export default function CartPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const qc = useQueryClient();
  const { cart, loading } = useCart(slug);
  const [coupon, setCoupon] = useState('');

  const tok = getCartToken(slug);
  const setCart = (c: SfCart) => qc.setQueryData(['sf-cart', slug], c);

  const update = useMutation({
    mutationFn: ({ productId, variantId, quantity }: { productId: string; variantId: string | null; quantity: number }) =>
      apiPatch<SfCart>(sfPath(slug, `/cart/${tok}/items/${productId}`), { quantity, variantId: variantId ?? undefined }),
    onSuccess: setCart,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  });

  const applyCoupon = useMutation({
    mutationFn: () => apiPost<SfCart>(sfPath(slug, `/cart/${tok}/coupon`), { code: coupon }),
    onSuccess: (c) => { setCart(c); toast.success('Coupon applied'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Invalid coupon'),
  });

  const refresh = () => { if (tok) void apiGet<SfCart>(sfPath(slug, `/cart/${tok}`)).then(setCart); };

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;

  const items = cart?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-28 text-center">
        <ShoppingBag className="mx-auto h-12 w-12 text-zinc-300" />
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">Your cart is empty</h1>
        <Link href={sfPath(slug, '/products')} className="mt-4 inline-block rounded-full px-6 py-3 text-sm font-semibold text-white" style={accentStyle(store)}>
          Start shopping
        </Link>
      </div>
    );
  }

  const t = cart!.totals;
  const cur = cart!.currency;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-zinc-900">Your cart</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Items */}
        <div className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200">
          {items.map((it) => (
            <div key={it.productId + (it.variantId ?? '')} className="flex items-center gap-4 p-4">
              <Link href={sfPath(slug, `/products/${it.slug}`)} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                {it.primaryImageId ? (
                  <StoreImage src={productImageUrl(slug, it.primaryImageId)} alt={it.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-300"><ShoppingBag className="h-6 w-6" /></div>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={sfPath(slug, `/products/${it.slug}`)} className="line-clamp-1 font-medium text-zinc-900 hover:underline">{it.title}</Link>
                {it.variantLabel ? <p className="text-xs text-zinc-500">{it.variantLabel}</p> : null}
                <p className="mt-0.5 text-sm text-zinc-500">{formatMoney(it.unitPriceMinor, cur)} each</p>
                <div className="mt-2">
                  <QtyStepper value={it.quantity} disabled={update.isPending} onChange={(v) => update.mutate({ productId: it.productId, variantId: it.variantId, quantity: v })} />
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums text-zinc-900">{formatMoney(it.lineTotalMinor, cur)}</p>
                <button type="button" onClick={() => update.mutate({ productId: it.productId, variantId: it.variantId, quantity: 0 })} className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="h-fit rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Order summary</h2>
          <div className="mt-4 flex gap-2">
            <input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value)}
              placeholder="Discount code"
              className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm uppercase text-zinc-900 outline-none focus:border-zinc-400"
            />
            <button type="button" disabled={!coupon || applyCoupon.isPending} onClick={() => applyCoupon.mutate()} className="rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40">
              Apply
            </button>
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            <Row label="Subtotal" value={formatMoney(t.subtotalMinor, cur)} />
            {t.discountMinor > 0 ? <Row label={`Discount${cart!.discountCode ? ` (${cart!.discountCode})` : ''}`} value={`−${formatMoney(t.discountMinor, cur)}`} accent /> : null}
            {t.taxMinor > 0 ? <Row label="Tax" value={formatMoney(t.taxMinor, cur)} /> : null}
            <Row label="Shipping" value={t.shippingMinor > 0 ? formatMoney(t.shippingMinor, cur) : 'Free'} />
            <div className="border-t border-zinc-200 pt-3">
              <Row label="Total" value={formatMoney(t.totalMinor, cur)} bold />
            </div>
          </dl>
          <Link
            href={sfPath(slug, '/checkout')}
            onClick={refresh}
            className="mt-5 block rounded-full py-3 text-center text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
            style={accentStyle(store)}
          >
            Proceed to checkout
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={bold ? 'font-semibold text-zinc-900' : 'text-zinc-600'}>{label}</dt>
      <dd className={`tabular-nums ${bold ? 'text-base font-bold text-zinc-900' : accent ? 'text-emerald-600' : 'text-zinc-900'}`}>{value}</dd>
    </div>
  );
}
