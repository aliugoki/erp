'use client';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Target, Trophy } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';

interface Money {
  amountMinor: number;
  currency: string;
}
interface PipelineStage {
  stage: string;
  count: number;
  total: Money;
}
interface Deal {
  id: string;
  title: string;
  value: Money;
  stage: string;
}

const STAGE_LABEL: Record<string, string> = {
  LEAD: 'Lead',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  CLOSED_WON: 'Closed Won',
  CLOSED_LOST: 'Closed Lost',
};
const STAGE_ORDER = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
const STAGE_DOT: Record<string, string> = {
  LEAD: 'bg-muted-foreground',
  QUALIFIED: 'bg-primary',
  PROPOSAL: 'bg-primary',
  NEGOTIATION: 'bg-warning',
  CLOSED_WON: 'bg-success',
  CLOSED_LOST: 'bg-destructive',
};

export default function CrmPipelinePage() {
  const pipeline = useQuery({ queryKey: ['pipeline'], queryFn: () => apiGet<PipelineStage[]>('/crm/deals/pipeline') });
  const deals = useQuery({ queryKey: ['deals'], queryFn: () => apiGet<Deal[]>('/crm/deals') });

  const stages = pipeline.data ?? [];
  const byStage = stages.reduce<Record<string, PipelineStage>>((acc, s) => {
    acc[s.stage] = s;
    return acc;
  }, {});
  const dealsByStage = (deals.data ?? []).reduce<Record<string, Deal[]>>((acc, d) => {
    (acc[d.stage] ??= []).push(d);
    return acc;
  }, {});

  const isOpen = (s: string) => s !== 'CLOSED_WON' && s !== 'CLOSED_LOST';
  const openValue = stages.filter((s) => isOpen(s.stage)).reduce((sum, s) => sum + s.total.amountMinor, 0);
  const wonValue = byStage.CLOSED_WON?.total.amountMinor ?? 0;
  const openCount = stages.filter((s) => isOpen(s.stage)).reduce((sum, s) => sum + s.count, 0);
  const currency = stages[0]?.total.currency ?? 'PKR';

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Sales Pipeline" description="Deals grouped by stage, with live totals." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Briefcase} label="Open deals" value={openCount} accent="primary" delayMs={0} />
        <StatCard
          icon={Target}
          label="Open pipeline value"
          value={Math.round(openValue / 100)}
          format={(v) => `${currency} ${v.toLocaleString()}`}
          accent="warning"
          delayMs={70}
        />
        <StatCard
          icon={Trophy}
          label="Won value"
          value={Math.round(wonValue / 100)}
          format={(v) => `${currency} ${v.toLocaleString()}`}
          accent="success"
          delayMs={140}
        />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-3">
        {STAGE_ORDER.map((stage, i) => {
          const summary = byStage[stage];
          const cards = dealsByStage[stage] ?? [];
          const won = stage === 'CLOSED_WON';
          return (
            <div
              key={stage}
              className={cn(
                'flex w-72 shrink-0 animate-fade-up flex-col rounded-2xl border bg-muted/20',
                won && 'border-success/40 glow-primary',
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between gap-2 border-b p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', STAGE_DOT[stage], won && 'animate-glow-pulse')} />
                  <span className="text-sm font-semibold">{STAGE_LABEL[stage]}</span>
                </div>
                <Badge variant={won ? 'success' : 'secondary'}>{summary?.count ?? 0}</Badge>
              </div>
              <div className="px-3 py-2 text-sm font-semibold tabular-nums text-foreground/80">
                {summary ? formatMoney(summary.total.amountMinor, summary.total.currency) : `${currency} 0.00`}
              </div>
              <div className="flex-1 space-y-2 p-3 pt-1">
                {cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">No deals</p>
                ) : (
                  cards.map((d) => (
                    <div
                      key={d.id}
                      className="hover-lift group cursor-default rounded-xl border bg-card p-3"
                    >
                      <p className="truncate text-sm font-medium group-hover:text-primary">{d.title}</p>
                      <p className="mt-1 text-xs font-medium tabular-nums text-muted-foreground">
                        {formatMoney(d.value.amountMinor, d.value.currency)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
