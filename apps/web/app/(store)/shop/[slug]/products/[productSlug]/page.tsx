'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Loader2, ShoppingBag, ShoppingCart } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfProduct, productImageUrl, sfPath } from '@/lib/storefront';
import { QtyStepper, accentStyle, useCart, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

export default function ProductDetail({ params }: { params: { slug: string; productSlug: string } }) {
  const { slug, productSlug } = params;
  const { store } = useStore();
  const { add } = useCart(slug);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);

  const product = useQuery({
    queryKey: ['sf-product', slug, productSlug],
    queryFn: () => apiGet<SfProduct>(sfPath(slug, `/products/${productSlug}`)),
  });

  if (product.isLoading) {
    return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  }
  if (product.isError || !product.data) {
    return (
      <div className="mx-auto max-w-md px-4 py-32 text-center text-zinc-500">
        <p>Product not found.</p>
        <Link href={sfPath(slug, '/products')} className="mt-3 inline-block text-sm font-medium" style={{ color: store.accentColor }}>Back to shop</Link>
      </div>
    );
  }

  const p = product.data;
  const images = p.images ?? [];
  const onSale = p.compareAt && p.compareAt.amountMinor > p.price.amountMinor;
  const soldOut = p.onHand != null && p.onHand <= 0;
  const selected = images[activeImg] ?? images[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href={sfPath(slug, '/products')} className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900">
        <ChevronLeft className="h-4 w-4" /> Back to shop
      </Link>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Gallery */}
        <div>
          <div className="aspect-square overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
            {selected ? (
              <img src={productImageUrl(slug, selected.id)} alt={p.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-300"><ShoppingBag className="h-16 w-16" /></div>
            )}
          </div>
          {images.length > 1 ? (
            <div className="mt-3 flex gap-3 overflow-x-auto">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActiveImg(i)}
                  className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${i === activeImg ? 'border-zinc-900' : 'border-transparent'}`}
                >
                  <img src={productImageUrl(slug, img.id)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Details */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{p.title}</h1>
          {p.subtitle ? <p className="mt-1 text-lg text-zinc-500">{p.subtitle}</p> : null}

          <div className="mt-5 flex items-center gap-3">
            <span className="text-2xl font-bold text-zinc-900">{formatMoney(p.price.amountMinor, p.price.currency)}</span>
            {onSale ? (
              <>
                <span className="text-lg text-zinc-400 line-through">{formatMoney(p.compareAt!.amountMinor, p.compareAt!.currency)}</span>
                <span className="rounded-full bg-rose-500 px-2.5 py-1 text-xs font-bold text-white">SALE</span>
              </>
            ) : null}
          </div>

          <div className="mt-2 text-sm">
            {soldOut ? (
              <span className="font-medium text-rose-600">Out of stock</span>
            ) : p.onHand != null && p.onHand <= 5 ? (
              <span className="font-medium text-amber-600">Only {p.onHand} left</span>
            ) : (
              <span className="font-medium text-emerald-600">In stock</span>
            )}
          </div>

          {p.description ? <p className="mt-6 whitespace-pre-line leading-relaxed text-zinc-600">{p.description}</p> : null}

          <div className="mt-8 flex items-center gap-4">
            <QtyStepper value={qty} onChange={(v) => setQty(Math.max(1, v))} disabled={soldOut} />
            <button
              type="button"
              disabled={soldOut || add.isPending}
              onClick={() => add.mutate({ productId: p.id, quantity: qty })}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40"
              style={accentStyle(store)}
            >
              <ShoppingCart className="h-4 w-4" /> {soldOut ? 'Sold out' : 'Add to cart'}
            </button>
          </div>
          {p.sku ? <p className="mt-4 text-xs text-zinc-400">SKU: {p.sku}</p> : null}
        </div>
      </div>
    </div>
  );
}
