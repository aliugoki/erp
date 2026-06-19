'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Repeat } from 'lucide-react';
import { type SfSubscription, customerGet, getCustomerToken, sfPath } from '@/lib/storefront';
import { formatMoney } from '@/lib/utils';
import { useCustomer, useStore } from '@/components/store/store-ui';

const TONE: Record<string, string> = {
  TRIALING: 'bg-sky-100 text-sky-700', ACTIVE: 'bg-emerald-100 text-emerald-700', PAST_DUE: 'bg-amber-100 text-amber-700',
  PAUSED: 'bg-zinc-200 text-zinc-700', CANCELLED: 'bg-rose-100 text-rose-700', EXPIRED: 'bg-zinc-100 text-zinc-500',
};
const ADVERB: Record<string, string> = { DAY: 'daily', WEEK: 'weekly', MONTH: 'monthly', YEAR: 'yearly' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export default function StoreSubscriptionsPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const { customer, loading } = useCustomer(slug);
  const router = useRouter();

  useEffect(() => { if (!loading && !customer && !getCustomerToken(slug)) router.replace(sfPath(slug, '/account')); }, [loading, customer, slug, router]);

  const subs = useQuery({ queryKey: ['sf-subs', slug], queryFn: () => customerGet<SfSubscription[]>(slug, '/subscriptions'), enabled: !!customer });

  if (loading || (!customer && getCustomerToken(slug))) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (!customer) return null;
  const list = subs.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900"><Repeat className="h-6 w-6" style={{ color: store.accentColor }} /> Subscriptions</h1>
        <p className="text-sm text-zinc-500">Manage your recurring plans and view billing history.</p>
      </div>

      {subs.isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-16 text-center text-zinc-500"><Repeat className="mx-auto mb-3 h-8 w-8 text-zinc-300" />You have no subscriptions.</div>
      ) : (
        <div className="space-y-3">
          {list.map((s) => (
            <Link key={s.id} href={sfPath(slug, `/account/subscriptions/${s.subscriptionNo}`)} className="block rounded-2xl border border-zinc-200 p-5 transition hover:border-zinc-300 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-900">{s.planName ?? s.subscriptionNo}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[s.status] ?? 'bg-zinc-100 text-zinc-600'}`}>{s.status.replace('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">{formatMoney(s.amount.amountMinor, s.amount.currency)} {ADVERB[s.billingInterval] ?? ''}{s.intervalCount > 1 ? ` (×${s.intervalCount})` : ''}</p>
                </div>
                <div className="text-right text-xs text-zinc-500">
                  {['CANCELLED', 'EXPIRED'].includes(s.status) ? <>Ended {fmtDate(s.canceledAt)}</> : s.cancelAtPeriodEnd ? <>Cancels {fmtDate(s.currentPeriodEnd)}</> : <>Renews {fmtDate(s.nextBillingAt)}</>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
