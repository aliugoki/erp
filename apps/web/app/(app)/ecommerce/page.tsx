'use client';
import { useState } from 'react';
import { LayoutGrid, Package, PackageOpen, Star, Store, Tag, Truck, Wallet } from 'lucide-react';
import { GlAccountsCard } from '@/components/finance/gl-accounts-card';
import { PaymentConfigCard } from '@/components/ecommerce/payment-config';
import { CollectionsAdmin } from '@/components/ecommerce/collections-admin';
import { DiscountsAdmin } from '@/components/ecommerce/discounts-admin';
import { OrdersAdmin } from '@/components/ecommerce/orders-admin';
import { ProductsAdmin } from '@/components/ecommerce/products-admin';
import { ReviewsAdmin } from '@/components/ecommerce/reviews-admin';
import { ShippingAdmin } from '@/components/ecommerce/shipping-admin';
import { StoreSettings } from '@/components/ecommerce/store-settings';

const TABS = [
  { key: 'storefront', label: 'Storefront', icon: Store },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'collections', label: 'Collections', icon: LayoutGrid },
  { key: 'discounts', label: 'Discounts', icon: Tag },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'shipping', label: 'Shipping', icon: Truck },
  { key: 'orders', label: 'Orders', icon: PackageOpen },
  { key: 'accounting', label: 'Accounting', icon: Wallet },
] as const;

export default function EcommercePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('storefront');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Online Store</h1>
        <p className="text-sm text-muted-foreground">Run your Shopify-style storefront — catalogue, collections, discounts, and online orders.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'storefront' ? <StoreSettings /> : null}
      {tab === 'products' ? <ProductsAdmin /> : null}
      {tab === 'collections' ? <CollectionsAdmin /> : null}
      {tab === 'discounts' ? <DiscountsAdmin /> : null}
      {tab === 'reviews' ? <ReviewsAdmin /> : null}
      {tab === 'shipping' ? <ShippingAdmin /> : null}
      {tab === 'orders' ? <OrdersAdmin /> : null}
      {tab === 'accounting' ? (
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
  );
}
