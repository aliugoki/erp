'use client';
import { createContext, useContext, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShoppingBag, ShoppingCart, Store } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import {
  type SfCart,
  type SfProduct,
  type SfStore,
  getCartToken,
  productImageUrl,
  setCartToken,
  sfPath,
  storeLogoUrl,
} from '@/lib/storefront';
import { formatMoney } from '@/lib/utils';

// ── Store context ───────────────────────────────────────────────────────────────
interface StoreCtx {
  slug: string;
  store: SfStore;
}
const Ctx = createContext<StoreCtx | null>(null);
export function useStore(): StoreCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used within StoreProvider');
  return v;
}
export function StoreProvider({ slug, store, children }: { slug: string; store: SfStore; children: ReactNode }) {
  return <Ctx.Provider value={{ slug, store }}>{children}</Ctx.Provider>;
}

/** Render a hex accent as the brand colour for buttons/badges. */
export const accentStyle = (store: SfStore): React.CSSProperties => ({ backgroundColor: store.accentColor });

// ── Cart hook (server cart, token in localStorage) ──────────────────────────────
export function useCart(slug: string) {
  const qc = useQueryClient();
  const cart = useQuery({
    queryKey: ['sf-cart', slug],
    queryFn: async (): Promise<SfCart | null> => {
      const tok = getCartToken(slug);
      if (!tok) return null;
      try {
        return await apiGet<SfCart>(sfPath(slug, `/cart/${tok}`));
      } catch {
        return null; // stale/converted token — start fresh on next add
      }
    },
  });

  const ensureCart = async (): Promise<string> => {
    const existing = getCartToken(slug);
    if (existing) {
      // Verify it's still an OPEN cart; if not, make a new one.
      try {
        await apiGet<SfCart>(sfPath(slug, `/cart/${existing}`));
        return existing;
      } catch {
        /* fall through to create */
      }
    }
    const created = await apiPost<SfCart>(sfPath(slug, '/cart'), {});
    setCartToken(slug, created.token);
    return created.token;
  };

  const add = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity?: number }) => {
      const tok = await ensureCart();
      return apiPost<SfCart>(sfPath(slug, `/cart/${tok}/items`), { productId, quantity: quantity ?? 1 });
    },
    onSuccess: (c) => {
      qc.setQueryData(['sf-cart', slug], c);
      toast.success('Added to cart');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not add to cart'),
  });

  const count = (cart.data?.items ?? []).reduce((s, i) => s + i.quantity, 0);
  return { cart: cart.data ?? null, loading: cart.isLoading, count, add };
}

// ── Header ──────────────────────────────────────────────────────────────────────
export function StoreHeader() {
  const { slug, store } = useStore();
  const { count } = useCart(slug);
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href={sfPath(slug)} className="flex items-center gap-2">
          {store.hasLogo ? (
            <img src={storeLogoUrl(slug)} alt={store.name} className="h-9 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
              <Store className="h-5 w-5" style={{ color: store.accentColor }} />
              {store.name}
            </span>
          )}
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium text-zinc-600">
          <Link href={sfPath(slug)} className="rounded-md px-3 py-2 hover:bg-zinc-100">Home</Link>
          <Link href={sfPath(slug, '/products')} className="rounded-md px-3 py-2 hover:bg-zinc-100">Shop</Link>
          <Link
            href={sfPath(slug, '/cart')}
            className="relative ml-1 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={accentStyle(store)}
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            {count > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold text-white">
                {count}
              </span>
            ) : null}
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────────
export function StoreFooter() {
  const { store } = useStore();
  return (
    <footer className="mt-16 border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="flex items-center gap-2 text-base font-bold text-zinc-900">
            <Store className="h-4 w-4" style={{ color: store.accentColor }} /> {store.name}
          </p>
          {store.tagline ? <p className="mt-2 text-sm text-zinc-500">{store.tagline}</p> : null}
        </div>
        <div className="text-sm text-zinc-500">
          {store.address ? <p className="whitespace-pre-line">{store.address}</p> : null}
          {store.supportPhone ? <p className="mt-1">{store.supportPhone}</p> : null}
          {store.supportEmail ? <p className="mt-1">{store.supportEmail}</p> : null}
        </div>
        <div className="text-sm text-zinc-400 sm:text-right">
          <p>© {store.name}</p>
          <p className="mt-1">Powered by MetaXperts ERP</p>
        </div>
      </div>
    </footer>
  );
}

// ── Price + product card ────────────────────────────────────────────────────────
export function Price({ product, className = '' }: { product: SfProduct; className?: string }) {
  const onSale = product.compareAt && product.compareAt.amountMinor > product.price.amountMinor;
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="font-semibold text-zinc-900">{formatMoney(product.price.amountMinor, product.price.currency)}</span>
      {onSale ? (
        <span className="text-sm text-zinc-400 line-through">
          {formatMoney(product.compareAt!.amountMinor, product.compareAt!.currency)}
        </span>
      ) : null}
    </div>
  );
}

export function ProductCard({ product }: { product: SfProduct }) {
  const { slug, store } = useStore();
  const { add } = useCart(slug);
  const onSale = product.compareAt && product.compareAt.amountMinor > product.price.amountMinor;
  const soldOut = product.onHand != null && product.onHand <= 0;
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:shadow-lg">
      <Link href={sfPath(slug, `/products/${product.slug}`)} className="relative block aspect-square overflow-hidden bg-zinc-100">
        {product.primaryImageId ? (
          <img
            src={productImageUrl(slug, product.primaryImageId)}
            alt={product.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-300">
            <ShoppingBag className="h-12 w-12" />
          </div>
        )}
        {onSale ? (
          <span className="absolute left-3 top-3 rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white shadow">SALE</span>
        ) : null}
        {soldOut ? (
          <span className="absolute right-3 top-3 rounded-full bg-zinc-900/80 px-2.5 py-1 text-[11px] font-bold text-white">Sold out</span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link href={sfPath(slug, `/products/${product.slug}`)} className="line-clamp-1 font-medium text-zinc-900 hover:underline">
          {product.title}
        </Link>
        {product.subtitle ? <p className="mt-0.5 line-clamp-1 text-sm text-zinc-500">{product.subtitle}</p> : null}
        <div className="mt-3 flex items-center justify-between">
          <Price product={product} />
          <button
            type="button"
            disabled={soldOut || add.isPending}
            onClick={() => add.mutate({ productId: product.id })}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
            style={accentStyle(store)}
            aria-label="Add to cart"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quantity stepper (used on cart) ─────────────────────────────────────────────
export function QtyStepper({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-200">
      <button type="button" disabled={disabled} onClick={() => onChange(Math.max(0, value - 1))} className="flex h-8 w-8 items-center justify-center text-zinc-600 hover:bg-zinc-100 disabled:opacity-40">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-8 text-center text-sm font-medium tabular-nums">{value}</span>
      <button type="button" disabled={disabled} onClick={() => onChange(value + 1)} className="flex h-8 w-8 items-center justify-center text-zinc-600 hover:bg-zinc-100 disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
