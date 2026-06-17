'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Mail,
  MailX,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import type { AppNotification, NotificationPreference } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const FILTERS = ['unread', 'all', 'archived'] as const;
type Filter = (typeof FILTERS)[number];
type Action = 'read' | 'unread' | 'archive' | 'delete';
const ICON: Record<string, { icon: typeof Info; cls: string }> = {
  SUCCESS: { icon: CheckCircle2, cls: 'text-success' },
  WARNING: { icon: AlertTriangle, cls: 'text-warning' },
  ERROR: { icon: XCircle, cls: 'text-destructive' },
  INFO: { icon: Info, cls: 'text-primary' },
};

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('unread');
  const [showPrefs, setShowPrefs] = useState(false);

  const feed = useQuery({
    queryKey: ['notif-feed', filter],
    queryFn: () => apiGet<AppNotification[]>(`/notifications?filter=${filter}&pageSize=50`),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notif-feed'] });
    void qc.invalidateQueries({ queryKey: ['notif-count'] });
    void qc.invalidateQueries({ queryKey: ['notif-recent'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Action failed');

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) =>
      action === 'delete' ? apiDelete(`/notifications/${id}`) : apiPost(`/notifications/${id}/${action}`),
    onSuccess: refresh,
    onError: fail,
  });
  const readAll = useMutation({ mutationFn: () => apiPost('/notifications/read-all'), onSuccess: () => { toast.success('All marked read'); refresh(); }, onError: fail });

  const items = feed.data ?? [];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Notifications"
        description="Your activity feed across CRM, inventory, finance, HR, and production."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPrefs((s) => !s)}>
              {showPrefs ? 'Hide preferences' : 'Preferences'}
            </Button>
            <Button size="sm" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
              <CheckCheck className="mr-1 h-4 w-4" /> Mark all read
            </Button>
          </div>
        }
      />

      {showPrefs ? <Preferences /> : null}

      <div className="flex gap-1 border-b">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition ${filter === f ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {items.length === 0 ? (
          <div className="rounded-xl border py-16 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 h-6 w-6" /> Nothing here.
          </div>
        ) : (
          items.map((n) => {
            const { icon: Icon, cls } = ICON[n.severity] ?? ICON.INFO;
            const isRead = !!n.readAt;
            return (
              <div key={n.id} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${isRead ? 'opacity-70' : 'bg-primary/[0.03]'}`}>
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cls}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      className="truncate text-sm font-medium hover:underline"
                      onClick={() => { act.mutate({ id: n.id, action: 'read' }); if (n.link) router.push(n.link); }}
                    >
                      {n.title}
                    </button>
                    <Badge variant="outline" className="text-[10px] capitalize">{n.category}</Badge>
                    {!isRead ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                  </div>
                  {n.body ? <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground/70">{ago(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {n.archivedAt ? (
                    <IconBtn title="Unarchive (mark unread)" onClick={() => act.mutate({ id: n.id, action: 'unread' })}><ArchiveRestore className="h-4 w-4" /></IconBtn>
                  ) : (
                    <>
                      {isRead ? (
                        <IconBtn title="Mark unread" onClick={() => act.mutate({ id: n.id, action: 'unread' })}><Mail className="h-4 w-4" /></IconBtn>
                      ) : (
                        <IconBtn title="Mark read" onClick={() => act.mutate({ id: n.id, action: 'read' })}><CheckCircle2 className="h-4 w-4" /></IconBtn>
                      )}
                      <IconBtn title="Archive" onClick={() => act.mutate({ id: n.id, action: 'archive' })}><Archive className="h-4 w-4" /></IconBtn>
                    </>
                  )}
                  <IconBtn title="Delete" onClick={() => act.mutate({ id: n.id, action: 'delete' })}><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title={title} onClick={onClick}>
      {children}
    </Button>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ['notif-prefs'], queryFn: () => apiGet<NotificationPreference[]>('/notifications/preferences') });
  const save = useMutation({
    mutationFn: (p: NotificationPreference) => apiPut(`/notifications/preferences/${p.category}`, { inApp: p.inApp, email: p.email }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notif-prefs'] }); void qc.invalidateQueries({ queryKey: ['notif-count'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save'),
  });

  return (
    <div className="rounded-xl border p-4">
      <p className="mb-3 text-sm font-medium">Channel preferences</p>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-6 px-1 text-xs uppercase text-muted-foreground">
          <span>Category</span>
          <span className="flex items-center gap-1"><Bell className="h-3.5 w-3.5" /> In-app</span>
          <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Email</span>
        </div>
        {(prefs.data ?? []).map((p) => (
          <div key={p.category} className="grid grid-cols-[1fr_auto_auto] items-center gap-6 rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-sm capitalize">{p.category}</span>
            <Switch checked={p.inApp} onCheckedChange={(v) => save.mutate({ ...p, inApp: v })} />
            <Switch checked={p.email} onCheckedChange={(v) => save.mutate({ ...p, email: v })} />
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><MailX className="h-3.5 w-3.5" /> Email is opt-in per category and best-effort.</p>
    </div>
  );
}
