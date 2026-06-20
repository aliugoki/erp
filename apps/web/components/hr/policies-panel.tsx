'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { Policy } from '@/lib/types';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { ManageCustomFieldsDialog } from './new-custom-field-dialog';
import { NewPolicyDialog } from './new-policy-dialog';
import { HrStatusBadge, fmtDate } from './hr-ui';

const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

export function PoliciesPanel() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const policies = useQuery({ queryKey: ['policies'], queryFn: () => apiGet<Policy[]>('/hr/policies') });
  const detail = useQuery({
    queryKey: ['policy', openId],
    queryFn: () => apiGet<Policy>(`/hr/policies/${openId}`),
    enabled: !!openId,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/hr/policies/${id}/status`, { status }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['policies'] }); },
    onError: onErr,
  });

  const list = policies.data ?? [];

  return (
    <>
      <PaneHeader>
        <div className="ml-auto flex items-center gap-2">
          <ManageCustomFieldsDialog />
          <NewPolicyDialog />
        </div>
      </PaneHeader>
      <PaneBody className="space-y-3 p-5">
        {list.map((p) => (
          <div key={p.id} className="rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button className="text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                  <p className="font-medium hover:text-primary">{p.name}</p>
                </button>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase">{p.category}</span>
                  <span>eff. {fmtDate(p.effectiveDate)} · v{p.version}</span>
                  <HrStatusBadge status={p.status} />
                </p>
                {p.description ? <p className="mt-1 text-sm text-muted-foreground">{p.description}</p> : null}
              </div>
              <select value={p.status} onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm">
                {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
              </select>
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
          </div>
        ))}
        {list.length === 0 ? <p className="rounded-xl border px-3 py-6 text-center text-sm text-muted-foreground">No policies yet.</p> : null}
      </PaneBody>
    </>
  );
}
