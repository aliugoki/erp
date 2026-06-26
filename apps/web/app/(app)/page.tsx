'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Layers, ShieldCheck, ToggleRight } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type FeatureModule, MODULE_NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { DashboardCharts } from '@/components/dashboard/dashboard-charts';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: modules } = useQuery({ queryKey: ['features'], queryFn: () => apiGet<FeatureModule[]>('/tenant/features') });

  const all = modules ?? [];
  const enabled = all.filter((m) => m.enabled);
  const features = all.flatMap((m) => m.features);
  const enabledFeatures = features.filter((f) => f.enabled);
  const enabledKeys = new Set(enabled.map((m) => m.key));

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <PageHeader title="Welcome back" description="Your workspace at a glance." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Layers} label="Active modules" value={enabled.length} accent="primary" delayMs={0} className="glass elevated" />
        <StatCard
          icon={ToggleRight}
          label="Enabled features"
          value={enabledFeatures.length}
          format={(v) => `${v}/${features.length}`}
          accent="success"
          delayMs={70}
          className="glass elevated"
        />
        <StatCard icon={ShieldCheck} label="Your roles" value={user?.roles.length ?? 0} accent="warning" delayMs={140} className="glass elevated" />
      </div>

      <DashboardCharts enabledModules={enabledKeys} />

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Modules</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {all.map((m, i) => {
            const nav = MODULE_NAV[m.key];
            const body = (
              <Card
                className={cn('h-full glass elevated animate-fade-up', m.enabled ? 'hover-lift' : 'opacity-55')}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{m.name}</CardTitle>
                    <Badge variant={m.enabled ? 'success' : 'secondary'}>{m.enabled ? 'Enabled' : 'Off'}</Badge>
                  </div>
                  <CardDescription>{m.description}</CardDescription>
                </CardHeader>
                {m.enabled && nav ? (
                  <CardContent className="flex items-center gap-1 text-sm font-medium text-primary">
                    Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                ) : null}
              </Card>
            );
            return m.enabled && nav ? (
              <Link key={m.key} href={nav.href} className="group block">
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
