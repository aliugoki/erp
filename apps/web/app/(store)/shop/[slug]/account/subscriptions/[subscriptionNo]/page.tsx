'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { type SfSubInvoice, type SfSubscription, customerGet, customerPost, getCustomerToken, sfPath } from '@/lib/storefront';
import { formatMoney } from '@/lib/utils';
import { useCustomer } from '@/components/store/store-ui';

const TONE: Record<string, string> = {
  TRIALING: 'bg-sky-100 text-sky-700', ACTIVE: 'bg-emerald-100 text-emerald-700', PAST_DUE: 'bg-amber-100 text-amber-700',
  PAUSED: 'bg-zinc-200 text-zinc-700', CANCELLED: 'bg-rose-100 text-rose-700', EXPIRED: 'bg-zinc-100 text-zinc-500',
};
const INV_TONE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700', PAID: 'bg-emerald-100 text-emerald-700', VOID: 'bg-zinc-100 text-zinc-500', UNCOLLECTIBLE: 'bg-rose-100 text-rose-700',
};
const ADVERB: Record<string, string> = { DAY: 'daily', WEEK: 'weekly', MONTH: 'monthly', YEAR: 'yearly' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export default function StoreSubscriptionDetail({ params }: { params: { slug: string; subscriptionNo: string } }) {
  const { slug, subscriptionNo } = params;
  const { customer, loading } = useCustomer(slug);
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => { if (!loading && !customer && !getCustomerToken(slug)) router.replace(sfPath(slug, '/account')); }, [loading, customer, slug, router]);

  const sub = useQuery({ queryKey: ['sf-sub', slug, subscriptionNo], queryFn: () => customerGet<SfSubscription>(slug, `/subscriptions/${subscriptionNo}`), enabled: !!customer });
  const cancel = useMutation({
    mutationFn: () => customerPost<SfSubscription>(slug, `/subscriptions/${subscriptionNo}/cancel`, { atPeriodEnd: true }),
    onSuccess: () => { toast.success('Your subscription will end at the period close'); void qc.invalidateQueries({ queryKey: ['sf-sub', slug, subscriptionNo] }); void qc.invalidateQueries({ queryKey: ['sf-subs', slug] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not cancel'),
  });

  if (loading || (!customer && getCustomerToken(slug))) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (!customer) return null;
  if (sub.isLoading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (sub.isError || !sub.data) return <div className="py-32 text-center text-zinc-500">Subscription not found. <Link href={sfPath(slug, '/account/subscriptions')} className="underline">Back</Link></div>;
  const s = sub.data;
  const ended = ['CANCELLED', 'EXPIRED'].includes(s.status);
  const invoices = s.invoices ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href={sfPath(slug, '/account/subscriptions')} className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft className="h-4 w-4" /> Subscriptions</Link>

      <div className="rounded-2xl border border-zinc-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{s.planName ?? s.subscriptionNo}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[s.status] ?? 'bg-zinc-100 text-zinc-600'}`}>{s.status.replace('_', ' ')}</span>
              <span className="text-sm text-zinc-500">{formatMoney(s.amount.amountMinor, s.amount.currency)} {ADVERB[s.billingInterval] ?? ''}</span>
            </div>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          {s.status === 'TRIALING' && s.trialEnd ? <Cell label="Trial ends" value={fmtDate(s.trialEnd)} /> : null}
          {!ended ? <Cell label={s.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'} value={fmtDate(s.cancelAtPeriodEnd ? s.currentPeriodEnd : s.nextBillingAt)} /> : <Cell label="Ended" value={fmtDate(s.canceledAt)} />}
          <Cell label="Subscription" value={s.subscriptionNo} />
        </dl>

        {!ended && !s.cancelAtPeriodEnd ? (
          <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">
            {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel subscription
          </button>
        ) : s.cancelAtPeriodEnd && !ended ? (
          <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Your subscription is set to cancel on {fmtDate(s.currentPeriodEnd)}.</p>
        ) : null}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-zinc-500">Billing history</h2>
      <div className="overflow-hidden rounded-2xl border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr><th className="px-4 py-2">Invoice</th><th className="px-4 py-2">Period</th><th className="px-4 py-2">Total</th><th className="px-4 py-2 text-right">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {invoices.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No invoices yet.</td></tr>
            ) : invoices.map((i: SfSubInvoice) => (
              <tr key={i.id}>
                <td className="px-4 py-2.5"><div className="font-medium text-zinc-900">{i.invoiceNo}</div><div className="text-xs text-zinc-500">{fmtDate(i.issuedAt)}</div></td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</td>
                <td className="px-4 py-2.5 tabular-nums text-zinc-900">{formatMoney(i.total.amountMinor, i.total.currency)}</td>
                <td className="px-4 py-2.5 text-right"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INV_TONE[i.status] ?? 'bg-zinc-100 text-zinc-600'}`}>{i.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs uppercase text-zinc-400">{label}</dt><dd className="font-medium text-zinc-900">{value}</dd></div>;
}
