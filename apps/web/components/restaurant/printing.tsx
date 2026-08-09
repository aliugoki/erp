'use client';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode, CheckCircle2, Download, Loader2, Plus, Printer, QrCode, RefreshCw, ScanLine, Trash2, XCircle,
} from 'lucide-react';
import { ApiError, apiBlob, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { AuthImage } from '@/components/auth-image';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyDetail, ListRow, PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { Hint, Spinner } from '@/components/restaurant/rest-ui';

const err = (e: unknown) => (e instanceof ApiError ? e.message : '');

export const PRINTER_KINDS = ['RECEIPT', 'KITCHEN', 'LABEL', 'REPORT'] as const;
export const PRINTER_CONNECTIONS = ['NETWORK', 'USB', 'BLUETOOTH', 'BROWSER', 'CLOUD'] as const;

export interface Printer {
  id: string; branchId: string | null; branchName: string | null; key: string; name: string;
  kind: string; connection: string; host: string | null; port: number; devicePath: string | null;
  stationKey: string | null; charsPerLine: number; codepage: string; copies: number;
  cut: boolean; cashDrawer: boolean; isDefault: boolean; active: boolean;
  lastSeenAt: string | null; queued: number; failed: number;
}

export interface PrintJob {
  id: string; kind: string; docType: string | null; docId: string | null; docNo: string | null;
  stationKey: string | null; status: string; copies: number; attempts: number; error: string | null;
  printerName: string | null; printerKey: string | null; createdAt: string; printedAt: string | null;
}

interface RenderedDoc { text: string; escposBase64: string }

const JOB_TONE: Record<string, string> = {
  QUEUED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  CLAIMED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  PRINTED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  FAILED: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function JobBadge({ status }: { status: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${JOB_TONE[status] ?? 'bg-muted'}`}>{status}</span>;
}

// ── Printers: list pane ─────────────────────────────────────────────────────────
export function PrinterList({ printers, loading, sel, onSelect, branchId }: {
  printers: Printer[]; loading: boolean; sel: string | null; onSelect: (id: string) => void; branchId?: string | null;
}) {
  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-semibold">Printers</span>
        <NewPrinterDialog branchId={branchId} />
      </PaneHeader>
      <PaneBody>
        {loading ? <Spinner /> : printers.length === 0 ? (
          <Hint>No printers yet. Add the till&apos;s receipt printer and one per kitchen station.</Hint>
        ) : (
          <ul className="divide-y">
            {printers.map((p) => (
              <ListRow key={p.id} active={sel === p.id} onClick={() => onSelect(p.id)}>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Printer className={`size-4 shrink-0 ${p.active ? 'text-muted-foreground' : 'text-muted-foreground/40'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.kind.toLowerCase()}{p.stationKey ? ` · ${p.stationKey}` : ''} · {p.connection === 'NETWORK' ? `${p.host}:${p.port}` : p.connection.toLowerCase()}
                    </div>
                  </div>
                  {p.queued > 0 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{p.queued}</span> : null}
                  {p.failed > 0 ? <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">{p.failed}!</span> : null}
                </div>
              </ListRow>
            ))}
          </ul>
        )}
      </PaneBody>
    </>
  );
}

