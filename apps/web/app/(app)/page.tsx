'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Layers, ShieldCheck, ToggleRight } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type FeatureModule, MODULE_NAV } from '@/lib/nav';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function Stat({ icon: Icon, label, value }: { icon: typeof Layers; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: modules } = useQuery({ queryKey: ['features'], queryFn: () => apiGet<FeatureModule[]>('/tenant/features') });

  const all = modules ?? [];
  const enabled = all.filter((m) => m.enabled);
  const features = all.flatMap((m) => m.features);
  const enabledFeatures = features.filter((f) => f.enabled);

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
        <p className="text-muted-foreground">Your workspace at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Layers} label="Active modules" value={enabled.length} />
        <Stat icon={ToggleRight} label="Enabled features" value={`${enabledFeatures.length}/${features.length}`} />
        <Stat icon={ShieldCheck} label="Your roles" value={user?.roles.length ?? 0} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Modules</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {all.map((m) => {
            const nav = MODULE_NAV[m.key];
            const body = (
              <Card className={m.enabled ? 'transition-shadow hover:shadow-md' : 'opacity-60'}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{m.name}</CardTitle>
                    <Badge variant={m.enabled ? 'success' : 'secondary'}>{m.enabled ? 'Enabled' : 'Off'}</Badge>
                  </div>
                  <CardDescription>{m.description}</CardDescription>
                </CardHeader>
                {m.enabled && nav ? (
                  <CardContent className="flex items-center gap-1 text-sm font-medium text-primary">
                    Open <ArrowRight className="size-4" />
                  </CardContent>
                ) : null}
              </Card>
            );
            return m.enabled && nav ? (
              <Link key={m.key} href={nav.href}>
                {body}
              </Link>
            ) : (
              <div key={m.key}>{body}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
