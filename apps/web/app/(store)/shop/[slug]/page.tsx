'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { type SfHome, sfPath, storeHeroUrl } from '@/lib/storefront';
import { BenefitsBar, ProductCard, accentSoft, accentStyle, useStore } from '@/components/store/store-ui';

export default function StoreHome({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const home = useQuery({ queryKey: ['sf-home', slug], queryFn: () => apiGet<SfHome>(sfPath(slug)) });
  const data = home.data;
  const hasProducts = !!data && (data.featured.length > 0 || data.newest.length > 0);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-zinc-950">
        {store.hasHero ? (
          <img src={storeHeroUrl(slug)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        ) : null}
        <div className="absolute inset-0" style={{ background: `radial-gradient(60% 80% at 15% 20%, ${accentSoft(store, 'cc')}, transparent), radial-gradient(50% 70% at 90% 80%, ${accentSoft(store, '99')}, transparent)` }} />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:py-32">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white ring-1 ring-white/20 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" /> {store.tagline ?? 'New collection'}
            </span>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-6xl">
              {store.heroHeadline ?? store.name}
            </h1>
            {store.heroSubtext || store.description ? (
              <p className="mt-5 max-w-xl text-lg text-zinc-300">{store.heroSubtext ?? store.description}</p>
            ) : null}
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href={sfPath(slug, '/products')} className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold text-white shadow-lg transition hover:opacity-90" style={accentStyle(store)}>
                Shop now <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={sfPath(slug, '/products')} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-7 py-3.5 text-sm font-bold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/20">
                Browse all
              </Link>
            </div>
          </div>
        </div>
      </section>

      <BenefitsBar />

      <div className="mx-auto max-w-7xl px-4 py-14">
        {/* Collections */}
        {data && data.collections.length > 0 ? (
          <section className="mb-14">
            <SectionHead title="Shop by collection" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {data.collections.slice(0, 8).map((c) => (
                <Link
                  key={c.id}
                  href={sfPath(slug, `/products?collection=${c.slug}`)}
                  className="group relative flex aspect-[5/3] flex-col justify-end overflow-hidden rounded-2xl p-5 ring-1 ring-zinc-100 transition hover:ring-zinc-200"
                  style={{ background: `linear-gradient(135deg, ${accentSoft(store, '22')}, ${accentSoft(store, '0a')})` }}
                >
                  <span className="text-base font-bold text-zinc-900">{c.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-zinc-500">
                    {c.productCount != null ? `${c.productCount} items` : 'Shop'} <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Featured */}
        {data && data.featured.length > 0 ? (
          <section className="mb-16">
            <SectionHead title="Featured" subtitle="Hand-picked favourites" href={sfPath(slug, '/products')} />
            <Grid>{data.featured.map((p) => <ProductCard key={p.id} product={p} />)}</Grid>
          </section>
        ) : null}

        {/* Promo band */}
        <section className="mb-16 overflow-hidden rounded-3xl px-8 py-12 text-center sm:px-16 sm:py-16" style={{ background: `linear-gradient(120deg, ${store.accentColor}, ${store.accentColor}cc)` }}>
          <h2 className="text-2xl font-black text-white sm:text-3xl">{store.heroHeadline ? 'Quality you can trust' : `Welcome to ${store.name}`}</h2>
          <p className="mx-auto mt-3 max-w-lg text-white/80">Free, fast shipping and secure checkout on every order. Discover something you’ll love today.</p>
          <Link href={sfPath(slug, '/products')} className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-bold text-zinc-900 shadow transition hover:bg-zinc-100">
            Explore the catalogue <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        {/* New arrivals */}
        {data && data.newest.length > 0 ? (
          <section>
            <SectionHead title="New arrivals" subtitle="Fresh in store" href={sfPath(slug, '/products')} />
            <Grid>{data.newest.map((p) => <ProductCard key={p.id} product={p} />)}</Grid>
          </section>
        ) : null}

        {!hasProducts ? (
          <p className="py-20 text-center text-zinc-500">No products yet — check back soon.</p>
        ) : null}
      </div>
    </div>
  );
}

function SectionHead({ title, subtitle, href }: { title: string; subtitle?: string; href?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {subtitle ? <p className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{subtitle}</p> : null}
        <h2 className="text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">{title}</h2>
      </div>
      {href ? <Link href={href} className="shrink-0 text-sm font-semibold text-zinc-500 hover:text-zinc-900">View all →</Link> : null}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
