'use client';
import { ModuleTitle } from '@/components/module-title';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, LayoutGrid, type LucideIcon, Package, PackageOpen, Star, Store, Tag, Truck, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { EcStore } from '@/lib/types';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { RailItem } from '@/components/ui/three-pane';
import { PaymentConfigCard } from '@/components/ecommerce/payment-config';
import { CollectionsAdmin } from '@/components/ecommerce/collections-admin';
import { DiscountsAdmin } from '@/components/ecommerce/discounts-admin';
import { OrdersAdmin } from '@/components/ecommerce/orders-admin';
import { ProductsAdmin } from '@/components/ecommerce/products-admin';
import { ReviewsAdmin } from '@/components/ecommerce/reviews-admin';
import { ShippingAdmin } from '@/components/ecommerce/shipping-admin';
import { StoreSettings } from '@/components/ecommerce/store-settings';

const SECTIONS: { key: string; label: string; icon: LucideIcon; tone?: 'default' | 'violet' | 'amber' | 'emerald' | 'sky' }[] = [
  { key: 'storefront', label: 'Storefront', icon: Store },
  { key: 'products', label: 'Products', icon: Package, tone: 'sky' },
  { key: 'collections', label: 'Collections', icon: LayoutGrid, tone: 'violet' },
  { key: 'discounts', label: 'Discounts', icon: Tag, tone: 'amber' },
  { key: 'reviews', label: 'Reviews', icon: Star, tone: 'amber' },
  { key: 'shipping', label: 'Shipping', icon: Truck },
  { key: 'orders', label: 'Orders', icon: PackageOpen, tone: 'emerald' },
  { key: 'accounting', label: 'Accounting', icon: Wallet, tone: 'violet' },
];

export default function EcommercePage() {
  const [section, setSection] = useState('storefront');
  const store = useQuery({ queryKey: ['ec-store'], queryFn: () => apiGet<EcStore>('/ecommerce/store') });
  const slug = store.data?.storefrontSlug;
  const published = store.data?.published;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <ModuleTitle>Online Store</ModuleTitle>
          <p className="text-sm text-muted-foreground">Shopify-style storefront — catalogue, collections, discounts, shipping, and online orders.</p>
        </div>
        {slug && published ? (
          <Link href={`/shop/${slug}`} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"><ExternalLink className="h-4 w-4" /> View store</Link>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/20 p-3 lg:flex">
            {SECTIONS.map((s) => <RailItem key={s.key} icon={s.icon} label={s.label} active={section === s.key} onClick={() => setSection(s.key)} tone={s.tone} />)}
          </aside>
          <section className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 lg:hidden">
              <select value={section} onChange={(e) => setSection(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {section === 'storefront' ? <StoreSettings /> : null}
              {section === 'products' ? <ProductsAdmin /> : null}
              {section === 'collections' ? <CollectionsAdmin /> : null}
              {section === 'discounts' ? <DiscountsAdmin /> : null}
              {section === 'reviews' ? <ReviewsAdmin /> : null}
              {section === 'shipping' ? <ShippingAdmin /> : null}
              {section === 'orders' ? <OrdersAdmin /> : null}
              {section === 'accounting' ? (
                <div className="space-y-6">
                  <PaymentConfigCard />
                  <GlAccountsCard
                    title="Online store → general ledger"
                    description="When set, each placed order posts Dr clearing; Cr revenue (+ tax, + shipping), and Dr COGS / Cr inventory. Requires background reactions enabled."
                    getPath="/ecommerce/gl-config"
                    putPath="/ecommerce/gl-config"
                    queryKey="ec-gl-config"
                    slots={[
                      { key: 'clearingAccountId', label: 'Clearing / receipts (Dr)', required: true },
                      { key: 'revenueAccountId', label: 'Sales revenue (Cr)', types: ['REVENUE'], required: true },
                      { key: 'taxAccountId', label: 'Tax payable (Cr)', types: ['LIABILITY'] },
                      { key: 'shippingAccountId', label: 'Shipping income (Cr)', types: ['REVENUE'] },
                      { key: 'cogsAccountId', label: 'COGS (Dr)', types: ['EXPENSE'] },
                      { key: 'inventoryAccountId', label: 'Inventory (Cr)', types: ['ASSET'] },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
