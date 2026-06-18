'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import { type SfAuthResult, setCustomerToken, sfPath } from '@/lib/storefront';
import { accentStyle, useStore } from '@/components/store/store-ui';

export default function ResetPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const router = useRouter();
  const qc = useQueryClient();
  const resetTok = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () => apiPost<SfAuthResult>(sfPath(slug, '/account/reset'), { token: resetTok, password }),
    onSuccess: (res) => {
      setCustomerToken(slug, res.token);
      qc.setQueryData(['sf-customer', slug], res.customer);
      toast.success('Password updated');
      router.push(sfPath(slug, '/account/orders'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not reset password'),
  });

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={accentStyle(store)}>
          <KeyRound className="h-6 w-6 text-white" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900">Set a new password</h1>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 p-6">
        {!resetTok ? (
          <p className="text-center text-sm text-zinc-500">
            This reset link is missing its code. <Link href={sfPath(slug, '/account/forgot')} className="font-medium" style={{ color: store.accentColor }}>Request a new one</Link>.
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block"><span className="mb-1 block text-sm font-medium text-zinc-600">New password</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="At least 8 characters" className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400" />
            </label>
            <button type="button" disabled={password.length < 8 || reset.isPending} onClick={() => reset.mutate()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40" style={accentStyle(store)}>
              {reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
