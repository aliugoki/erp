'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Headphones, Mail, Minus, Plus, RotateCcw, Search, ShieldCheck,
  ShoppingBag, ShoppingCart, Star, Store, Truck, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import {
  type SfCart, type SfCustomer, type SfProduct, type SfStore,
  clearCustomerToken, customerGet, getCartToken, getCustomerToken,
  productImageUrl, setCartToken, sfPath, storeLogoUrl,
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

/** The store's brand colour as a solid background style. */
export const accentStyle = (store: SfStore): React.CSSProperties => ({ backgroundColor: store.accentColor });
/** A soft tint of the brand colour (8-digit hex alpha) for section backgrounds. */
export const accentSoft = (store: SfStore, alpha = '14'): string => `${store.accentColor}${alpha}`;

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
        return null;
      }
    },
  });

  const ensureCart = async (): Promise<string> => {
    const existing = getCartToken(slug);
    if (existing) {
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
    mutationFn: async ({ productId, variantId, quantity }: { productId: string; variantId?: string; quantity?: number }) => {
      const tok = await ensureCart();
      return apiPost<SfCart>(sfPath(slug, `/cart/${tok}/items`), { productId, variantId, quantity: quantity ?? 1 });
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

// ── Customer session hook ───────────────────────────────────────────────────────
export function useCustomer(slug: string) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sf-customer', slug],
    queryFn: async (): Promise<SfCustomer | null> => {
      if (!getCustomerToken(slug)) return null;
      try {
        return await customerGet<SfCustomer>(slug, '/account/me');
      } catch {
        clearCustomerToken(slug);
        return null;
      }
    },
  });
  const logout = () => {
    clearCustomerToken(slug);
    qc.setQueryData(['sf-customer', slug], null);
  };
  return { customer: q.data ?? null, loading: q.isLoading, logout };
}

// ── Header ──────────────────────────────────────────────────────────────────────
export function StoreHeader() {
  const { slug, store } = useStore();
  const { count } = useCart(slug);
  const { customer } = useCustomer(slug);
  const router = useRouter();
  const [q, setQ] = useState('');

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(sfPath(slug, `/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`));
  };

  return (
    <>
      {/* Announcement bar */}
      <div className="text-center text-xs font-medium tracking-wide text-white" style={accentStyle(store)}>
        <div className="mx-auto max-w-7xl px-4 py-2">
          ✦ Free shipping on orders over a threshold · Secure checkout · {store.supportPhone || 'We’re here to help'}
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:gap-8">
          <Link href={sfPath(slug)} className="flex shrink-0 items-center gap-2">
            {store.hasLogo ? (
              <img src={storeLogoUrl(slug)} alt={store.name} className="h-9 w-auto max-w-[180px] object-contain" />
            ) : (
              <span className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-zinc-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={accentStyle(store)}>
                  <Store className="h-4 w-4" />
                </span>
                {store.name}
              </span>
            )}
          </Link>

          {/* Search (desktop) */}
          <form onSubmit={search} className="hidden flex-1 md:block">
            <div className="relative mx-auto max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search products…"
                className="h-10 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-10 pr-4 text-sm text-zinc-900 outline-none transition focus:border-zinc-300 focus:bg-white"
              />
            </div>
          </form>

          <nav className="ml-auto flex items-center gap-1 text-sm font-medium text-zinc-700">
            <Link href={sfPath(slug, '/products')} className="hidden rounded-lg px-3 py-2 hover:bg-zinc-100 sm:block">Shop</Link>
            <Link href={sfPath(slug, customer ? '/account/orders' : '/account')} className="flex items-center gap-1.5 rounded-lg px-3 py-2 hover:bg-zinc-100">
              <User className="h-[18px] w-[18px]" />
              <span className="hidden lg:inline">{customer ? customer.name.split(' ')[0] : 'Account'}</span>
            </Link>
            <Link href={sfPath(slug, '/cart')} className="relative flex items-center gap-2 rounded-full px-4 py-2 font-semibold text-white shadow-sm transition hover:opacity-90" style={accentStyle(store)}>
              <ShoppingCart className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">Cart</span>
              {count > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold text-white ring-2 ring-white">{count}</span>
              ) : null}
            </Link>
          </nav>
        </div>

        {/* Search (mobile) */}
        <form onSubmit={search} className="border-t border-zinc-100 px-4 py-2 md:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="h-10 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-10 pr-4 text-sm outline-none" />
          </div>
        </form>
      </header>
    </>
  );
}

