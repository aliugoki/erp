'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ListTodo, Phone } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';
import type { Activity } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { CrmTabs } from '@/components/crm/crm-tabs';
import { NewActivityDialog } from '@/components/crm/new-activity-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const TYPE_LABEL: Record<string, string> = { CALL: 'Call', MEETING: 'Meeting', EMAIL: 'Email', TASK: 'Task', NOTE: 'Note' };

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function ActivitiesPage() {
  const qc = useQueryClient();
  const open = useQuery({ queryKey: ['open-tasks'], queryFn: () => apiGet<Activity[]>('/crm/activities/open') });
  const all = useQuery({ queryKey: ['activities'], queryFn: () => apiGet<Activity[]>('/crm/activities') });

  const complete = useMutation({
    mutationFn: (id: string) => apiPatch(`/crm/activities/${id}/complete`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['open-tasks'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });

  const openTasks = open.data ?? [];
  const now = Date.now();
  const overdue = openTasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now).length;
  const done = (all.data ?? []).filter((a) => a.completed).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fade-up">
      <PageHeader title="CRM" description="Calls, meetings, emails, tasks and notes across your records." action={<NewActivityDialog />} />
      <CrmTabs />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={ListTodo} label="Open tasks" value={openTasks.length} accent="primary" delayMs={0} />
        <StatCard icon={CalendarClock} label="Overdue" value={overdue} accent={overdue ? 'warning' : 'success'} delayMs={60} />
        <StatCard icon={CheckCircle2} label="Completed" value={done} accent="success" delayMs={120} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 font-medium">Open tasks</p>
          {openTasks.length === 0 ? (
            <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Nothing due — you&apos;re clear.</p>
          ) : (
            <ul className="space-y-2">
              {openTasks.map((t) => {
                const isOverdue = t.dueAt && new Date(t.dueAt).getTime() < now;
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[t.type] ?? t.type}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.subject}</p>
                      {t.dueAt ? <p className={isOverdue ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>{fmt(t.dueAt)}</p> : null}
                    </div>
                    <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate(t.id)}>Done</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <p className="mb-3 font-medium">Recent timeline</p>
          {(all.data ?? []).length === 0 ? (
            <EmptyState icon={Phone} title="No activity yet" description="Log a call, meeting or note to build the timeline." />
          ) : (
            <ul className="space-y-3">
              {(all.data ?? []).slice(0, 20).map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${a.completed ? 'bg-success' : 'bg-primary'}`} />
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{a.subject}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{TYPE_LABEL[a.type] ?? a.type}</span>
                    </p>
                    {a.body ? <p className="truncate text-xs text-muted-foreground">{a.body}</p> : null}
                    <p className="text-xs text-muted-foreground">{fmt(a.dueAt ?? a.createdAt)}{a.completed ? ' · done' : ''}</p>
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
