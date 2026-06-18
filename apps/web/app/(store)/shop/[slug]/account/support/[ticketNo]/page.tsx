'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Send, Star } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { type SfTicket, customerGet, customerPost, sfPath } from '@/lib/storefront';
import { accentStyle, useStore } from '@/components/store/store-ui';

export default function SupportThread({ params }: { params: { slug: string; ticketNo: string } }) {
  const { slug, ticketNo } = params;
  const { store } = useStore();
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const ticket = useQuery({ queryKey: ['sf-ticket', slug, ticketNo], queryFn: () => customerGet<SfTicket>(slug, `/support/${ticketNo}`) });
  const set = (t: SfTicket) => qc.setQueryData(['sf-ticket', slug, ticketNo], t);
  const reply = useMutation({
    mutationFn: () => customerPost<SfTicket>(slug, `/support/${ticketNo}/reply`, { body }),
    onSuccess: (t) => { set(t); setBody(''); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not send'),
  });
  const csat = useMutation({
    mutationFn: (rating: number) => customerPost<SfTicket>(slug, `/support/${ticketNo}/csat`, { rating }),
    onSuccess: (t) => { set(t); toast.success('Thanks for your feedback!'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not rate'),
  });

  if (ticket.isLoading) return <div className="flex justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  if (ticket.isError || !ticket.data) return <div className="mx-auto max-w-md px-4 py-24 text-center text-zinc-500">Request not found.</div>;
  const t = ticket.data;
  const resolved = ['RESOLVED', 'CLOSED'].includes(t.status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href={sfPath(slug, '/account/support')} className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900"><ChevronLeft className="h-4 w-4" /> All requests</Link>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t.subject}</h1>
      </div>
      <p className="mb-6 text-sm text-zinc-500">{t.ticketNo} · status {t.status.replace('_', ' ').toLowerCase()}</p>

      <div className="space-y-3">
        {(t.messages ?? []).filter((m) => m.authorType !== 'SYSTEM').map((m) => (
          <div key={m.id} className={`rounded-2xl border p-4 ${m.authorType === 'AGENT' ? 'border-zinc-200 bg-zinc-50' : 'bg-white'}`} style={m.authorType === 'CUSTOMER' ? { borderColor: `${store.accentColor}40` } : undefined}>
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700">{m.authorType === 'CUSTOMER' ? 'You' : m.authorName}</span>
              <span>{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
            </div>
            <p className="whitespace-pre-line text-sm text-zinc-800">{m.body}</p>
          </div>
        ))}
      </div>

      {t.status !== 'CLOSED' ? (
        <div className="mt-5 rounded-2xl border border-zinc-200 p-3">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add a reply…" className="w-full resize-none bg-transparent px-1 text-sm outline-none" />
          <div className="flex justify-end">
            <button type="button" disabled={!body.trim() || reply.isPending} onClick={() => reply.mutate()} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={accentStyle(store)}>
              {reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </button>
          </div>
        </div>
      ) : null}

      {resolved ? (
        <div className="mt-6 rounded-2xl border border-zinc-200 p-5 text-center">
          {t.csatRating ? (
            <p className="text-sm text-zinc-600">Thanks for rating this {t.csatRating}/5 ⭐</p>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-700">How did we do?</p>
              <div className="mt-2 flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => csat.mutate(n)}><Star className="h-7 w-7 text-zinc-300 transition hover:fill-amber-400 hover:text-amber-400" /></button>)}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
