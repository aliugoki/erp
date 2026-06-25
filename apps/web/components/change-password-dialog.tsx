'use client';
import { type FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Change the signed-in user's own password. On success every session is revoked server-side, so we
 * sign the user out and send them to the login page. Controlled `open` so it can be opened from the
 * topbar account menu. */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { logout } = useAuth();
  const [f, setF] = useState({ cur: '', next: '', confirm: '' });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const mismatch = f.confirm.length > 0 && f.next !== f.confirm;

  const change = useMutation({
    mutationFn: () => apiPatch('/me/password', { currentPassword: f.cur, newPassword: f.next }),
    onSuccess: async () => {
      toast.success('Password changed', { description: 'Please sign in again with your new password.' });
      onOpenChange(false);
      await logout();
    },
    onError: (e) => toast.error('Could not change password', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch || f.next.length < 8) return;
    change.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setF({ cur: '', next: '', confirm: '' });
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            For your security, changing your password signs you out of all devices.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" value={f.cur} onChange={(e) => set('cur', e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next">New password</Label>
            <Input id="next" type="password" value={f.next} onChange={(e) => set('next', e.target.value)} required minLength={8} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input id="confirm" type="password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} required autoComplete="new-password" />
            {mismatch ? <p className="text-xs text-destructive">Passwords don't match.</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={change.isPending || mismatch || f.next.length < 8}>
              {change.isPending ? 'Saving…' : 'Change password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
