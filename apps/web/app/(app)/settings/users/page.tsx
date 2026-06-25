'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Copy, KeyRound, Plus, ShieldAlert, UserCog } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { randomSecret } from '@/lib/secret';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ChipOption } from '@/components/settings/toggle-chips';
import { AddUserDialog, EditRolesDialog, type TenantUserRow } from '@/components/settings/user-dialogs';
import type { Capability, CustomRole } from '@/components/settings/role-dialog';

export default function UsersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = (user?.roles ?? []).some((r) => r === 'TENANT_ADMIN' || r === 'SUPER_ADMIN');
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<TenantUserRow | null>(null);
  const [reveal, setReveal] = useState<{ email: string; pw: string } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['tenant-users-self'],
    queryFn: () => apiGet<TenantUserRow[]>('/users'),
    enabled: isAdmin,
  });
  const { data: caps } = useQuery({ queryKey: ['capabilities'], queryFn: () => apiGet<Capability[]>('/tenant/roles/capabilities'), enabled: isAdmin });
  const { data: customRoles } = useQuery({ queryKey: ['custom-roles'], queryFn: () => apiGet<CustomRole[]>('/tenant/roles'), enabled: isAdmin });

  const roleOptions: ChipOption[] = useMemo(
    () => [
      { value: 'TENANT_ADMIN', label: 'Company Admin', hint: 'Full control of this company' },
      ...(caps ?? []).map((c) => ({ value: c.key, label: c.name, hint: c.description })),
      ...(customRoles ?? []).map((r) => ({ value: r.key, label: r.name, hint: 'Custom role' })),
    ],
    [caps, customRoles],
  );
  const label = useMemo(() => new Map(roleOptions.map((o) => [o.value, o.label])), [roleOptions]);

  const resetPw = useMutation({
    mutationFn: ({ id, pw }: { id: string; email: string; pw: string }) => apiPatch(`/users/${id}/password`, { newPassword: pw }),
    onSuccess: (_r, v) => {
      toast.success('Password reset');
      setReveal({ email: v.email, pw: v.pw });
    },
    onError: (e) => toast.error('Could not reset', { description: e instanceof ApiError ? e.message : '' }),
  });
  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiPatch(`/users/${id}/active`, { isActive }),
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['tenant-users-self'] });
    },
    onError: (e) => toast.error('Could not update', { description: e instanceof ApiError ? e.message : '' }),
  });

  function doReset(id: string, email: string) {
    const pw = randomSecret();
    resetPw.mutate({ id, email, pw });
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only company admins can manage users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-muted-foreground">Manage your company's users and the roles they hold.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add user
        </Button>
      </div>

      {reveal ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-between gap-4 p-4 text-sm">
            <div>
              <p className="font-medium">Password reset — hand this over (shown once)</p>
              <p className="font-mono text-xs">Email: {reveal.email}</p>
              <p className="font-mono text-xs">Login: {reveal.pw}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(`Email: ${reveal.email}\nLogin: ${reveal.pw}`)}>
                <Copy className="size-4" /> Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReveal(null)}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
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
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (users ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">No users.</TableCell></TableRow>
              ) : (
                (users ?? []).map((u) => (
                  <TableRow key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                    <TableCell className="font-mono text-xs">{u.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => <Badge key={r} variant="secondary">{label.get(r) ?? r}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Edit roles" onClick={() => setEditUser(u)}>
                          <UserCog className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Reset password" disabled={resetPw.isPending} onClick={() => doReset(u.id, u.email)}>
                          <KeyRound className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title={u.isActive ? 'Deactivate' : 'Activate'} disabled={setActive.isPending} onClick={() => setActive.mutate({ id: u.id, isActive: !u.isActive })}>
                          {u.isActive ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} roleOptions={roleOptions} />
      <EditRolesDialog open={Boolean(editUser)} onOpenChange={(o) => { if (!o) setEditUser(null); }} user={editUser} roleOptions={roleOptions} />
    </div>
  );
}
