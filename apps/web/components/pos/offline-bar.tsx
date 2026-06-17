'use client';
import { useCallback, useEffect, useState } from 'react';
import { CloudOff, RefreshCw, Trash2, TriangleAlert, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { type QueuedSale, getQueue, removeQueued, updateQueued } from '@/lib/pos-offline';
import { syncQueue } from '@/lib/pos-sync';
import { useOnline } from '@/lib/use-online';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** POS connectivity + offline-queue status. Auto-syncs queued sales when the connection returns and on
 * an interval; surfaces sales that failed to sync (e.g. a reconcile-time stock conflict) for review. */
export function OfflineBar({ onSynced }: { onSynced?: () => void }) {
  const online = useOnline();
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const refresh = useCallback(() => setQueue(getQueue()), []);

  const run = useCallback(async () => {
    if (syncing || getQueue().filter((q) => q.status === 'pending').length === 0) return;
    setSyncing(true);
    try {
      const r = await syncQueue();
      refresh();
      if (r.synced > 0) {
        toast.success(`Synced ${r.synced} offline sale${r.synced > 1 ? 's' : ''}`);
        onSynced?.();
      }
      if (r.failed > 0) toast.error(`${r.failed} sale(s) need review`);
    } finally {
      setSyncing(false);
    }
  }, [syncing, refresh, onSynced]);

  // Re-read the queue periodically (localStorage isn't reactive) and auto-sync when online.
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      refresh();
      if (navigator.onLine) void run();
    }, 8000);
    return () => clearInterval(id);
  }, [refresh, run]);

  // Sync immediately when connectivity returns.
  useEffect(() => {
    if (online) void run();
  }, [online, run]);

  const pending = queue.filter((q) => q.status === 'pending');
  const failed = queue.filter((q) => q.status === 'error');

  if (online && pending.length === 0 && failed.length === 0) {
    return (
      <Badge variant="outline" className="h-7 gap-1 text-success">
        <Wifi className="h-3.5 w-3.5" /> Online
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {online ? (
        <Badge variant="outline" className="h-7 gap-1 text-success"><Wifi className="h-3.5 w-3.5" /> Online</Badge>
      ) : (
        <Badge variant="secondary" className="h-7 gap-1 text-warning"><CloudOff className="h-3.5 w-3.5" /> Offline — selling locally</Badge>
      )}
      {pending.length > 0 ? (
        <Badge variant="outline" className="h-7 gap-1">
          {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          {pending.length} to sync
        </Badge>
      ) : null}
      {online && pending.length > 0 ? (
        <Button size="sm" variant="outline" className="h-7" disabled={syncing} onClick={() => void run()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sync now
        </Button>
      ) : null}
      {failed.map((f) => (
        <Badge key={f.key} variant="destructive" className="h-7 gap-1" title={f.error ?? ''}>
          <TriangleAlert className="h-3.5 w-3.5" /> {f.receipt.saleNo} review
          <button className="ml-1" title="Retry" onClick={() => { updateQueued(f.key, { status: 'pending', error: undefined }); refresh(); void run(); }}>
            <RefreshCw className="h-3 w-3" />
          </button>
          <button title="Discard" onClick={() => { removeQueued(f.key); refresh(); }}>
            <Trash2 className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
