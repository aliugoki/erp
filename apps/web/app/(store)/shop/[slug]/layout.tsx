'use client';
import { type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Store } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfHome, sfPath } from '@/lib/storefront';
import { StoreFooter, StoreHeader, StoreProvider } from '@/components/store/store-ui';

/** Public storefront shell. Fetches the store once (shared cache key with the home page), renders a
 * clean light-themed frame independent of the dashboard theme, and shows a friendly 404 for an
 * unknown / unpublished store. */
export default function StoreLayout({ children, params }: { children: ReactNode; params: { slug: string } }) {
  const slug = params.slug;
  const home = useQuery({ queryKey: ['sf-home', slug], queryFn: () => apiGet<SfHome>(sfPath(slug)) });

  if (home.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (home.isError || !home.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center text-zinc-600">
        <Store className="h-10 w-10 text-zinc-300" />
        <h1 className="text-xl font-semibold text-zinc-900">Store not found</h1>
        <p className="max-w-sm text-sm">This store doesn’t exist or isn’t open yet. Check the link and try again.</p>
        <Link href="/" className="mt-2 text-sm font-medium text-indigo-600 hover:underline">Go to MetaXperts</Link>
      </div>
    );
  }

  return (
    <StoreProvider slug={slug} store={home.data.store}>
      <div className="flex min-h-screen flex-col bg-white text-zinc-900">
        <StoreHeader />
        <main className="flex-1">{children}</main>
        <StoreFooter />
      </div>
    </StoreProvider>
  );
}
