'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, PackageSearch } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfHome, type SfProduct, sfPath } from '@/lib/storefront';
import { ProductCard, accentStyle, useStore } from '@/components/store/store-ui';

export default function CatalogPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const router = useRouter();
  const sp = useSearchParams();
  const collection = sp.get('collection') ?? '';
  const q = sp.get('q') ?? '';
  const sort = sp.get('sort') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${sfPath(slug, '/products')}${next.toString() ? `?${next}` : ''}`);
  };

  const home = useQuery({ queryKey: ['sf-home', slug], queryFn: () => apiGet<SfHome>(sfPath(slug)) });
  const collections = home.data?.collections ?? [];

  const products = useQuery({
    queryKey: ['sf-products', slug, collection, q, sort],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (collection) qs.set('collection', collection);
      if (q) qs.set('q', q);
      if (sort) qs.set('sort', sort);
      return apiGet<SfProduct[]>(sfPath(slug, `/products${qs.toString() ? `?${qs}` : ''}`));
    },
  });

  const activeCollection = collections.find((c) => c.slug === collection);
  const title = activeCollection?.title ?? (q ? `Results for “${q}”` : 'All products');
  const list = products.data ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-zinc-400">
        <Link href={sfPath(slug)} className="hover:text-zinc-700">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-zinc-700">{title}</span>
      </nav>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-900">{title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{products.isLoading ? 'Loading…' : `${list.length} product${list.length === 1 ? '' : 's'}`}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          Sort
          <select value={sort} onChange={(e) => setParam('sort', e.target.value)} className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-zinc-400">
            <option value="">Featured</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
        </label>
      </div>

      {/* Collection filter chips */}
      {collections.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <Chip active={!collection} onClick={() => setParam('collection', '')} store={store}>All</Chip>
          {collections.map((c) => (
            <Chip key={c.id} active={collection === c.slug} onClick={() => setParam('collection', c.slug)} store={store}>{c.title}</Chip>
          ))}
        </div>
      ) : null}

      {/* Grid */}
      <div className="mt-8">
        {products.isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 py-24 text-center">
            <PackageSearch className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-zinc-500">No products match your search.</p>
            <button type="button" onClick={() => router.replace(sfPath(slug, '/products'))} className="mt-4 rounded-full px-5 py-2 text-sm font-semibold text-white" style={accentStyle(store)}>Clear filters</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {list.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, store, children }: { active: boolean; onClick: () => void; store: ReturnType<typeof useStore>['store']; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${active ? 'border-transparent text-white shadow-sm' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}
      style={active ? accentStyle(store) : undefined}
    >
      {children}
    </button>
  );
}
