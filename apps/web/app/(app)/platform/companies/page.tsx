'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, CheckCircle2, ShieldAlert } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NewCompanyDialog } from '@/components/platform/new-company-dialog';

interface Company {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  createdAt: string;
}

export default function CompaniesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isSuperAdmin = (user?.roles ?? []).includes('SUPER_ADMIN');

  const { data: companies, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => apiGet<Company[]>('/tenants'),
    enabled: isSuperAdmin,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Company['status'] }) =>
      apiPatch(`/tenants/${id}/status`, { status }),
    onSuccess: (_r, v) => {
      toast.success(v.status === 'suspended' ? 'Company suspended' : 'Company activated');
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => toast.error('Could not update company', { description: e instanceof ApiError ? e.message : '' }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Platform operators only</h2>
        <p className="text-sm text-muted-foreground">
          Company management is restricted to platform super-admins.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Companies</h2>
          <p className="text-muted-foreground">
            Every company (tenant) on this installation. Create one, hand over its admin credentials,
            and suspend or reactivate it. Suspending blocks all of that company's users from logging in.
          </p>
        </div>
        <NewCompanyDialog />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : (companies ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No companies yet — create the first one.
                  </TableCell>
                </TableRow>
              ) : (
                (companies ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Building2 className="size-4 text-muted-foreground" /> {c.name}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.slug}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === 'active' ? 'success' : 'destructive'}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === 'active' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: c.id, status: 'suspended' })}
                        >
                          <Ban className="size-4" /> Suspend
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: c.id, status: 'active' })}
                        >
                          <CheckCircle2 className="size-4" /> Activate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
