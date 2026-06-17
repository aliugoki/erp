'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfProduct, sfPath } from '@/lib/storefront';
import { ProductCard, useStore } from '@/components/store/store-ui';

export default function CatalogPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  useStore(); // ensure within store shell
  const search = useSearchParams();
  const collection = search.get('collection') ?? '';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');

  const products = useQuery({
    queryKey: ['sf-products', slug, collection, q, sort],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (collection) qs.set('collection', collection);
      if (q) qs.set('q', q);
      if (sort) qs.set('sort', sort);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return apiGet<SfProduct[]>(sfPath(slug, `/products${suffix}`));
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {collection ? `Collection: ${collection}` : 'All products'}
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="h-9 w-44 rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-zinc-400"
          >
            <option value="">Sort</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
        </div>
      </div>

      {products.isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : (products.data ?? []).length === 0 ? (
        <p className="py-20 text-center text-zinc-500">No products match your search.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.data!.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
