'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfHome, sfPath, storeHeroUrl } from '@/lib/storefront';
import { ProductCard, accentStyle, useStore } from '@/components/store/store-ui';

export default function StoreHome({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const home = useQuery({ queryKey: ['sf-home', slug], queryFn: () => apiGet<SfHome>(sfPath(slug)) });
  const data = home.data;

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${store.accentColor}22, ${store.accentColor}05)` }}
        />
        {store.hasHero ? (
          <img src={storeHeroUrl(slug)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        ) : null}
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="max-w-2xl">
            <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white" style={accentStyle(store)}>
              {store.tagline ?? 'Welcome'}
            </span>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-zinc-900 sm:text-5xl">
              {store.heroHeadline ?? store.name}
            </h1>
            {store.heroSubtext || store.description ? (
              <p className="mt-4 text-lg text-zinc-600">{store.heroSubtext ?? store.description}</p>
            ) : null}
            <Link
              href={sfPath(slug, '/products')}
              className="mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
              style={accentStyle(store)}
            >
              Shop now <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12">
        {/* Collections */}
        {data && data.collections.length > 0 ? (
          <section className="mb-12">
            <div className="flex flex-wrap gap-3">
              {data.collections.map((c) => (
                <Link
                  key={c.id}
                  href={sfPath(slug, `/products?collection=${c.slug}`)}
                  className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:shadow-sm"
                >
                  {c.title}
                  {c.productCount != null ? <span className="ml-1.5 text-zinc-400">({c.productCount})</span> : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Featured */}
        {data && data.featured.length > 0 ? (
          <Section title="Featured" href={sfPath(slug, '/products')} slug={slug}>
            <Grid>{data.featured.map((p) => <ProductCard key={p.id} product={p} />)}</Grid>
          </Section>
        ) : null}

        {/* Newest */}
        {data && data.newest.length > 0 ? (
          <Section title="New arrivals" href={sfPath(slug, '/products')} slug={slug}>
            <Grid>{data.newest.map((p) => <ProductCard key={p.id} product={p} />)}</Grid>
          </Section>
        ) : null}

        {data && data.featured.length === 0 && data.newest.length === 0 ? (
          <p className="py-16 text-center text-zinc-500">No products yet — check back soon.</p>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, href, children }: { title: string; href: string; slug: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h2>
        <Link href={href} className="text-sm font-medium text-zinc-500 hover:text-zinc-900">View all →</Link>
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
