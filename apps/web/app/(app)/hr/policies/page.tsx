'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import type { Policy } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { HrTabs } from '@/components/hr/hr-tabs';
import { NewPolicyDialog } from '@/components/hr/new-policy-dialog';
import { ManageCustomFieldsDialog } from '@/components/hr/new-custom-field-dialog';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUS_VARIANT: Record<string, 'secondary' | 'warning' | 'success'> = { DRAFT: 'warning', ACTIVE: 'success', ARCHIVED: 'secondary' };
const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

export default function PoliciesPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: policies } = useQuery({ queryKey: ['policies'], queryFn: () => apiGet<Policy[]>('/hr/policies') });
  const detail = useQuery({ queryKey: ['policy', openId], queryFn: () => apiGet<Policy>(`/hr/policies/${openId}`), enabled: !!openId });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/hr/policies/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const list = policies ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-up">
      <PageHeader
        title="Human Resources"
        description="Company policies with your own custom fields."
        action={<div className="flex gap-2"><ManageCustomFieldsDialog /><NewPolicyDialog /></div>}
      />
      <HrTabs />

      {list.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={ScrollText} title="No policies yet" description="Define custom fields, then create your first policy." action={<NewPolicyDialog />} />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button className="text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                    <p className="font-medium hover:text-primary">{p.name}</p>
                  </button>
                  <p className="text-xs text-muted-foreground">
                    <Badge variant="secondary" className="mr-2 text-[10px]">{p.category}</Badge>
                    {p.effectiveDate ? `eff. ${p.effectiveDate}` : 'no effective date'} · v{p.version}
                  </p>
                  {p.description ? <p className="mt-1 text-sm text-muted-foreground">{p.description}</p> : null}
                </div>
                <Select value={p.status} onValueChange={(status) => setStatus.mutate({ id: p.id, status })}>
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {openId === p.id && detail.data?.fields && detail.data.fields.length > 0 ? (
                <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
                  {detail.data.fields.map((f) => (
                    <div key={f.fieldId} className="flex justify-between gap-3 rounded-lg border p-2 text-sm">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="font-medium">{f.value ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {openId === p.id && detail.data && (!detail.data.fields || detail.data.fields.length === 0) ? (
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">No custom field values on this policy.</p>
              ) : null}

              <div className="mt-1">
                <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
