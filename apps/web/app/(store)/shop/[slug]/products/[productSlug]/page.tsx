'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, RotateCcw, ShieldCheck, ShoppingBag, ShoppingCart, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet } from '@/lib/api';
import { type SfProduct, customerPost, productImageUrl, sfPath } from '@/lib/storefront';
import { QtyStepper, Stars, accentStyle, useCart, useCustomer, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

export default function ProductDetail({ params }: { params: { slug: string; productSlug: string } }) {
  const { slug, productSlug } = params;
  const { store } = useStore();
  const { add } = useCart(slug);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  const [variantId, setVariantId] = useState<string | null>(null);

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
  const variants = p.variants ?? [];
  const activeVariant = variants.find((v) => v.id === variantId) ?? variants.find((v) => v.isDefault) ?? variants[0] ?? null;
  const price = activeVariant?.price ?? p.price;
  const compareAt = activeVariant?.compareAt ?? p.compareAt;
  const onHand = activeVariant ? activeVariant.onHand : p.onHand;
  const onSale = compareAt && compareAt.amountMinor > price.amountMinor;
  const soldOut = onHand != null && onHand <= 0;
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
          {p.category ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{p.category}</p> : null}
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{p.title}</h1>
          {p.subtitle ? <p className="mt-1 text-lg text-zinc-500">{p.subtitle}</p> : null}
          {p.ratingCount ? (
            <a href="#reviews" className="mt-2 flex items-center gap-2 text-sm">
              <Stars value={p.ratingAvg ?? 0} />
              <span className="text-zinc-500">{(p.ratingAvg ?? 0).toFixed(1)} · {p.ratingCount} review{p.ratingCount > 1 ? 's' : ''}</span>
            </a>
          ) : null}

          <div className="mt-5 flex items-center gap-3">
            <span className="text-2xl font-bold text-zinc-900">{formatMoney(price.amountMinor, price.currency)}</span>
            {onSale ? (
              <>
                <span className="text-lg text-zinc-400 line-through">{formatMoney(compareAt!.amountMinor, compareAt!.currency)}</span>
                <span className="rounded-full bg-rose-500 px-2.5 py-1 text-xs font-bold text-white">SALE</span>
              </>
            ) : null}
          </div>

          <div className="mt-2 text-sm">
            {soldOut ? (
              <span className="font-medium text-rose-600">Out of stock</span>
            ) : onHand != null && onHand <= 5 ? (
              <span className="font-medium text-amber-600">Only {onHand} left</span>
            ) : (
              <span className="font-medium text-emerald-600">In stock</span>
            )}
          </div>

          {variants.length > 0 ? (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-zinc-700">Options</p>
              <div className="flex flex-wrap gap-2">
                {variants.map((v) => {
                  const out = v.onHand != null && v.onHand <= 0;
                  const on = activeVariant?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={out}
                      onClick={() => setVariantId(v.id)}
                      className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'text-white' : 'border-zinc-200 text-zinc-700 hover:border-zinc-400'}`}
                      style={on ? { backgroundColor: store.accentColor, borderColor: store.accentColor } : undefined}
                    >
                      {v.label}{out ? ' — sold out' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {p.description ? <p className="mt-6 whitespace-pre-line leading-relaxed text-zinc-600">{p.description}</p> : null}

          <div className="mt-8 flex items-center gap-4">
            <QtyStepper value={qty} onChange={(v) => setQty(Math.max(1, v))} disabled={soldOut} />
            <button
              type="button"
              disabled={soldOut || add.isPending}
              onClick={() => add.mutate({ productId: p.id, variantId: activeVariant?.id, quantity: qty })}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40"
              style={accentStyle(store)}
            >
              <ShoppingCart className="h-4 w-4" /> {soldOut ? 'Sold out' : 'Add to cart'}
            </button>
          </div>
          {p.sku ? <p className="mt-4 text-xs text-zinc-400">SKU: {p.sku}</p> : null}

          {/* Trust strip */}
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-6">
            {[
              { icon: Truck, label: 'Fast, tracked delivery' },
              { icon: ShieldCheck, label: 'Secure checkout' },
              { icon: RotateCcw, label: 'Easy returns' },
            ].map((t) => (
              <div key={t.label} className="flex flex-col items-center gap-1.5 text-center">
                <t.icon className="h-5 w-5" style={{ color: store.accentColor }} />
                <span className="text-[11px] font-medium leading-tight text-zinc-500">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ReviewsSection slug={slug} product={p} />
    </div>
  );
}

function ReviewsSection({ slug, product }: { slug: string; product: SfProduct }) {
  const { store } = useStore();
  const { customer } = useCustomer(slug);
  const qc = useQueryClient();
  const reviews = product.reviews ?? [];
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const submit = useMutation({
    mutationFn: () => customerPost(slug, `/products/${product.id}/reviews`, { rating, title: title || undefined, body: body || undefined }),
    onSuccess: () => {
      toast.success('Thanks! Your review will appear once approved.');
      setTitle(''); setBody(''); setRating(5);
      void qc.invalidateQueries({ queryKey: ['sf-product', slug, product.slug] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not submit review'),
  });

  return (
    <section id="reviews" className="mt-14 border-t border-zinc-100 pt-10">
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Reviews</h2>
      <div className="mt-2 flex items-center gap-3">
        <Stars value={product.ratingAvg ?? 0} size={18} />
        <span className="text-sm text-zinc-500">{product.ratingCount ? `${(product.ratingAvg ?? 0).toFixed(1)} out of 5 · ${product.ratingCount} review${product.ratingCount > 1 ? 's' : ''}` : 'No reviews yet'}</span>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
        {/* List */}
        <div className="space-y-6">
          {reviews.length === 0 ? (
            <p className="text-sm text-zinc-500">Be the first to review this product.</p>
          ) : reviews.map((r) => (
            <div key={r.id} className="border-b border-zinc-100 pb-5 last:border-0">
              <div className="flex items-center gap-2">
                <Stars value={r.rating} size={14} />
                {r.verified ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> Verified purchase</span> : null}
              </div>
              {r.title ? <p className="mt-2 font-semibold text-zinc-900">{r.title}</p> : null}
              {r.body ? <p className="mt-1 text-sm text-zinc-600">{r.body}</p> : null}
              <p className="mt-2 text-xs text-zinc-400">{r.authorName}{r.createdAt ? ` · ${new Date(r.createdAt).toLocaleDateString()}` : ''}</p>
            </div>
          ))}
        </div>

        {/* Write a review */}
        <div className="h-fit rounded-2xl border border-zinc-200 p-5">
          <h3 className="text-sm font-semibold text-zinc-900">Write a review</h3>
          {customer ? (
            <div className="mt-3 space-y-3">
              <div><span className="mb-1 block text-xs text-zinc-500">Your rating</span><Stars value={rating} size={24} onChange={setRating} /></div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Share your thoughts" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
              <button type="button" disabled={submit.isPending} onClick={() => submit.mutate()} className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={accentStyle(store)}>
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit review
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              <Link href={sfPath(slug, '/account')} className="font-medium" style={{ color: store.accentColor }}>Sign in</Link> to write a review.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
