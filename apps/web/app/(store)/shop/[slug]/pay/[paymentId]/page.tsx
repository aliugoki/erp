'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { type SfPayment, sfPath } from '@/lib/storefront';
import { accentStyle, useStore } from '@/components/store/store-ui';
import { formatMoney } from '@/lib/utils';

export default function PayPage({ params }: { params: { slug: string; paymentId: string } }) {
  const { slug, paymentId } = params;
  const { store } = useStore();
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [card, setCard] = useState({ number: '4242 4242 4242 4242', exp: '12/29', cvc: '123' });

  useEffect(() => {
    setSecret(typeof window !== 'undefined' ? sessionStorage.getItem(`mx_pay_${paymentId}`) : null);
  }, [paymentId]);

  const payment = useQuery({
    queryKey: ['sf-payment', slug, paymentId],
    queryFn: () => apiGet<SfPayment>(sfPath(slug, `/pay/${paymentId}`)),
  });

  const pay = useMutation({
    mutationFn: () => apiPost<{ status: string }>(sfPath(slug, `/pay/${paymentId}/confirm`), { clientSecret: secret }),
    onSuccess: () => {
      sessionStorage.removeItem(`mx_pay_${paymentId}`);
      toast.success('Payment successful');
      const orderNo = payment.data?.orderNo;
      router.push(orderNo ? sfPath(slug, `/order/${orderNo}`) : sfPath(slug));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Payment failed'),
  });

  if (payment.isLoading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (payment.isError || !payment.data) {
    return <div className="mx-auto max-w-md px-4 py-32 text-center text-zinc-500">Payment session not found.</div>;
  }

  const p = payment.data;
  if (p.status === 'PAID') {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <ShieldCheck className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">Already paid</h1>
        <Link href={p.orderNo ? sfPath(slug, `/order/${p.orderNo}`) : sfPath(slug)} className="mt-4 inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white" style={accentStyle(store)}>View order</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="rounded-2xl border border-zinc-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-zinc-900">Payment</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500"><Lock className="h-3 w-3" /> Test mode</span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Order {p.orderNo} · {store.name}</p>

        <div className="my-5 flex items-baseline justify-between border-y border-zinc-100 py-4">
          <span className="text-sm text-zinc-500">Amount due</span>
          <span className="text-2xl font-bold text-zinc-900">{formatMoney(p.amount.amountMinor, p.amount.currency)}</span>
        </div>

        {secret ? (
          <>
            <div className="space-y-3">
              <Field label="Card number"><input value={card.number} onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))} className={inputCls} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expiry"><input value={card.exp} onChange={(e) => setCard((c) => ({ ...c, exp: e.target.value }))} className={inputCls} /></Field>
                <Field label="CVC"><input value={card.cvc} onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value }))} className={inputCls} /></Field>
              </div>
            </div>
            <button
              type="button"
              disabled={pay.isPending}
              onClick={() => pay.mutate()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
              style={accentStyle(store)}
            >
              {pay.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Pay {formatMoney(p.amount.amountMinor, p.amount.currency)}
            </button>
            <p className="mt-3 text-center text-xs text-zinc-400">This is a simulated gateway — no real card is charged.</p>
          </>
        ) : (
          <div className="text-center text-sm text-zinc-500">
            <p>This payment can’t be completed in this browser session.</p>
            <Link href={p.orderNo ? sfPath(slug, `/order/${p.orderNo}`) : sfPath(slug)} className="mt-3 inline-block font-medium" style={{ color: store.accentColor }}>View your order</Link>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = 'h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-zinc-600">{label}</span>{children}</label>;
}