// ── Printers: detail pane (settings + this device's spool) ──────────────────────
export function PrinterDetail({ printer }: { printer?: Printer }) {
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ['rest-print-jobs', printer?.id],
    queryFn: () => apiGet<PrintJob[]>(`/restaurant/print-jobs?printerId=${printer!.id}&limit=30`),
    enabled: !!printer,
    refetchInterval: 5000,
  });

  const act = useMutation({
    mutationFn: (v: { run: () => Promise<unknown>; ok: string }) => v.run(),
    onSuccess: (_d, v) => {
      toast.success(v.ok);
      qc.invalidateQueries({ queryKey: ['rest-printers'] });
      qc.invalidateQueries({ queryKey: ['rest-print-jobs'] });
    },
    onError: (e) => toast.error('Action failed', { description: err(e) }),
  });

  if (!printer) return <EmptyDetail icon={Printer} title="Select a printer" hint="Register the devices this outlet prints on, then watch their queue here." />;

  const patch = (body: Record<string, unknown>, ok: string) =>
    act.mutate({ run: () => apiPatch(`/restaurant/printers/${printer.id}`, body), ok });

  return (
    <PaneBody className="space-y-5 p-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{printer.name}</h2>
          <p className="text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1">{printer.key}</code> — the key the print agent is configured with
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ run: () => apiPost(`/restaurant/printers/${printer.id}/test`, {}), ok: 'Test page queued' })}>
          <Printer className="mr-1.5 size-3.5" /> Test print
        </Button>
        <Button size="sm" variant="ghost" className="text-rose-600" disabled={act.isPending}
          onClick={() => act.mutate({ run: () => apiDelete(`/restaurant/printers/${printer.id}`), ok: 'Printer removed' })}>
          <Trash2 className="size-3.5" />
        </Button>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label="Kind" value={printer.kind} />
        <Field label="Connection" value={printer.connection} />
        <Field label="Address" value={printer.connection === 'NETWORK' ? `${printer.host ?? '—'}:${printer.port}` : (printer.devicePath ?? '—')} />
        <Field label="Station" value={printer.stationKey ?? 'any'} />
        <Field label="Paper" value={`${printer.charsPerLine} cols (${printer.charsPerLine <= 32 ? '58mm' : '80mm'})`} />
        <Field label="Branch" value={printer.branchName ?? 'All branches'} />
        <Field label="Last seen" value={printer.lastSeenAt ? new Date(printer.lastSeenAt).toLocaleString() : 'never'} />
      </dl>

      <div className="flex flex-wrap gap-2">
        <Toggle on={printer.active} label="Active" onClick={() => patch({ active: !printer.active }, printer.active ? 'Printer paused' : 'Printer active')} />
        <Toggle on={printer.cashDrawer} label="Kick cash drawer" onClick={() => patch({ cashDrawer: !printer.cashDrawer }, 'Saved')} />
        <Toggle on={printer.cut} label="Auto-cut" onClick={() => patch({ cut: !printer.cut }, 'Saved')} />
        <Toggle on={printer.isDefault} label="Default for this kind" onClick={() => patch({ isDefault: !printer.isDefault }, 'Saved')} />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Queue</h3>
        {jobs.isLoading ? <Spinner /> : (jobs.data ?? []).length === 0 ? (
          <Hint>Nothing queued. Jobs appear here the moment an order fires or a bill is printed.</Hint>
        ) : (
          <ul className="divide-y rounded-lg border">
            {(jobs.data ?? []).map((j) => (
              <li key={j.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <JobBadge status={j.status} />
                <span className="font-medium">{j.kind}</span>
                <span className="truncate text-muted-foreground">{j.docNo ?? ''}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{new Date(j.createdAt).toLocaleTimeString()}</span>
                {j.error ? <span className="max-w-[12rem] truncate text-xs text-rose-600" title={j.error}>{j.error}</span> : null}
                <JobPreviewDialog job={j} />
                {['FAILED', 'CANCELLED', 'CLAIMED'].includes(j.status) ? (
                  <button type="button" title="Retry" className="text-muted-foreground hover:text-foreground"
                    onClick={() => act.mutate({ run: () => apiPost(`/restaurant/print-jobs/${j.id}/retry`, {}), ok: 'Job requeued' })}>
                    <RefreshCw className="size-3.5" />
                  </button>
                ) : null}
                {j.status === 'QUEUED' ? (
                  <button type="button" title="Cancel" className="text-muted-foreground hover:text-rose-600"
                    onClick={() => act.mutate({ run: () => apiPost(`/restaurant/print-jobs/${j.id}/cancel`, {}), ok: 'Job cancelled' })}>
                    <XCircle className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        Jobs are pushed to the device by the local print agent, not by this server — a printer on the
        restaurant LAN is never exposed to the internet. Run it with{' '}
        <code className="rounded bg-muted px-1">PRINTER_KEY={printer.key} node scripts/print-agent.js</code>
      </p>
    </PaneBody>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant={on ? 'default' : 'outline'} onClick={onClick}>
      {on ? <CheckCircle2 className="mr-1.5 size-3.5" /> : null}{label}
    </Button>
  );
}

// ── Add a printer ───────────────────────────────────────────────────────────────
export function NewPrinterDialog({ branchId }: { branchId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', kind: 'RECEIPT', connection: 'NETWORK', host: '', port: '9100', devicePath: '', stationKey: '', charsPerLine: '42' });
  const qc = useQueryClient();
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/printers', {
      branchId: branchId ?? undefined,
      key: form.key.trim(),
      name: form.name.trim(),
      kind: form.kind,
      connection: form.connection,
      host: form.connection === 'NETWORK' ? form.host.trim() : undefined,
      port: form.connection === 'NETWORK' ? Number(form.port) : undefined,
      devicePath: form.connection === 'USB' || form.connection === 'BLUETOOTH' ? form.devicePath.trim() : undefined,
      stationKey: form.kind === 'KITCHEN' && form.stationKey.trim() ? form.stationKey.trim().toUpperCase() : undefined,
      charsPerLine: Number(form.charsPerLine),
    }),
    onSuccess: () => {
      toast.success('Printer added');
      qc.invalidateQueries({ queryKey: ['rest-printers'] });
      setOpen(false);
      setForm({ key: '', name: '', kind: 'RECEIPT', connection: 'NETWORK', host: '', port: '9100', devicePath: '', stationKey: '', charsPerLine: '42' });
    },
    onError: (e) => toast.error('Could not add the printer', { description: err(e) }),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" className="h-7"><Plus className="size-3.5" /></Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a printer</DialogTitle>
          <DialogDescription>The print agent finds this device by its key.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="pk">Key</Label><Input id="pk" required placeholder="till-1" value={form.key} onChange={(e) => set('key')(e.target.value)} /></div>
            <div><Label htmlFor="pn">Name</Label><Input id="pn" required placeholder="Front till" value={form.name} onChange={(e) => set('name')(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kind</Label>
              <Select value={form.kind} onValueChange={set('kind')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRINTER_KINDS.map((k) => <SelectItem key={k} value={k}>{k.toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Connection</Label>
              <Select value={form.connection} onValueChange={set('connection')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRINTER_CONNECTIONS.map((k) => <SelectItem key={k} value={k}>{k.toLowerCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {form.connection === 'NETWORK' ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Label htmlFor="ph">Host / IP</Label><Input id="ph" required placeholder="192.168.1.50" value={form.host} onChange={(e) => set('host')(e.target.value)} /></div>
              <div><Label htmlFor="pp">Port</Label><Input id="pp" value={form.port} onChange={(e) => set('port')(e.target.value)} /></div>
            </div>
          ) : form.connection === 'USB' || form.connection === 'BLUETOOTH' ? (
            <div><Label htmlFor="pd">Device path</Label><Input id="pd" required placeholder="/dev/usb/lp0" value={form.devicePath} onChange={(e) => set('devicePath')(e.target.value)} /></div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            {form.kind === 'KITCHEN' ? (
              <div><Label htmlFor="ps">Station key</Label><Input id="ps" placeholder="HOT_KITCHEN" value={form.stationKey} onChange={(e) => set('stationKey')(e.target.value)} /></div>
            ) : null}
            <div>
              <Label>Paper width</Label>
              <Select value={form.charsPerLine} onValueChange={set('charsPerLine')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="32">58 mm (32 cols)</SelectItem>
                  <SelectItem value="42">80 mm (42 cols)</SelectItem>
                  <SelectItem value="48">80 mm wide (48 cols)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Add printer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The monospace slip exactly as the thermal head will lay it out. */
function Slip({ text }: { text: string }) {
  return (
    <pre id="rest-receipt" className="max-h-[60vh] overflow-auto whitespace-pre rounded-lg border bg-background p-4 font-mono text-[11px] leading-tight">
      {text}
    </pre>
  );
}

// ── Receipt preview / print ─────────────────────────────────────────────────────
export function ReceiptDialog({ orderId, orderNo, settled }: { orderId: string; orderNo: string; settled: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const doc = useQuery({
    queryKey: ['rest-receipt', orderId],
    queryFn: () => apiGet<RenderedDoc>(`/restaurant/orders/${orderId}/receipt`),
    enabled: open,
  });

  const send = useMutation({
    mutationFn: (reprint: boolean) => apiPost(`/restaurant/orders/${orderId}/print`, { reprint }),
    onSuccess: () => {
      toast.success('Sent to the till printer');
      qc.invalidateQueries({ queryKey: ['rest-print-jobs'] });
      qc.invalidateQueries({ queryKey: ['rest-printers'] });
    },
    onError: (e) => toast.error('Could not queue the bill', { description: err(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Printer className="mr-1.5 size-3.5" /> Bill</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{settled ? 'Receipt' : 'Pro-forma bill'} — {orderNo}</DialogTitle>
          <DialogDescription>
            {settled ? 'Send it to the thermal printer, or print from the browser.' : 'Not settled yet — this prints as a pro-forma, not a tax invoice.'}
          </DialogDescription>
        </DialogHeader>
        {doc.isLoading ? <Spinner /> : doc.data ? <Slip text={doc.data.text} /> : <Hint>Could not render this bill.</Hint>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => window.print()}>Browser print</Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={send.isPending} onClick={() => send.mutate(true)}>Reprint</Button>
            <Button disabled={send.isPending} onClick={() => send.mutate(false)}>
              {send.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Printer className="mr-2 size-4" />}Send to printer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Preview any queued job's paper (also used to check what a failed job would have printed). */
function JobPreviewDialog({ job }: { job: PrintJob }) {
  const [open, setOpen] = useState(false);
  const doc = useQuery({
    queryKey: ['rest-print-job', job.id],
    queryFn: () => apiGet<RenderedDoc>(`/restaurant/print-jobs/${job.id}`),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" title="Preview" className="text-muted-foreground hover:text-foreground"><Barcode className="size-3.5" /></button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{job.kind} {job.docNo ?? ''}</DialogTitle>
          <DialogDescription>Exactly what this job puts on paper.</DialogDescription>
        </DialogHeader>
        {doc.isLoading ? <Spinner /> : doc.data ? <Slip text={doc.data.text} /> : <Hint>Could not render this job.</Hint>}
      </DialogContent>
    </Dialog>
  );
}

/** Reprint one station ticket — the paper-jam button on a KDS card. */
export function ReprintKotButton({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => apiPost(`/restaurant/kds/tickets/${ticketId}/print`, { reprint: true }),
    onSuccess: () => { toast.success('KOT reprinted'); qc.invalidateQueries({ queryKey: ['rest-print-jobs'] }); },
    onError: (e) => toast.error('Could not reprint', { description: err(e) }),
  });
  return (
    <button type="button" title="Reprint ticket" disabled={send.isPending}
      className="text-muted-foreground transition-colors hover:text-foreground"
      onClick={(e) => { e.stopPropagation(); send.mutate(); }}>
      <Printer className="size-3.5" />
    </button>
  );
}

// ── Scanning ────────────────────────────────────────────────────────────────────
/**
 * Scan-to-add for the POS cart. Deliberately a plain text input: every USB/Bluetooth barcode scanner
 * in a restaurant is a keyboard wedge that types the code and presses Enter, so this works with real
 * hardware without any driver, and remains typeable when the scanner dies mid-service.
 */
export function ScanToAdd({ orderId, disabled }: { orderId: string | null; disabled?: boolean }) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const add = useMutation({
    mutationFn: (scanned: string) => apiPost<{ added: { name: string } }>(`/restaurant/orders/${orderId}/scan-add`, { code: scanned, qty: 1 }),
    onSuccess: (res) => {
      toast.success(`Added ${res.added.name}`);
      qc.invalidateQueries({ queryKey: ['rest-pos-order', orderId] });
      setCode('');
      inputRef.current?.focus();
    },
    onError: (e) => {
      toast.error('Nothing matched that code', { description: err(e) });
      setCode('');
      inputRef.current?.focus();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = code.trim();
    if (v && orderId) add.mutate(v);
  };

  return (
    <form onSubmit={submit} className="relative">
      <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={code}
        disabled={disabled || !orderId || add.isPending}
        onChange={(e) => setCode(e.target.value)}
        placeholder={orderId ? 'Scan a barcode to add…' : 'Start an order to scan'}
        className="pl-9"
        aria-label="Scan a product barcode"
      />
    </form>
  );
}

interface ScanResult {
  kind: string; code: string;
  table?: { id: string; code: string; status: string; area: string | null };
  openOrder?: { id: string; orderNo: string; status: string } | null;
  order?: { id: string; orderNo: string; status: string; channel: string; table: string | null };
  ticket?: { id: string; ticketNo: string; stationKey: string; status: string; orderNo: string };
  reservation?: { id: string; reservationNo: string; status: string; guestName: string | null; partySize: number };
  delivery?: { id: string; deliveryNo: string; status: string; driverName: string | null };
  item?: { id: string; name: string; barcode: string | null };
  product?: { id: string; name: string; sku: string | null; onHand: number };
}

/**
 * The universal scanner: one field that resolves a table sticker, a bill, a kitchen ticket, a
 * booking code, a delivery run, a menu barcode or an ingredient carton, and says what it found.
 */
export function ScanBox({ branchId, onOrder }: { branchId?: string | null; onOrder?: (orderId: string) => void }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const scan = useMutation({
    mutationFn: (scanned: string) => apiPost<ScanResult>('/restaurant/scan', { code: scanned, branchId: branchId ?? undefined }),
    onSuccess: (r) => { setResult(r); setCode(''); inputRef.current?.focus(); },
    onError: (e) => { setResult(null); toast.error('Nothing matched that code', { description: err(e) }); setCode(''); inputRef.current?.focus(); },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); const v = code.trim(); if (v) scan.mutate(v); };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} className="pl-9"
          placeholder="Scan or type any code — table QR, bill, ticket, booking, barcode…" aria-label="Scan any code" />
      </form>
      {scan.isPending ? <Spinner /> : result ? (
        <div className="rounded-lg border p-3 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{result.kind.replace(/_/g, ' ').toLowerCase()}</div>
          {result.table ? (
            <div>
              <p className="font-semibold">Table {result.table.code}{result.table.area ? ` · ${result.table.area}` : ''} — {result.table.status.toLowerCase()}</p>
              {result.openOrder ? (
                <Button size="sm" className="mt-2" onClick={() => onOrder?.(result.openOrder!.id)}>
                  Open {result.openOrder.orderNo}
                </Button>
              ) : <p className="text-muted-foreground">No open tab on this table.</p>}
            </div>
          ) : null}
          {result.order ? (
            <div>
              <p className="font-semibold">{result.order.orderNo} — {result.order.status.toLowerCase()}</p>
              <Button size="sm" className="mt-2" onClick={() => onOrder?.(result.order!.id)}>Open order</Button>
            </div>
          ) : null}
          {result.ticket ? <p className="font-semibold">{result.ticket.ticketNo} · {result.ticket.stationKey} — {result.ticket.status.toLowerCase()} (order {result.ticket.orderNo})</p> : null}
          {result.reservation ? <p className="font-semibold">{result.reservation.reservationNo} · {result.reservation.guestName ?? 'Guest'} · party of {result.reservation.partySize} — {result.reservation.status.toLowerCase()}</p> : null}
          {result.delivery ? <p className="font-semibold">{result.delivery.deliveryNo} — {result.delivery.status.toLowerCase()}{result.delivery.driverName ? ` · ${result.delivery.driverName}` : ''}</p> : null}
          {result.item ? <p className="font-semibold">{result.item.name}{result.item.barcode ? ` · ${result.item.barcode}` : ''}</p> : null}
          {result.product ? <p className="font-semibold">{result.product.name} · {result.product.onHand} in stock</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The QR sticker payload for a table, with a rotate button when a sticker has been compromised. */
export function TableQrPanel({ tableId, tableCode }: { tableId: string; tableCode: string }) {
  const qc = useQueryClient();
  const qr = useQuery({
    queryKey: ['rest-table-qr', tableId],
    queryFn: () => apiGet<{ token: string; payload: string }>(`/restaurant/tables/${tableId}/qr`),
  });
  const download = useCodeDownload();
  const label = useMutation({
    mutationFn: () => apiPost(`/restaurant/tables/${tableId}/qr/print`, { caption: 'Scan to view the menu & open your tab' }),
    onSuccess: () => toast.success('QR label queued'),
    onError: (e) => toast.error('Could not queue the label', { description: err(e) }),
  });
  const rotate = useMutation({
    mutationFn: () => apiPost(`/restaurant/tables/${tableId}/qr/rotate`, {}),
    onSuccess: () => { toast.success('QR rotated — reprint the sticker'); qc.invalidateQueries({ queryKey: ['rest-table-qr', tableId] }); },
    onError: (e) => toast.error('Could not rotate', { description: err(e) }),
  });
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex items-center gap-2">
        <Barcode className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Table {tableCode} QR</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={rotate.isPending} onClick={() => rotate.mutate()}>Rotate</Button>
      </div>
      {qr.isLoading ? <Spinner /> : qr.data ? (
        <div className="flex items-start gap-3">
          <CodeImage value={qr.data.payload} kind="qr" size={200} className="size-24 shrink-0 bg-white p-1" />
          <div className="min-w-0 flex-1">
            <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{qr.data.payload}</code>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => download(qr.data!.payload, 'qr', 'png')}>
                <Download className="mr-1.5 size-3.5" /> PNG
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(qr.data!.payload, 'qr', 'svg')}>
                <Download className="mr-1.5 size-3.5" /> SVG
              </Button>
              <Button size="sm" variant="outline" disabled={label.isPending}
                onClick={() => label.mutate()}>
                <Printer className="mr-1.5 size-3.5" /> Print label
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">Stick this on the table; scanning it opens the table&apos;s tab.</p>
    </div>
  );
}

// ── Code generation (images, downloads, labels) ─────────────────────────────────

/** Authenticated QR/barcode image straight from the API — always in sync with what prints. */
export function CodeImage({ value, kind = 'qr', className, size = 180 }: {
  value: string; kind?: 'qr' | 'barcode'; className?: string; size?: number;
}) {
  const path = kind === 'qr'
    ? `/restaurant/codes/qr?value=${encodeURIComponent(value)}&size=${size}`
    : `/restaurant/codes/barcode?value=${encodeURIComponent(value)}`;
  return <AuthImage path={path} alt={`${kind} for ${value}`} className={className} />;
}

/** Download the rendered code — SVG for print/design work, PNG for pasting into a document. */
function useCodeDownload() {
  return async (value: string, kind: 'qr' | 'barcode', format: 'svg' | 'png') => {
    const path = kind === 'qr'
      ? `/restaurant/codes/qr?value=${encodeURIComponent(value)}&format=${format}&size=512`
      : `/restaurant/codes/barcode?value=${encodeURIComponent(value)}`;
    try {
      const blob = await apiBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${value.replace(/[^\w.-]+/g, '_')}.${kind === 'barcode' ? 'svg' : format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Could not download the code', { description: err(e) });
    }
  };
}

/** A menu item's barcode: mint one, look at it, print a shelf label. */
export function ItemBarcodePanel({ itemId, itemName, barcode }: { itemId: string; itemName: string; barcode: string | null }) {
  const qc = useQueryClient();
  const download = useCodeDownload();

  const act = useMutation({
    mutationFn: (v: { run: () => Promise<unknown>; ok: string }) => v.run(),
    onSuccess: (_d, v) => {
      toast.success(v.ok);
      qc.invalidateQueries({ queryKey: ['rest-item'] });
      qc.invalidateQueries({ queryKey: ['rest-items'] });
      qc.invalidateQueries({ queryKey: ['rest-print-jobs'] });
    },
    onError: (e) => toast.error('Action failed', { description: err(e) }),
  });

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Barcode className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Barcode</span>
        {barcode ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{barcode}</code> : <span className="text-xs text-muted-foreground">not set</span>}
      </div>
      {barcode ? (
        <>
          <CodeImage value={barcode} kind="barcode" className="h-16 w-auto max-w-full bg-white p-1" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => download(barcode, 'barcode', 'svg')}>
              <Download className="mr-1.5 size-3.5" /> SVG
            </Button>
            <Button size="sm" variant="outline" disabled={act.isPending}
              onClick={() => act.mutate({ run: () => apiPost(`/restaurant/items/${itemId}/barcode/print`, {}), ok: 'Label queued' })}>
              <Printer className="mr-1.5 size-3.5" /> Print label
            </Button>
            <Button size="sm" variant="ghost" disabled={act.isPending}
              onClick={() => act.mutate({ run: () => apiPost(`/restaurant/items/${itemId}/barcode`, { regenerate: true }), ok: 'New barcode issued' })}>
              Regenerate
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Regenerating invalidates labels already printed.</p>
        </>
      ) : (
        <>
          <Button size="sm" disabled={act.isPending}
            onClick={() => act.mutate({ run: () => apiPost(`/restaurant/items/${itemId}/barcode`, {}), ok: `Barcode issued for ${itemName}` })}>
            {act.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Barcode className="mr-1.5 size-3.5" />} Generate barcode
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Mints an internal EAN-13 (GS1 in-store range 20–29), so it can never clash with a real product.
          </p>
        </>
      )}
    </div>
  );
}

interface QrSheetRow { tableId: string; code: string; area: string | null; payload: string }

/** Every table's QR on one printable page — what you actually stick on the tables. */
export function TableQrSheetDialog({ branchId }: { branchId?: string | null }) {
  const [open, setOpen] = useState(false);
  const sheet = useQuery({
    queryKey: ['rest-qr-sheet', branchId],
    queryFn: () => apiGet<QrSheetRow[]>(branchId ? `/restaurant/tables/qr-sheet?branchId=${branchId}` : '/restaurant/tables/qr-sheet'),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7"><QrCode className="mr-1.5 size-3.5" /> QR sheet</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Table QR stickers</DialogTitle>
          <DialogDescription>Print this page, cut along the cards, and stick one on each table.</DialogDescription>
        </DialogHeader>
        {sheet.isLoading ? <Spinner /> : (
          <div id="rest-qr-sheet" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(sheet.data ?? []).map((t) => (
              <div key={t.tableId} className="flex flex-col items-center gap-1 rounded-lg border bg-white p-3 text-center">
                <span className="text-sm font-bold text-black">Table {t.code}</span>
                {t.area ? <span className="text-[10px] text-neutral-500">{t.area}</span> : null}
                <CodeImage value={t.payload} kind="qr" size={220} className="h-28 w-28" />
                <span className="text-[9px] text-neutral-500">Scan to view the menu</span>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => window.print()}><Printer className="mr-2 size-4" /> Print sheet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bulk-mint barcodes for every dish that lacks one — the practical path after importing a menu, where
 * pressing Generate on each item individually would be absurd. Renders only while something is
 * missing, so the header stays clean once the catalogue is fully coded.
 */
export function GenerateMissingBarcodesButton({ missing }: { missing: number }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => apiPost<{ issued: number }>('/restaurant/items/barcodes/generate-missing', {}),
    onSuccess: (res) => {
      toast.success(
        res.issued === 0 ? 'Every item already has a barcode' : `${res.issued} barcode${res.issued === 1 ? '' : 's'} issued`,
        { description: res.issued > 0 ? 'Internal EAN-13, in the GS1 in-store range.' : undefined },
      );
      qc.invalidateQueries({ queryKey: ['rest-items'] });
      qc.invalidateQueries({ queryKey: ['rest-item'] });
    },
    onError: (e) => toast.error('Could not generate barcodes', { description: err(e) }),
  });

  if (missing <= 0) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 shrink-0"
      disabled={run.isPending}
      title={`Mint an internal EAN-13 for the ${missing} item${missing === 1 ? '' : 's'} without one`}
      onClick={() => run.mutate()}
    >
      {run.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Barcode className="mr-1.5 size-3.5" />}
      {missing} barcode{missing === 1 ? '' : 's'}
    </Button>
  );
}
