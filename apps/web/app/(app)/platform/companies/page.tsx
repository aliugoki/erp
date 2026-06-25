'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, PauseCircle, ShieldAlert } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NewCompanyDialog } from '@/components/platform/new-company-dialog';
import { CompanyDetailDialog, type Company } from '@/components/platform/company-detail-dialog';

interface TenantStats {
  total: number;
  active: number;
  suspended: number;
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Building2; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`flex size-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompaniesPage() {
  const { user } = useAuth();
  const isSuperAdmin = (user?.roles ?? []).includes('SUPER_ADMIN');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: companies, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => apiGet<Company[]>('/tenants'),
    enabled: isSuperAdmin,
  });
  const { data: stats } = useQuery({
    queryKey: ['tenant-stats'],
    queryFn: () => apiGet<TenantStats>('/tenants/stats'),
    enabled: isSuperAdmin,
  });

  const selected = (companies ?? []).find((c) => c.id === selectedId) ?? null;

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Platform operators only</h2>
        <p className="text-sm text-muted-foreground">Company management is restricted to platform super-admins.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Companies</h2>
          <p className="text-muted-foreground">
            Every company (tenant) on this installation. Click a row to manage its users, plan, and
            status. Suspending blocks all of that company's users from logging in.
          </p>
        </div>
        <NewCompanyDialog />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Companies" value={stats?.total ?? 0} icon={Building2} tone="bg-primary/10 text-primary" />
        <Kpi label="Active" value={stats?.active ?? 0} icon={CheckCircle2} tone="bg-success/15 text-success" />
        <Kpi label="Suspended" value={stats?.suspended ?? 0} icon={PauseCircle} tone="bg-destructive/15 text-destructive" />
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : (companies ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No companies yet — create the first one.
                  </TableCell>
                </TableRow>
              ) : (
                (companies ?? []).map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedId(c.id)}>
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CompanyDetailDialog company={selected} onOpenChange={(o) => { if (!o) setSelectedId(null); }} />
    </div>
  );
}
