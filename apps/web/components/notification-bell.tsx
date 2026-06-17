'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, XCircle } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import type { AppNotification } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ICON: Record<string, { icon: typeof Info; cls: string }> = {
  SUCCESS: { icon: CheckCircle2, cls: 'text-success' },
  WARNING: { icon: AlertTriangle, cls: 'text-warning' },
  ERROR: { icon: XCircle, cls: 'text-destructive' },
  INFO: { icon: Info, cls: 'text-primary' },
};

export function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const count = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => apiGet<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const recent = useQuery({
    queryKey: ['notif-recent'],
    queryFn: () => apiGet<AppNotification[]>('/notifications?filter=unread&pageSize=8'),
    enabled: open,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notif-count'] });
    void qc.invalidateQueries({ queryKey: ['notif-recent'] });
    void qc.invalidateQueries({ queryKey: ['notif-feed'] });
  };
  const readOne = useMutation({ mutationFn: (id: string) => apiPost(`/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => apiPost('/notifications/read-all'), onSuccess: refresh });

  const unread = count.data?.count ?? 0;
  const open1 = (n: AppNotification) => {
    readOne.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => readAll.mutate()}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-80 overflow-y-auto">
          {(recent.data ?? []).length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            (recent.data ?? []).map((n) => {
              const { icon: Icon, cls } = ICON[n.severity] ?? ICON.INFO;
              return (
                <button key={n.id} onClick={() => open1(n)} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-muted/50">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    {n.body ? <span className="block truncate text-xs text-muted-foreground">{n.body}</span> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <button className="block w-full px-3 py-2 text-center text-sm text-primary hover:bg-muted/50" onClick={() => { setOpen(false); router.push('/notifications'); }}>
          View all notifications
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
