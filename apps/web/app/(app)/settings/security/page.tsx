'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Check, Loader2, ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';

type Step = 'idle' | 'setup' | 'recovery';

export default function SecurityPage() {
  const status = useQuery({ queryKey: ['2fa-status'], queryFn: () => apiGet<{ enabled: boolean }>('/auth/2fa/status') });
  const enabled = status.data?.enabled;

  const [step, setStep] = useState<Step>('idle');
  const [otpauth, setOtpauth] = useState('');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    if (otpauth) QRCode.toDataURL(otpauth, { width: 200, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [otpauth]);

  const beginSetup = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup');
      setSecret(r.secret);
      setOtpauth(r.otpauthUrl);
      setCode('');
      setStep('setup');
    } catch (e) {
      toast.error('Could not start setup', { description: e instanceof ApiError ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code: code.trim() });
      setRecovery(r.recoveryCodes);
      setStep('recovery');
      status.refetch();
      toast.success('Two-factor authentication enabled');
    } catch (e) {
      toast.error('Verification failed', { description: e instanceof ApiError ? e.message : 'Check the code and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await apiPost('/auth/2fa/disable', { code: disableCode.trim() });
      setDisableCode('');
      setStep('idle');
      status.refetch();
      toast.success('Two-factor authentication disabled');
    } catch (e) {
      toast.error('Could not disable', { description: e instanceof ApiError ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  if (status.isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" />
        <div>
          <h2 className="font-semibold">Two-factor authentication</h2>
          <p className="text-xs text-muted-foreground">Add a time-based one-time code (TOTP) from an authenticator app to your sign-in.</p>
        </div>
        <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          {enabled ? <><ShieldCheck className="size-3" /> On</> : <><ShieldQuestion className="size-3" /> Off</>}
        </span>
      </div>

      {/* Enabled → offer disable */}
      {enabled ? (
        <Card className="space-y-3 p-4">
          <p className="text-sm">Two-factor is <span className="font-semibold text-success">active</span> on your account. You'll be asked for a code at every sign-in.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Enter a current code to turn it off</Label>
              <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="6-digit or recovery code" className="h-9 w-56" />
            </div>
            <Button variant="destructive" size="sm" disabled={busy || disableCode.trim().length < 6} onClick={disable}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />} Disable 2FA
            </Button>
          </div>
        </Card>
      ) : step === 'idle' ? (
        <Card className="flex items-center justify-between gap-4 p-4">
          <p className="text-sm text-muted-foreground">Protect your account with an authenticator app (Google Authenticator, 1Password, Authy…).</p>
          <Button size="sm" disabled={busy} onClick={beginSetup}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Enable 2FA</Button>
        </Card>
      ) : step === 'setup' ? (
        <Card className="space-y-4 p-4">
          <p className="text-sm font-medium">1. Scan this QR code with your authenticator app</p>
          <div className="flex flex-wrap items-center gap-4">
            {qr ? <img src={qr} alt="2FA QR code" className="rounded-lg border bg-white p-2" width={160} height={160} /> : <div className="flex size-40 items-center justify-center rounded-lg border"><Loader2 className="size-5 animate-spin" /></div>}
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">Or enter this key manually:</p>
              <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{secret}</code>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">2. Enter the 6-digit code it shows</p>
            <div className="flex items-end gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="000000" className="h-9 w-40 text-center tracking-widest" />
              <Button size="sm" disabled={busy || code.trim().length < 6} onClick={confirmEnable}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Verify & enable</Button>
              <Button size="sm" variant="ghost" onClick={() => setStep('idle')}>Cancel</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-medium text-success">2FA is now enabled. Save your recovery codes.</p>
          <p className="text-xs text-muted-foreground">Each code works once if you lose your authenticator. Store them somewhere safe — they won't be shown again.</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm sm:grid-cols-2">
            {recovery.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(recovery.join('\n')); toast.success('Recovery codes copied'); }}>Copy codes</Button>
            <Button size="sm" onClick={() => setStep('idle')}>Done</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
