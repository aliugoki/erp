'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { ApiError, apiDelete, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleDialog, type Capability, type CustomRole } from '@/components/settings/role-dialog';

export default function RolesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = (user?.roles ?? []).some((r) => r === 'TENANT_ADMIN' || r === 'SUPER_ADMIN');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomRole | null>(null);

  const { data: caps } = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => apiGet<Capability[]>('/tenant/roles/capabilities'),
    enabled: isAdmin,
  });
  const { data: roles, isLoading } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => apiGet<CustomRole[]>('/tenant/roles'),
    enabled: isAdmin,
  });
  const capName = useMemo(() => new Map((caps ?? []).map((c) => [c.key, c.name])), [caps]);

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/tenant/roles/${id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      qc.invalidateQueries({ queryKey: ['custom-roles'] });
    },
    onError: (e) => toast.error('Could not delete', { description: e instanceof ApiError ? e.message : '' }),
  });

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only company admins can manage roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Roles</h2>
          <p className="text-muted-foreground">
            Build custom roles by combining capabilities, then assign them to users under <strong>Users</strong>.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="size-4" /> New role
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (roles ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No custom roles yet. Create one (e.g. “Branch Manager” = Inventory + Sales).
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(roles ?? []).map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{r.name}</CardTitle>
                  {r.description ? <CardDescription>{r.description}</CardDescription> : null}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => { setEditing(r); setDialogOpen(true); }}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {r.memberRoles.map((m) => (
                  <Badge key={m} variant="secondary">{capName.get(m) ?? m}</Badge>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RoleDialog open={dialogOpen} onOpenChange={setDialogOpen} capabilities={caps ?? []} existing={editing} />
    </div>
  );
}
