'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { type SfTicket, customerGet, customerPost, getCustomerToken, sfPath } from '@/lib/storefront';
import { accentStyle, useCustomer, useStore } from '@/components/store/store-ui';

const TONE: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-700', OPEN: 'bg-indigo-100 text-indigo-700', PENDING: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-zinc-200 text-zinc-700', RESOLVED: 'bg-emerald-100 text-emerald-700', CLOSED: 'bg-zinc-100 text-zinc-500',
};

export default function SupportPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const { customer, loading } = useCustomer(slug);
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: '', body: '', priority: 'MEDIUM' });

  useEffect(() => { if (!loading && !customer && !getCustomerToken(slug)) router.replace(sfPath(slug, '/account')); }, [loading, customer, slug, router]);

  const tickets = useQuery({ queryKey: ['sf-tickets', slug], queryFn: () => customerGet<SfTicket[]>(slug, '/support'), enabled: !!customer });
  const create = useMutation({
    mutationFn: () => customerPost<SfTicket>(slug, '/support', f),
    onSuccess: (t) => { setOpen(false); setF({ subject: '', body: '', priority: 'MEDIUM' }); toast.success(`Ticket ${t.ticketNo} created`); void qc.invalidateQueries({ queryKey: ['sf-tickets', slug] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not submit'),
  });

  if (loading || (!customer && getCustomerToken(slug))) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (!customer) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900"><LifeBuoy className="h-6 w-6" style={{ color: store.accentColor }} /> Support</h1>
          <p className="text-sm text-zinc-500">Get help and track your requests.</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white" style={accentStyle(store)}><Plus className="h-4 w-4" /> New request</button>
      </div>

      {open ? (
        <div className="mb-8 rounded-2xl border border-zinc-200 p-5">
          <div className="space-y-3">
            <input value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} placeholder="Subject" className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" />
            <textarea value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} rows={4} placeholder="How can we help?" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" />
            <div className="flex items-center justify-between">
              <select value={f.priority} onChange={(e) => setF((s) => ({ ...s, priority: e.target.value }))} className="h-9 rounded-lg border border-zinc-200 px-3 text-sm">
                {['LOW', 'MEDIUM', 'HIGH'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button type="button" disabled={!f.subject.trim() || !f.body.trim() || create.isPending} onClick={() => create.mutate()} className="rounded-full px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={accentStyle(store)}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit request'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tickets.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
      ) : (tickets.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-16 text-center text-zinc-500"><LifeBuoy className="mx-auto h-10 w-10 text-zinc-300" /><p className="mt-3">No requests yet.</p></div>
      ) : (
        <div className="space-y-3">
          {tickets.data!.map((t) => (
            <Link key={t.id} href={sfPath(slug, `/account/support/${t.ticketNo}`)} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4 transition hover:shadow-md">
              <div className="min-w-0">
                <p className="truncate font-semibold text-zinc-900">{t.subject}</p>
                <p className="text-xs text-zinc-500">{t.ticketNo}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[t.status] ?? 'bg-zinc-100 text-zinc-600'}`}>{t.status.replace('_', ' ')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
