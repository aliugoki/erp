'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '@/lib/api';
import type { FeatureModule } from '@/lib/nav';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

export default function FeaturesPage() {
  const qc = useQueryClient();
  const { data: modules, isLoading } = useQuery({
    queryKey: ['features'],
    queryFn: () => apiGet<FeatureModule[]>('/tenant/features'),
  });

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiPatch(`/tenant/features/${key}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['features'] }),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Features</h2>
        <p className="text-muted-foreground">
          Turn modules and capabilities on or off for your company. Changes apply instantly and are
          enforced by the API (not just hidden here).
        </p>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="space-y-4">
        {(modules ?? []).map((m) => (
          <Card key={m.key}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">{m.name}</CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </div>
              <Switch
                checked={m.enabled}
                disabled={toggle.isPending}
                onCheckedChange={(enabled) => toggle.mutate({ key: m.key, enabled })}
              />
            </CardHeader>
            {m.features.length ? (
              <CardContent className="space-y-2 border-t pt-4">
                {m.features.map((f) => (
                  <div key={f.key} className="flex items-center justify-between">
                    <span className={m.enabled ? 'text-sm' : 'text-sm text-muted-foreground'}>{f.name}</span>
                    <Switch
                      checked={f.enabled}
                      disabled={toggle.isPending || !m.enabled}
                      onCheckedChange={(enabled) => toggle.mutate({ key: f.key, enabled })}
                    />
                  </div>
                ))}
              </CardContent>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
