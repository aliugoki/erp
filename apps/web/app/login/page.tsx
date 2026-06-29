'use client';
import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boxes, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeSwitcher } from '@/components/theme-switcher';

export default function LoginPage() {
  const { login, completeTwoFactor, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('admin@acme.test');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null); // set → show the 2FA step
  const [code, setCode] = useState('');

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      if (res.twoFactorRequired) {
        setTicket(res.ticket ?? null);
      } else {
        router.replace('/');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(ticket, code.trim());
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-background to-muted p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--glow)/0.35), transparent 70%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-20 size-[28rem] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--primary)/0.25), transparent 70%)' }}
      />
      <div className="absolute right-4 top-4 z-10">
        <ThemeSwitcher />
      </div>
      <Card className="elevated glass relative z-10 w-full max-w-md animate-scale-in">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
            <Boxes className="size-6" />
          </div>
          <div>
            <CardTitle className="text-2xl">MetaXperts ERP</CardTitle>
            <CardDescription className="mt-1">{ticket ? 'Enter your authenticator code' : 'Sign in to your workspace'}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {ticket ? (
            <form onSubmit={onVerify} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Authentication code</Label>
                <Input id="code" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code or recovery code" autoComplete="one-time-code" required className="text-center tracking-widest" />
                <p className="text-xs text-muted-foreground">Open your authenticator app, or use a recovery code.</p>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}{busy ? 'Verifying…' : 'Verify'}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => { setTicket(null); setCode(''); setError(null); }}>
                Back
              </Button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Demo: provision a tenant via the API, then sign in with that admin.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
