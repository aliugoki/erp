'use client';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { apiGet } from '@/lib/api';
import type { FeatureModule } from '@/lib/nav';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Read-only view of the company's enabled modules. Entitlements are managed by the platform
 * operator (super-admin) per company — a company can no longer toggle its own modules. */
export default function FeaturesPage() {
  const { data: modules, isLoading } = useQuery({
    queryKey: ['features'],
    queryFn: () => apiGet<FeatureModule[]>('/tenant/features'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Features</h2>
        <p className="text-muted-foreground">
          The modules enabled for your company. These are managed by your provider — contact them to
          add or remove modules.
        </p>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="space-y-4">
        {(modules ?? []).map((m) => (
          <Card key={m.key} className={m.enabled ? '' : 'opacity-60'}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">{m.name}</CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </div>
              <Badge variant={m.enabled ? 'success' : 'secondary'}>
                {m.enabled ? 'Enabled' : <span className="flex items-center gap-1"><Lock className="size-3" /> Off</span>}
              </Badge>
            </CardHeader>
            {m.enabled && m.features.length ? (
              <CardContent className="space-y-2 border-t pt-4">
                {m.features.map((f) => (
                  <div key={f.key} className="flex items-center justify-between">
                    <span className="text-sm">{f.name}</span>
                    <Badge variant={f.enabled ? 'success' : 'secondary'}>{f.enabled ? 'On' : 'Off'}</Badge>
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
