'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';
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

export default function CrmPipelinePage() {
  const pipeline = useQuery({ queryKey: ['pipeline'], queryFn: () => apiGet<PipelineStage[]>('/crm/deals/pipeline') });
  const deals = useQuery({ queryKey: ['deals'], queryFn: () => apiGet<Deal[]>('/crm/deals') });

  const byStage = (pipeline.data ?? []).reduce<Record<string, PipelineStage>>((acc, s) => {
    acc[s.stage] = s;
    return acc;
  }, {});
  const dealsByStage = (deals.data ?? []).reduce<Record<string, Deal[]>>((acc, d) => {
    (acc[d.stage] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Sales Pipeline</h2>
        <p className="text-muted-foreground">Deals grouped by stage, with totals.</p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {STAGE_ORDER.map((stage) => {
          const summary = byStage[stage];
          const cards = dealsByStage[stage] ?? [];
          const won = stage === 'CLOSED_WON';
          return (
            <div key={stage} className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30">
              <div className="flex items-center justify-between border-b p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', won ? 'bg-success' : stage === 'CLOSED_LOST' ? 'bg-destructive' : 'bg-primary')} />
                  <span className="text-sm font-medium">{STAGE_LABEL[stage]}</span>
                  <Badge variant="secondary">{summary?.count ?? 0}</Badge>
                </div>
              </div>
              <div className="p-3 text-xs text-muted-foreground">
                {summary ? formatMoney(summary.total.amountMinor, summary.total.currency) : 'PKR 0.00'}
              </div>
              <div className="flex-1 space-y-2 p-3 pt-0">
                {cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">No deals</p>
                ) : (
                  cards.map((d) => (
                    <div key={d.id} className="rounded-lg border bg-card p-3 shadow-sm">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatMoney(d.value.amountMinor, d.value.currency)}</p>
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