// ── Benefits / trust bar ─────────────────────────────────────────────────────────
const BENEFITS = [
  { icon: Truck, title: 'Fast delivery', text: 'Quick, tracked shipping' },
  { icon: ShieldCheck, title: 'Secure checkout', text: 'Encrypted payments' },
  { icon: RotateCcw, title: 'Easy returns', text: 'Hassle-free refunds' },
  { icon: Headphones, title: 'Support', text: 'We’re here to help' },
];
export function BenefitsBar() {
  const { store } = useStore();
  return (
    <section className="border-y border-zinc-100 bg-white">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-6 lg:grid-cols-4">
        {BENEFITS.map((b) => (
          <div key={b.title} className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: accentSoft(store), color: store.accentColor }}>
              <b.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900">{b.title}</p>
              <p className="truncate text-xs text-zinc-500">{b.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────────
export function StoreFooter() {
  const { slug, store } = useStore();
  return (
    <footer className="mt-20 border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 text-lg font-extrabold text-zinc-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={accentStyle(store)}><Store className="h-4 w-4" /></span>
            {store.name}
          </p>
          {store.tagline ? <p className="mt-3 max-w-xs text-sm text-zinc-500">{store.tagline}</p> : null}
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-900">Shop</p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-500">
            <li><Link href={sfPath(slug, '/products')} className="hover:text-zinc-900">All products</Link></li>
            <li><Link href={sfPath(slug, '/products?sort=price_asc')} className="hover:text-zinc-900">Best value</Link></li>
            <li><Link href={sfPath(slug)} className="hover:text-zinc-900">Featured</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-900">Help</p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-500">
            <li><Link href={sfPath(slug, '/account')} className="hover:text-zinc-900">My account</Link></li>
            <li><Link href={sfPath(slug, '/account/orders')} className="hover:text-zinc-900">Track orders</Link></li>
            {store.supportEmail ? <li><a href={`mailto:${store.supportEmail}`} className="hover:text-zinc-900">{store.supportEmail}</a></li> : null}
            {store.supportPhone ? <li>{store.supportPhone}</li> : null}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-900">Stay in the loop</p>
          <p className="mt-3 text-sm text-zinc-500">Get new arrivals & offers in your inbox.</p>
          <form onSubmit={(e) => { e.preventDefault(); toast.success('Thanks for subscribing!'); (e.currentTarget.querySelector('input') as HTMLInputElement).value = ''; }} className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="email" required placeholder="you@email.com" className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-zinc-400" />
            </div>
            <button type="submit" className="rounded-lg px-4 text-sm font-semibold text-white" style={accentStyle(store)}>Join</button>
          </form>
        </div>
      </div>
      <div className="border-t border-zinc-200">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-zinc-400 sm:flex-row">
          <p>© {store.name}. All rights reserved.</p>
          <p>Powered by MetaXperts ERP</p>
        </div>
      </div>
    </footer>
  );
}

// ── Image placeholder (no product photo yet) ─────────────────────────────────────
export function ProductPlaceholder({ store, label }: { store: SfStore; label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: `linear-gradient(135deg, ${accentSoft(store, '22')}, ${accentSoft(store, '08')})` }}>
      {label ? (
        <span className="text-4xl font-black uppercase tracking-tight" style={{ color: store.accentColor, opacity: 0.55 }}>{label.slice(0, 2)}</span>
      ) : (
        <ShoppingBag className="h-12 w-12" style={{ color: store.accentColor, opacity: 0.5 }} />
      )}
    </div>
  );
}

// ── Price + product card ────────────────────────────────────────────────────────
export function Price({ product, className = '' }: { product: SfProduct; className?: string }) {
  const onSale = product.compareAt && product.compareAt.amountMinor > product.price.amountMinor;
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="font-bold text-zinc-900">{formatMoney(product.price.amountMinor, product.price.currency)}</span>
      {onSale ? <span className="text-sm text-zinc-400 line-through">{formatMoney(product.compareAt!.amountMinor, product.compareAt!.currency)}</span> : null}
    </div>
  );
}

export function ProductCard({ product }: { product: SfProduct }) {
  const { slug, store } = useStore();
  const { add } = useCart(slug);
  const onSale = product.compareAt && product.compareAt.amountMinor > product.price.amountMinor;
  const soldOut = product.onHand != null && product.onHand <= 0;
  const off = onSale ? Math.round((1 - product.price.amountMinor / product.compareAt!.amountMinor) * 100) : 0;
  const href = sfPath(slug, `/products/${product.slug}`);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-100 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-zinc-200 hover:shadow-xl">
      <div className="relative aspect-[4/5] overflow-hidden bg-zinc-50">
        <Link href={href} className="block h-full w-full">
          {product.primaryImageId ? (
            <img src={productImageUrl(slug, product.primaryImageId)} alt={product.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
          ) : (
            <ProductPlaceholder store={store} label={product.title} />
          )}
        </Link>
        {/* Badges */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
          {onSale ? <span className="rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white shadow">-{off}%</span> : null}
          {!soldOut && product.onHand != null && product.onHand <= 5 ? <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white shadow">Low stock</span> : null}
        </div>
        {soldOut ? <div className="absolute inset-0 flex items-center justify-center bg-white/60"><span className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-bold text-white">Sold out</span></div> : null}
        {/* Quick add (hover) */}
        {!soldOut ? (
          <button
            type="button"
            disabled={add.isPending}
            onClick={() => add.mutate({ productId: product.id })}
            className="absolute inset-x-3 bottom-3 flex translate-y-3 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white opacity-0 shadow-lg transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 disabled:opacity-60"
            style={accentStyle(store)}
          >
            <Plus className="h-4 w-4" /> Add to cart
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        {product.category ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{product.category}</p> : null}
        <Link href={href} className="line-clamp-1 font-semibold text-zinc-900 transition hover:text-zinc-600">{product.title}</Link>
        {product.ratingCount ? (
          <div className="mt-1 flex items-center gap-1.5"><Stars value={product.ratingAvg ?? 0} size={13} /><span className="text-xs text-zinc-400">({product.ratingCount})</span></div>
        ) : product.subtitle ? (
          <p className="mt-1 line-clamp-1 text-sm text-zinc-500">{product.subtitle}</p>
        ) : null}
        <div className="mt-3">
          <Price product={product} />
        </div>
      </div>
    </div>
  );
}

// ── Star rating ─────────────────────────────────────────────────────────────────
export function Stars({ value, size = 16, onChange }: { value: number; size?: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const Cmp = onChange ? 'button' : 'span';
        return (
          <Cmp
            key={n}
            {...(onChange ? { type: 'button' as const, onClick: () => onChange(n) } : {})}
            className={onChange ? 'cursor-pointer' : ''}
            aria-label={onChange ? `${n} star${n > 1 ? 's' : ''}` : undefined}
          >
            <Star style={{ width: size, height: size }} className={filled ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'} />
          </Cmp>
        );
      })}
    </div>
  );
}

// ── Quantity stepper ──────────────────────────────────────────────────────────────
export function QtyStepper({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-200">
      <button type="button" disabled={disabled} onClick={() => onChange(Math.max(0, value - 1))} className="flex h-9 w-9 items-center justify-center text-zinc-600 hover:bg-zinc-100 disabled:opacity-40">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-9 text-center text-sm font-medium tabular-nums">{value}</span>
      <button type="button" disabled={disabled} onClick={() => onChange(value + 1)} className="flex h-9 w-9 items-center justify-center text-zinc-600 hover:bg-zinc-100 disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
