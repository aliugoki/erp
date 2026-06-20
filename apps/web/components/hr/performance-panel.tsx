'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPatch } from '@/lib/api';
import type { Goal, PerformanceReview } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { NewReviewDialog } from './new-review-dialog';
import { NewGoalDialog } from './new-goal-dialog';
import { HrStatusBadge } from './hr-ui';

const GOAL_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export function PerformancePanel() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Failed');

  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => apiGet<PerformanceReview[]>('/hr/reviews') });
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => apiGet<Goal[]>('/hr/goals') });

  const submit = useMutation({
    mutationFn: (id: string) => apiPatch(`/hr/reviews/${id}/submit`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['reviews'] }); },
    onError: onErr,
  });

  const setProgress = useMutation({
    mutationFn: ({ id, progress }: { id: string; progress: number }) => apiPatch(`/hr/goals/${id}`, { progress }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['goals'] }); },
    onError: onErr,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/hr/goals/${id}`, { status }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['goals'] }); },
    onError: onErr,
  });

  const reviewList = reviews.data ?? [];
  const goalList = goals.data ?? [];

  return (
    <>
      <PaneHeader>
        <div className="ml-auto flex items-center gap-2">
          <NewGoalDialog />
          <NewReviewDialog />
        </div>
      </PaneHeader>
      <PaneBody className="space-y-6 p-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reviews</h3>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Review #</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Period</th><th className="px-3 py-2 text-right">Rating</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
              <tbody className="divide-y">
                {reviewList.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.reviewNo}</td>
                    <td className="px-3 py-2 font-medium">{r.employeeName ?? '—'}</td>
                    <td className="px-3 py-2">{r.period}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.rating ? `${r.rating}/5` : '—'}</td>
                    <td className="px-3 py-2"><HrStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'DRAFT' ? <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate(r.id)}>Submit</Button> : null}
                    </td>
                  </tr>
                ))}
                {reviewList.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No reviews yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Goals</h3>
          <ul className="space-y-3">
            {goalList.map((g) => (
              <li key={g.id} className="rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{g.title}</p>
                  <HrStatusBadge status={g.status} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${g.progress}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{g.progress}%</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={drafts[g.id] ?? String(g.progress)}
                    onChange={(e) => setDrafts((s) => ({ ...s, [g.id]: e.target.value }))}
                    className="h-8 w-20 text-right"
                  />
                  <Button size="sm" disabled={setProgress.isPending} onClick={() => setProgress.mutate({ id: g.id, progress: Number(drafts[g.id] ?? g.progress) || 0 })}><Save className="size-4" /></Button>
                  <select value={g.status} onChange={(e) => setStatus.mutate({ id: g.id, status: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-xs">
                    {GOAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
                  </select>
                </div>
              </li>
            ))}
            {goalList.length === 0 ? <li className="rounded-xl border px-3 py-6 text-center text-sm text-muted-foreground">No goals yet.</li> : null}
          </ul>
        </section>
      </PaneBody>
    </>
  );
}
