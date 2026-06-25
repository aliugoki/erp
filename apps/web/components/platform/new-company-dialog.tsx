'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, RefreshCw } from 'lucide-react';
import { ApiError, apiPost } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { randomSecret } from '@/lib/secret';

type Plan = 'starter' | 'business' | 'enterprise';

interface ProvisionResult {
  tenant: { id: string; name: string; slug: string; status: string };
  admin: { id: string; email: string };
}

const PLAN_HINT: Record<Plan, string> = {
  starter: 'Core modules only.',
  business: 'Most modules (default).',
  enterprise: 'Every module enabled.',
};

/** Provision a new company + its first TENANT_ADMIN, then surface the credentials so the operator can
 * hand them over. Mirrors `POST /tenants` (SUPER_ADMIN-only). */
export function NewCompanyDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', adminEmail: '', adminPw: randomSecret(), plan: 'business' as Plan });
  const [created, setCreated] = useState<{ company: string; email: string; pw: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  function reset() {
    setF({ name: '', adminEmail: '', adminPw: randomSecret(), plan: 'business' });
    setCreated(null);
    setCopied(false);
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost<ProvisionResult>('/tenants', {
        name: f.name,
        adminEmail: f.adminEmail,
        adminPassword: f.adminPw,
        plan: f.plan,
      }),
    onSuccess: (res) => {
      toast.success('Company created', { description: res.tenant.name });
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setCreated({ company: res.tenant.name, email: res.admin.email, pw: f.adminPw });
    },
    onError: (e) => toast.error('Could not create company', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  async function copyCreds() {
    if (!created) return;
    const lines = ['Company: ' + created.company, 'Email: ' + created.email, 'Login: ' + created.pw];
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New company
        </Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Company created</DialogTitle>
              <DialogDescription>
                Hand these credentials to the company admin. The login secret is shown only once — copy it now.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Company</span>
                <span className="font-medium">{created.company}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Email</span>
                <span className="font-mono">{created.email}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Login secret</span>
                <span className="font-mono">{created.pw}</span>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={copyCreds}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy credentials'}
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add company</DialogTitle>
              <DialogDescription>Creates the company, its first admin user, and its feature plan in one step.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Company name</Label>
                <Input id="name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Northwind Traders" required minLength={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminEmail">Admin email</Label>
                <Input id="adminEmail" type="email" value={f.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} placeholder="admin@northwind.test" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminPw">Admin login secret</Label>
                <div className="flex gap-2">
                  <Input id="adminPw" value={f.adminPw} onChange={(e) => set('adminPw', e.target.value)} required minLength={8} className="font-mono" />
                  <Button type="button" variant="outline" size="icon" title="Generate a new secret" onClick={() => set('adminPw', randomSecret())}>
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">At least 8 characters. You hand this to the company admin to log in.</p>
              </div>
              <div className="space-y-2">
                <Label>Plan</Label>
                <Select value={f.plan} onValueChange={(v) => set('plan', v as Plan)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{PLAN_HINT[f.plan]} Modules can be changed later per company.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create company'}</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
