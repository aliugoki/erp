'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, LogOut, PackageOpen } from 'lucide-react';
import { type SfOrder, customerGet, getCustomerToken, sfPath } from '@/lib/storefront';
import { accentStyle, useCustomer, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', PAID: 'bg-emerald-100 text-emerald-700',
  FULFILLED: 'bg-blue-100 text-blue-700', SHIPPED: 'bg-indigo-100 text-indigo-700',
  CANCELLED: 'bg-rose-100 text-rose-700', REFUNDED: 'bg-zinc-200 text-zinc-700',
};

export default function OrderHistory({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const { customer, loading, logout } = useCustomer(slug);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !customer && !getCustomerToken(slug)) router.replace(sfPath(slug, '/account'));
  }, [loading, customer, slug, router]);

  const orders = useQuery({
    queryKey: ['sf-my-orders', slug],
    queryFn: () => customerGet<SfOrder[]>(slug, '/account/orders'),
    enabled: !!customer,
  });

  if (loading || (!customer && getCustomerToken(slug))) {
    return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  }
  if (!customer) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">My orders</h1>
          <p className="text-sm text-zinc-500">Signed in as {customer.name} · {customer.email}</p>
        </div>
        <button type="button" onClick={() => { logout(); router.replace(sfPath(slug, '/account')); }} className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      {orders.isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : (orders.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 py-16 text-center">
          <PackageOpen className="mx-auto h-10 w-10 text-zinc-300" />
          <p className="mt-3 text-zinc-500">You haven’t placed any orders yet.</p>
          <Link href={sfPath(slug, '/products')} className="mt-4 inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white" style={accentStyle(store)}>Start shopping</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.data!.map((o) => (
            <Link key={o.id} href={sfPath(slug, `/order/${o.orderNo}`)} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 transition hover:shadow-md">
              <div>
                <p className="font-semibold text-zinc-900">{o.orderNo}</p>
                <p className="text-sm text-zinc-500">{o.placedAt ? new Date(o.placedAt).toLocaleDateString() : ''} · {o.paymentMethod}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[o.status] ?? 'bg-zinc-100 text-zinc-700'}`}>{o.status}</span>
                <span className="font-semibold tabular-nums text-zinc-900">{formatMoney(o.total.amountMinor, o.total.currency)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
