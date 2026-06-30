'use client';
import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { ApiError, apiPatch, apiPost } from '@/lib/api';
import { randomSecret } from '@/lib/secret';
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
import { ToggleChips, type ChipOption } from '@/components/settings/toggle-chips';

export interface TenantUserRow {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  lockedUntil: string | null;
  failedAttempts: number;
}

/** Add a user to the company with one or more roles, then reveal the login to hand over. */
export function AddUserDialog({
  open,
  onOpenChange,
  roleOptions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roleOptions: ChipOption[];
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState(randomSecret());
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ email: string; pw: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setPw(randomSecret());
      setRoles(new Set());
      setCreated(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => apiPost('/users', { email, password: pw, roles: [...roles] }),
    onSuccess: () => {
      toast.success('User added');
      qc.invalidateQueries({ queryKey: ['tenant-users-self'] });
      setCreated({ email, pw });
    },
    onError: (e) => toast.error('Could not add user', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || roles.size === 0) return;
    create.mutate();
  }
  function toggle(v: string) {
    setRoles((s) => {
      const n = new Set(s);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }
  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(`Email: ${created.email}\nLogin: ${created.pw}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>User created</DialogTitle>
              <DialogDescription>Hand these over — the login secret is shown once.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1 rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="font-mono text-xs">Email: {created.email}</div>
              <div className="font-mono text-xs">Login: {created.pw}</div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>Create a login for someone in your company and pick their roles.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="u-email">Email</Label>
                <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.test" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-pw">Login secret</Label>
                <div className="flex gap-2">
                  <Input id="u-pw" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} className="font-mono" />
                  <Button type="button" variant="outline" size="icon" title="Generate" onClick={() => setPw(randomSecret())}>
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <ToggleChips options={roleOptions} selected={roles} onToggle={toggle} />
                {roles.size === 0 ? <p className="text-xs text-muted-foreground">Pick at least one role.</p> : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" disabled={create.isPending || !email || roles.size === 0}>
                  {create.isPending ? 'Adding…' : 'Create user'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Change an existing user's roles. */
export function EditRolesDialog({
  open,
  onOpenChange,
  user,
  roleOptions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: TenantUserRow | null;
  roleOptions: ChipOption[];
}) {
  const qc = useQueryClient();
  const [roles, setRoles] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open && user) setRoles(new Set(user.roles));
  }, [open, user]);

  const save = useMutation({
    mutationFn: () => apiPatch(`/users/${user?.id}/roles`, { roles: [...roles] }),
    onSuccess: () => {
      toast.success('Roles updated');
      qc.invalidateQueries({ queryKey: ['tenant-users-self'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error('Could not update roles', { description: e instanceof ApiError ? e.message : '' }),
  });

  function toggle(v: string) {
    setRoles((s) => {
      const n = new Set(s);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }

  if (!user) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {user.email}</DialogTitle>
          <DialogDescription>Changing roles signs the user out so the new access applies immediately.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <ToggleChips options={roleOptions} selected={roles} onToggle={toggle} />
          {roles.size === 0 ? <p className="text-xs text-muted-foreground">A user needs at least one role.</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending || roles.size === 0} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save roles'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
