'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Target } from 'lucide-react';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { Goal, PerformanceReview } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { HrTabs } from '@/components/hr/hr-tabs';
import { NewReviewDialog } from '@/components/hr/new-review-dialog';
import { NewGoalDialog } from '@/components/hr/new-goal-dialog';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const REVIEW_VARIANT: Record<string, 'secondary' | 'warning' | 'success'> = { DRAFT: 'warning', SUBMITTED: 'success', ACKNOWLEDGED: 'success' };
const GOAL_VARIANT: Record<string, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  NOT_STARTED: 'secondary', IN_PROGRESS: 'warning', COMPLETED: 'success', CANCELLED: 'destructive',
};

export default function PerformancePage() {
  const qc = useQueryClient();
  const { data: reviews } = useQuery({ queryKey: ['reviews'], queryFn: () => apiGet<PerformanceReview[]>('/hr/reviews') });
  const { data: goals } = useQuery({ queryKey: ['goals'], queryFn: () => apiGet<Goal[]>('/hr/goals') });

  const submit = useMutation({
    mutationFn: (id: string) => apiPatch(`/hr/reviews/${id}/submit`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] }),
    onError: (e) => toast.error('Could not submit', { description: e instanceof ApiError ? e.message : '' }),
  });
  const setProgress = useMutation({
    mutationFn: ({ id, progress }: { id: string; progress: number }) => apiPatch(`/hr/goals/${id}`, { progress }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader
        title="Human Resources"
        description="Performance reviews and employee goals."
        action={<div className="flex gap-2"><NewGoalDialog /><NewReviewDialog /></div>}
      />
      <HrTabs />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 flex items-center gap-2 font-medium"><Star className="size-4" /> Reviews</p>
          {(reviews ?? []).length === 0 ? (
            <EmptyState icon={Star} title="No reviews yet" description="Start a performance review." />
          ) : (
            <ul className="space-y-2">
              {(reviews ?? []).map((r) => (
                <li key={r.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{r.employeeName ?? '—'} <span className="text-xs text-muted-foreground">· {r.period}</span></p>
                      <p className="font-mono text-xs text-muted-foreground">{r.reviewNo}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.rating ? <span className="text-sm tabular-nums">{'★'.repeat(r.rating)}<span className="text-muted-foreground">{'★'.repeat(5 - r.rating)}</span></span> : null}
                      <Badge variant={REVIEW_VARIANT[r.status] ?? 'secondary'}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
                      {r.status === 'DRAFT' ? <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate(r.id)}>Submit</Button> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <p className="mb-3 flex items-center gap-2 font-medium"><Target className="size-4" /> Goals</p>
          {(goals ?? []).length === 0 ? (
            <EmptyState icon={Target} title="No goals yet" description="Set a goal and track its progress." />
          ) : (
            <ul className="space-y-3">
              {(goals ?? []).map((g) => (
                <li key={g.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{g.title}</p>
                    <Badge variant={GOAL_VARIANT[g.status] ?? 'secondary'}>{g.status.replace('_', ' ').toLowerCase()}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${g.progress}%` }} />
                    </div>
                    <Select value={String(g.progress)} onValueChange={(v) => setProgress.mutate({ id: g.id, progress: Number(v) })}>
                      <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{[0, 25, 50, 75, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}%</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
