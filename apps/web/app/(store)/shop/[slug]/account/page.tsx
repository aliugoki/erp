'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiPost } from '@/lib/api';
import { type SfAuthResult, setCustomerToken, sfPath } from '@/lib/storefront';
import { accentStyle, useStore } from '@/components/store/store-ui';

export default function AccountPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { store } = useStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = useMutation({
    mutationFn: () => {
      const path = mode === 'login' ? '/account/login' : '/account/register';
      const body = mode === 'login' ? { email: f.email, password: f.password } : f;
      return apiPost<SfAuthResult>(sfPath(slug, path), body);
    },
    onSuccess: (res) => {
      setCustomerToken(slug, res.token);
      qc.setQueryData(['sf-customer', slug], res.customer);
      toast.success(mode === 'login' ? 'Welcome back!' : 'Account created');
      router.push(sfPath(slug, '/account/orders'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  const valid = /.+@.+\..+/.test(f.email) && f.password.length >= (mode === 'register' ? 8 : 1) && (mode === 'login' || f.name.trim());

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={accentStyle(store)}>
          <User className="h-6 w-6 text-white" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
        <p className="mt-1 text-sm text-zinc-500">{mode === 'login' ? `Welcome back to ${store.name}.` : `Join ${store.name} to track your orders.`}</p>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 p-6">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm font-medium">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md py-1.5 capitalize transition ${mode === m ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}>
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {mode === 'register' ? (
            <Field label="Full name"><input value={f.name} onChange={set('name')} className={inputCls} placeholder="Jane Doe" /></Field>
          ) : null}
          <Field label="Email"><input value={f.email} onChange={set('email')} type="email" className={inputCls} placeholder="jane@example.com" /></Field>
          <Field label="Password"><input value={f.password} onChange={set('password')} type="password" className={inputCls} placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'} /></Field>
          {mode === 'login' ? (
            <div className="text-right"><Link href={sfPath(slug, '/account/forgot')} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">Forgot password?</Link></div>
          ) : null}
          <button
            type="button"
            disabled={!valid || submit.isPending}
            onClick={() => submit.mutate()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40"
            style={accentStyle(store)}
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-zinc-600">{label}</span>{children}</label>;
}
