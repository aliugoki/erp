'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Loader2, MailCheck } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { sfPath } from '@/lib/storefront';
import { accentStyle, useStore } from '@/components/store/store-ui';

export default function ForgotPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const [email, setEmail] = useState('');

  const send = useMutation({
    mutationFn: () => apiPost(sfPath(slug, '/account/forgot'), { email }),
  });

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={accentStyle(store)}>
          <KeyRound className="h-6 w-6 text-white" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900">Reset your password</h1>
        <p className="mt-1 text-sm text-zinc-500">We’ll email you a link to set a new password.</p>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 p-6">
        {send.isSuccess ? (
          <div className="text-center">
            <MailCheck className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-3 text-sm text-zinc-600">If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way. Check your inbox.</p>
            <Link href={sfPath(slug, '/account')} className="mt-4 inline-block text-sm font-medium" style={{ color: store.accentColor }}>Back to sign in</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block"><span className="mb-1 block text-sm font-medium text-zinc-600">Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="jane@example.com" className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" />
            </label>
            <button type="button" disabled={!/.+@.+\..+/.test(email) || send.isPending} onClick={() => send.mutate()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40" style={accentStyle(store)}>
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send reset link
            </button>
            <p className="text-center text-sm"><Link href={sfPath(slug, '/account')} className="text-zinc-500 hover:text-zinc-900">Back to sign in</Link></p>
          </div>
        )}
      </div>
    </div>
  );
}
