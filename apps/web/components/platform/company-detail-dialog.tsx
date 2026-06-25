'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, CheckCircle2, Copy, KeyRound, Pencil, UserPlus, X } from 'lucide-react';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { randomSecret } from '@/lib/secret';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface FeatureModuleView {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

interface TenantUser {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

type Plan = 'starter' | 'business' | 'enterprise';
const ROLES = ['TENANT_ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER', 'INVENTORY_MANAGER', 'SALES_REP', 'SUPPORT_AGENT', 'VIEWER'];

export function CompanyDetailDialog({
  company,
  onOpenChange,
}: {
  company: Company | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const open = Boolean(company);
  const id = company?.id;

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [plan, setPlan] = useState<Plan>('business');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', role: 'TENANT_ADMIN' });
  const [reveal, setReveal] = useState<{ title: string; email?: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const invalidateCompanies = () => {
    qc.invalidateQueries({ queryKey: ['tenants'] });
    qc.invalidateQueries({ queryKey: ['tenant-stats'] });
  };
  const invalidateUsers = () => qc.invalidateQueries({ queryKey: ['tenant-users', id] });

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['tenant-users', id],
    queryFn: () => apiGet<TenantUser[]>(`/tenants/${id}/users`),
    enabled: open,
  });

  const { data: features } = useQuery({
    queryKey: ['tenant-features', id],
    queryFn: () => apiGet<FeatureModuleView[]>(`/tenants/${id}/features`),
    enabled: open,
  });
  const toggleFeature = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => apiPatch(`/tenants/${id}/features/${key}`, { enabled }),
    onSuccess: () => {
      toast.success('Module updated');
      qc.invalidateQueries({ queryKey: ['tenant-features', id] });
    },
    onError: (e) => toast.error('Could not update module', { description: e instanceof ApiError ? e.message : '' }),
  });

  const rename = useMutation({
    mutationFn: (name: string) => apiPatch(`/tenants/${id}`, { name }),
    onSuccess: () => {
      toast.success('Company renamed');
      invalidateCompanies();
      setEditingName(false);
    },
    onError: (e) => toast.error('Could not rename', { description: e instanceof ApiError ? e.message : '' }),
  });

  const setStatus = useMutation({
    mutationFn: (status: Company['status']) => apiPatch(`/tenants/${id}/status`, { status }),
    onSuccess: (_r, status) => {
      toast.success(status === 'suspended' ? 'Company suspended' : 'Company activated');
      invalidateCompanies();
    },
    onError: (e) => toast.error('Could not update status', { description: e instanceof ApiError ? e.message : '' }),
  });

  const applyPlan = useMutation({
    mutationFn: () => apiPatch(`/tenants/${id}/plan`, { plan }),
    onSuccess: () => toast.success('Plan applied', { description: `Modules re-provisioned to the ${plan} plan.` }),
    onError: (e) => toast.error('Could not apply plan', { description: e instanceof ApiError ? e.message : '' }),
  });

  const addUser = useMutation({
    mutationFn: (cred: string) =>
      apiPost<TenantUser>(`/tenants/${id}/users`, { email: addForm.email, password: cred, roles: [addForm.role] }),
    onSuccess: (_r, cred) => {
      toast.success('User added');
      invalidateUsers();
      setReveal({ title: 'New user created', email: addForm.email, secret: cred });
      setShowAdd(false);
      setAddForm({ email: '', role: 'TENANT_ADMIN' });
    },
    onError: (e) => toast.error('Could not add user', { description: e instanceof ApiError ? e.message : '' }),
  });

  const resetPw = useMutation({
    mutationFn: ({ userId, cred }: { userId: string; cred: string; email: string }) =>
      apiPatch(`/tenants/${id}/users/${userId}/password`, { newPassword: cred }),
    onSuccess: (_r, v) => {
      toast.success('Password reset');
      setReveal({ title: 'Password reset', email: v.email, secret: v.cred });
    },
    onError: (e) => toast.error('Could not reset password', { description: e instanceof ApiError ? e.message : '' }),
  });

  const setUserStatus = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      apiPatch(`/tenants/${id}/users/${userId}/status`, { isActive }),
    onSuccess: () => {
      toast.success('User updated');
      invalidateUsers();
    },
    onError: (e) => toast.error('Could not update user', { description: e instanceof ApiError ? e.message : '' }),
  });

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setEditingName(false);
      setShowAdd(false);
      setReveal(null);
      setPlan('business');
    }
  }

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    addUser.mutate(randomSecret());
  }

  function resetPassword(userId: string, email: string) {
    const cred = randomSecret();
    resetPw.mutate({ userId, email, cred });
  }

  async function copyReveal() {
    if (!reveal) return;
    const parts = [reveal.email ? `Email: ${reveal.email}` : '', `Login: ${reveal.secret}`].filter(Boolean);
    await navigator.clipboard.writeText(parts.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editingName ? (
              <span className="flex items-center gap-2">
                <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="h-8 w-64" autoFocus />
                <Button size="icon" variant="ghost" disabled={rename.isPending || nameInput.trim().length < 2} onClick={() => rename.mutate(nameInput.trim())}>
                  <Check className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditingName(false)}>
                  <X className="size-4" />
                </Button>
              </span>
            ) : (
              <>
                {company.name}
                <Button size="icon" variant="ghost" className="size-7" onClick={() => { setNameInput(company.name); setEditingName(true); }}>
                  <Pencil className="size-3.5" />
                </Button>
                <Badge variant={company.status === 'active' ? 'success' : 'destructive'}>{company.status}</Badge>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {company.slug} · created {new Date(company.createdAt).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        {/* Company-level actions */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          {company.status === 'active' ? (
            <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate('suspended')}>
              <Ban className="size-4" /> Suspend
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate('active')}>
              <CheckCircle2 className="size-4" /> Activate
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Plan</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={applyPlan.isPending} onClick={() => applyPlan.mutate()}>Apply</Button>
          </div>
        </div>

        {/* Modules — managed by the platform operator per company */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Modules</h3>
          <div className="grid max-h-44 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border p-3">
            {(features ?? []).map((m) => (
              <label key={m.key} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate" title={m.description}>{m.name}</span>
                <Switch
                  checked={m.enabled}
                  disabled={toggleFeature.isPending}
                  onCheckedChange={(enabled) => toggleFeature.mutate({ key: m.key, enabled })}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Credential reveal panel */}
        {reveal ? (
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{reveal.title} — hand these over (shown once)</span>
              <Button size="sm" variant="outline" onClick={copyReveal}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {reveal.email ? <div className="font-mono text-xs">Email: {reveal.email}</div> : null}
            <div className="font-mono text-xs">Login: {reveal.secret}</div>
          </div>
        ) : null}

        {/* Users */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Users</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAdd((s) => !s)}>
            <UserPlus className="size-4" /> Add user
          </Button>
        </div>

        {showAdd ? (
          <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="nu-email" className="text-xs">Email</Label>
              <Input id="nu-email" type="email" value={addForm.email} onChange={(e) => setAddForm((s) => ({ ...s, email: e.target.value }))} placeholder="user@company.test" required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm((s) => ({ ...s, role: v }))}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={addUser.isPending}>{addUser.isPending ? 'Adding…' : 'Create'}</Button>
          </form>
        ) : null}

        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersLoading ? (
                <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (users ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No users.</TableCell></TableRow>
              ) : (
                (users ?? []).map((u) => (
                  <TableRow key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                    <TableCell className="font-mono text-xs">{u.email}</TableCell>
                    <TableCell className="text-xs">{u.roles.join(', ') || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Reset password" disabled={resetPw.isPending} onClick={() => resetPassword(u.id, u.email)}>
                          <KeyRound className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title={u.isActive ? 'Deactivate' : 'Activate'} disabled={setUserStatus.isPending} onClick={() => setUserStatus.mutate({ userId: u.id, isActive: !u.isActive })}>
                          {u.isActive ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
