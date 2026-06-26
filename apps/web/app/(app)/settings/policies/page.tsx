'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Policy {
  key: string;
  module: string;
  group: string;
  label: string;
  help: string;
  type: 'boolean' | 'number' | 'money' | 'enum';
  default: boolean | number | string;
  options?: string[];
  min?: number;
  max?: number;
  value: boolean | number | string;
  isOverride: boolean;
  enforced?: boolean;
}

export default function PoliciesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = (user?.roles ?? []).some((r) => r === 'TENANT_ADMIN' || r === 'SUPER_ADMIN');
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data: policies, isLoading } = useQuery({
    queryKey: ['policies'],
    queryFn: () => apiGet<Policy[]>('/tenant/policies'),
    enabled: isAdmin,
  });

  const set = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => apiPut(`/tenant/policies/${key}`, { value }),
    onSuccess: () => {
      toast.success('Policy updated');
      qc.invalidateQueries({ queryKey: ['policies'] });
    },
    onError: (e) => toast.error('Could not update policy', { description: e instanceof ApiError ? e.message : '' }),
  });
  const reset = useMutation({
    mutationFn: (key: string) => apiDelete(`/tenant/policies/${key}`),
    onSuccess: () => {
      toast.success('Reverted to default');
      qc.invalidateQueries({ queryKey: ['policies'] });
    },
    onError: (e) => toast.error('Could not reset', { description: e instanceof ApiError ? e.message : '' }),
  });

  const groups = useMemo(() => {
    const m = new Map<string, Policy[]>();
    for (const p of policies ?? []) (m.get(p.group) ?? m.set(p.group, []).get(p.group)!).push(p);
    return [...m.entries()];
  }, [policies]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Only company admins can manage policies.</p>
      </div>
    );
  }

  const numericDisplay = (p: Policy) => {
    const cur = draft[p.key];
    if (cur !== undefined) return cur;
    return p.type === 'money' ? (Number(p.value) / 100).toString() : String(p.value);
  };
  const saveNumeric = (p: Policy) => {
    const raw = numericDisplay(p);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const value = p.type === 'money' ? Math.round(n * 100) : n;
    set.mutate({ key: p.key, value });
    setDraft((d) => { const { [p.key]: _, ...rest } = d; return rest; });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Policies</h2>
        <p className="text-muted-foreground">
          Configure your company's business rules. Changes apply across the app and are enforced by the
          backend. Defaults match the platform's standard behaviour.
        </p>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {groups.map(([group, items]) => (
        <Card key={group}>
          <CardHeader><CardTitle className="text-base">{group}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {items.map((p) => (
              <div key={p.key} className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {p.label}
                    {p.isOverride ? <Badge variant="secondary" className="text-[10px]">customised</Badge> : null}
                    {!p.enforced ? <Badge variant="outline" className="text-[10px] text-muted-foreground">not enforced yet</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.help}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.type === 'boolean' ? (
                    <Switch checked={Boolean(p.value)} disabled={set.isPending} onCheckedChange={(v) => set.mutate({ key: p.key, value: v })} />
                  ) : p.type === 'enum' ? (
                    <Select value={String(p.value)} onValueChange={(v) => set.mutate({ key: p.key, value: v })}>
                      <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{(p.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="h-8 w-28"
                        value={numericDisplay(p)}
                        min={p.min}
                        max={p.max}
                        onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                      />
                      {p.type === 'money' ? <span className="text-xs text-muted-foreground">PKR</span> : p.max === 100 ? <span className="text-xs text-muted-foreground">%</span> : null}
                      <Button size="icon" variant="outline" className="size-8" title="Save" disabled={set.isPending} onClick={() => saveNumeric(p)}><Save className="size-4" /></Button>
                    </span>
                  )}
                  {p.isOverride ? (
                    <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" title="Reset to default" disabled={reset.isPending} onClick={() => reset.mutate(p.key)}>
                      <RotateCcw className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
