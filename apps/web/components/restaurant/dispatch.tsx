'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Bike, CheckCircle2, MapPin, Phone, Plus, UserRound } from 'lucide-react';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { EmptyDetail, ListRow, PaneBody, PaneHeader } from '@/components/ui/three-pane';
import { Hint, Spinner, StatusBadge, fmtDateTime } from '@/components/restaurant/rest-ui';
import type { Money } from '@/lib/types';

// ── Types (mirror the API's driver/customer views) ───────────────────────────────
export interface DriverRow {
  id: string;
  driverCode: string;
  displayName: string;
  phone: string | null;
  branchId: string | null;
  employeeId: string | null;
  userId: string | null;
  hasLogin: boolean;
  vehicleType: string;
  vehiclePlate: string | null;
  dutyStatus: 'OFF_DUTY' | 'AVAILABLE' | 'ON_RUN' | string;
  liveRuns: number;
  maxConcurrentRuns: number;
  deliveredToday: number;
  active: boolean;
  canTakeWork: boolean;
  location: { lat: number; lng: number } | null;
  lastSeenAt: string | null;
  onDutySince: string | null;
  suggested?: boolean;
}

export interface CustomerRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  marketingOptIn: boolean;
  blocked: boolean;
  blockedReason: string | null;
  notes: string | null;
  ordersCount: number;
  lifetimeValue: Money;
  addressCount?: number;
  lastOrderAt: string | null;
  createdAt: string | null;
  addresses?: CustomerAddress[];
}

export interface CustomerAddress {
  id: string;
  label: string;
  address: string;
  location: { lat: number; lng: number } | null;
  directions: string | null;
  isDefault: boolean;
}

export interface CustomerOrderRow {
  id: string;
  orderNo: string;
  channel: string;
  status: string;
  total: Money;
  address: string | null;
  placedAt: string | null;
  delivery: { deliveryNo: string; status: string; etaMinutes: number | null; driver: { name: string; phone: string | null } | null } | null;
}

const VEHICLES = ['BIKE', 'SCOOTER', 'BICYCLE', 'CAR', 'VAN', 'ON_FOOT'] as const;

function useAction(keys: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { run: () => Promise<unknown>; ok: string }) => v.run(),
    onSuccess: (_d, v) => {
      toast.success(v.ok);
      keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error('Action failed', { description: e instanceof ApiError ? e.message : '' }),
  });
}

/** On duty and free / on duty and loaded / off duty — the three states a dispatcher scans for. */
function DutyDot({ driver }: { driver: DriverRow }) {
  const tone = !driver.active || driver.dutyStatus === 'OFF_DUTY'
    ? 'bg-muted-foreground/40'
    : driver.canTakeWork
      ? 'bg-emerald-500'
      : 'bg-amber-500';
  return <span className={`inline-block size-2.5 shrink-0 rounded-full ${tone}`} aria-hidden />;
}

function dutyLabel(d: DriverRow): string {
  if (!d.active) return 'inactive';
  if (d.dutyStatus === 'OFF_DUTY') return 'off duty';
  return d.liveRuns > 0 ? `${d.liveRuns} run${d.liveRuns === 1 ? '' : 's'}` : 'free';
}

// ── Rider roster ─────────────────────────────────────────────────────────────────
export function DriverList({ branchId, sel, onSelect }: { branchId?: string | null; sel: string | null; onSelect: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['rest-drivers', branchId],
    queryFn: () => apiGet<DriverRow[]>(`/restaurant/drivers${branchId ? `?branchId=${branchId}` : ''}`),
    refetchInterval: 10000,
  });
  const rows = q.data ?? [];
  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-medium">Riders</span>
        <NewDriverDialog branchId={branchId} />
      </PaneHeader>
      <PaneBody>
        {q.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Hint>No riders yet. Add one so deliveries can be assigned to a name instead of a UUID.</Hint>
        ) : (
          <ul className="divide-y">
            {rows.map((d) => (
              <ListRow key={d.id} active={sel === d.id} onClick={() => onSelect(d.id)}>
                <DutyDot driver={d} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate font-medium">
                    {d.displayName}
                    {d.suggested ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">next up</span> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {d.driverCode} · {d.vehicleType.toLowerCase()} · {dutyLabel(d)}
                    {d.deliveredToday > 0 ? ` · ${d.deliveredToday} today` : ''}
                  </div>
                </div>
                {/* A rider with no login cannot open the app — worth surfacing before a shift, not during one. */}
                {!d.hasLogin ? <span title="No app login linked" className="text-xs text-amber-600">no login</span> : null}
              </ListRow>
            ))}
          </ul>
        )}
      </PaneBody>
    </>
  );
}

export function DriverDetail({ driverId, onBack }: { driverId: string; onBack: () => void }) {
  const act = useAction(['rest-drivers', 'rest-driver', 'rest-deliveries']);
  const q = useQuery({ queryKey: ['rest-driver', driverId], queryFn: () => apiGet<DriverRow>(`/restaurant/drivers/${driverId}`), refetchInterval: 10000 });
  const d = q.data;
  if (q.isLoading || !d) return q.isLoading ? <PaneBody><Spinner /></PaneBody> : <EmptyDetail icon={Bike} title="Rider" hint="Select a rider." />;
  const setDuty = (dutyStatus: 'AVAILABLE' | 'OFF_DUTY') =>
    act.mutate({ run: () => apiPost(`/restaurant/drivers/${driverId}/duty`, { dutyStatus }), ok: dutyStatus === 'AVAILABLE' ? 'On duty' : 'Off duty' });
  const setActive = (active: boolean) =>
    act.mutate({ run: () => apiPatch(`/restaurant/drivers/${driverId}`, { active }), ok: active ? 'Rider reactivated' : 'Rider deactivated' });

  return (
    <>
      <PaneHeader>
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:underline">← Back</button>
        <span className="flex-1 truncate text-sm font-medium">{d.displayName}</span>
        <StatusBadge status={d.active ? d.dutyStatus : 'INACTIVE'} />
      </PaneHeader>
      <PaneBody className="p-5">
        <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
          <Field label="Code" value={d.driverCode} />
          <Field label="Vehicle" value={`${d.vehicleType.toLowerCase()}${d.vehiclePlate ? ` · ${d.vehiclePlate}` : ''}`} />
          <Field label="Phone" value={d.phone ?? '—'} />
          <Field label="Capacity" value={`${d.liveRuns} of ${d.maxConcurrentRuns} run(s)`} />
          <Field label="Delivered today" value={String(d.deliveredToday)} />
          <Field label="On duty since" value={fmtDateTime(d.onDutySince)} />
          <Field label="Last seen" value={fmtDateTime(d.lastSeenAt)} />
          <Field label="App login" value={d.hasLogin ? 'Linked' : 'Not linked'} />
        </dl>

        {!d.hasLogin ? <LinkLoginPanel driverId={driverId} /> : null}

        {d.location ? (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" /> Last position {d.location.lat.toFixed(5)}, {d.location.lng.toFixed(5)}
          </p>
        ) : null}

        <div className="mt-6 flex max-w-md flex-wrap gap-2 border-t pt-4">
          {d.active && d.dutyStatus === 'OFF_DUTY' ? <Button size="sm" disabled={act.isPending} onClick={() => setDuty('AVAILABLE')}>Start shift</Button> : null}
          {d.active && d.dutyStatus !== 'OFF_DUTY' ? (
            <Button size="sm" variant="outline" disabled={act.isPending || d.liveRuns > 0} onClick={() => setDuty('OFF_DUTY')}
              title={d.liveRuns > 0 ? 'Finish or reassign their live runs first' : undefined}>End shift</Button>
          ) : null}
          {d.active
            ? <Button size="sm" variant="destructive" disabled={act.isPending || d.liveRuns > 0} onClick={() => setActive(false)}>Deactivate</Button>
            : <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setActive(true)}>Reactivate</Button>}
        </div>
      </PaneBody>
    </>
  );
}

/**
 * Link the app login a rider signs in with.
 *
 * A rider is nearly always rostered before IT issues their account, so the roster accepts a rider
 * with no login and shows this until one is set — without it the rider app can only say "this login
 * is not linked to a rider record", and there was nowhere to go and fix that.
 */
function LinkLoginPanel({ driverId }: { driverId: string }) {
  const [userId, setUserId] = useState('');
  const act = useAction(['rest-drivers', 'rest-driver']);
  return (
    <div className="mt-4 max-w-md rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-xs text-amber-800 dark:text-amber-300">
        No login linked, so this rider cannot sign into the rider app. Create a user with the
        <strong> Delivery Rider </strong> role under Settings → Users, then paste its id here.
      </p>
      <div className="mt-2 flex gap-2">
        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User id" className="h-9" />
        <Button size="sm" className="h-9" disabled={!userId.trim() || act.isPending}
          onClick={() => act.mutate({ run: () => apiPatch(`/restaurant/drivers/${driverId}`, { userId: userId.trim() }), ok: 'Login linked' })}>Link</Button>
      </div>
    </div>
  );
}

function NewDriverDialog({ branchId }: { branchId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState<string>('BIKE');
  const act = useAction(['rest-drivers']);
  const submit = () => {
    act.mutate(
      { run: () => apiPost('/restaurant/drivers', { driverCode: code.trim(), displayName: name.trim(), phone: phone.trim() || undefined, vehicleType: vehicle, branchId }), ok: `${name.trim()} added` },
      { onSuccess: () => { setOpen(false); setCode(''); setName(''); setPhone(''); } },
    );
  };
  if (!open) return <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Rider</Button>;
  return (
    <div className="absolute inset-x-0 top-full z-10 space-y-2 border-b bg-background p-3 shadow-lg">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rider name" className="h-9" />
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. RID-01)" className="h-9" />
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="h-9" />
      <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
        {VEHICLES.map((v) => <option key={v} value={v}>{v.toLowerCase()}</option>)}
      </select>
      <div className="flex gap-2">
        <Button size="sm" className="h-9 flex-1" disabled={!name.trim() || !code.trim() || act.isPending} onClick={submit}>Add</Button>
        <Button size="sm" variant="outline" className="h-9" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Assign a run by picking a rider off the roster.
 *
 * Replaces a free-text box that asked a human to type an employee UUID — an input nobody could
 * satisfy from memory, and which accepted any 36 characters that looked like one. The list shows who
 * can actually take work right now and why the others cannot, and marks the rider the server would
 * pick. Riders who are off duty or already at capacity are shown but not selectable: hiding them
 * would leave a dispatcher wondering where someone went.
 */
export function AssignPicker({ deliveryId, branchId, onAssigned }: { deliveryId: string; branchId?: string | null; onAssigned?: () => void }) {
  const act = useAction(['rest-deliveries', 'rest-drivers']);
  const q = useQuery({
    queryKey: ['rest-drivers', branchId],
    queryFn: () => apiGet<DriverRow[]>(`/restaurant/drivers${branchId ? `?branchId=${branchId}` : ''}`),
    refetchInterval: 10000,
  });
  const riders = (q.data ?? []).filter((d) => d.active);
  const assign = (driverId: string, name: string) =>
    act.mutate({ run: () => apiPost(`/restaurant/deliveries/${deliveryId}/assign`, { driverId }), ok: `Assigned to ${name}` }, { onSuccess: () => onAssigned?.() });

  if (q.isLoading) return <Spinner />;
  if (riders.length === 0) {
    return <Hint>No riders on the roster yet. Add one under <strong>Riders</strong> before dispatching.</Hint>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {riders.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <DutyDot driver={d} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{d.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">{d.vehicleType.toLowerCase()} · {dutyLabel(d)}</div>
          </div>
          {d.suggested ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">next up</span> : null}
          <Button size="sm" variant={d.suggested ? 'default' : 'outline'} className="h-8" disabled={!d.canTakeWork || act.isPending}
            title={d.canTakeWork ? undefined : d.dutyStatus === 'OFF_DUTY' ? 'Off duty' : 'At capacity'}
            onClick={() => assign(d.id, d.displayName)}>Assign</Button>
        </li>
      ))}
    </ul>
  );
}

// ── Customers ────────────────────────────────────────────────────────────────────
export function CustomerList({ sel, onSelect, search, }: { sel: string | null; onSelect: (id: string) => void; search: string }) {
  const q = useQuery({
    queryKey: ['rest-customers', search],
    queryFn: () => apiGet<CustomerRow[]>(`/restaurant/customers${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`),
  });
  const rows = q.data ?? [];
  return (
    <>
      <PaneHeader><span className="flex-1 text-sm font-medium">Customers</span></PaneHeader>
      <PaneBody>
        {q.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Hint>{search.trim() ? 'No customer matches that name or number.' : 'No customers yet. They appear here the first time someone signs in on the customer app or a counter takes a phone order.'}</Hint>
        ) : (
          <ul className="divide-y">
            {rows.map((c) => (
              <ListRow key={c.id} active={sel === c.id} onClick={() => onSelect(c.id)}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate font-medium">
                    {c.name ?? c.phone}
                    {c.blocked ? <Ban className="size-3.5 text-rose-600" /> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.phone} · {c.ordersCount} order{c.ordersCount === 1 ? '' : 's'}
                    {c.ordersCount > 0 ? ` · ${formatMoney(c.lifetimeValue.amountMinor, c.lifetimeValue.currency)}` : ''}
                  </div>
                </div>
              </ListRow>
            ))}
          </ul>
        )}
      </PaneBody>
    </>
  );
}

export function CustomerDetail({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const act = useAction(['rest-customers', 'rest-customer']);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['rest-customer', customerId], queryFn: () => apiGet<CustomerRow>(`/restaurant/customers/${customerId}`) });
  const orders = useQuery({ queryKey: ['rest-customer-orders', customerId], queryFn: () => apiGet<CustomerOrderRow[]>(`/restaurant/customers/${customerId}/orders`) });
  const c = q.data;
  if (q.isLoading || !c) return q.isLoading ? <PaneBody><Spinner /></PaneBody> : <EmptyDetail icon={UserRound} title="Customer" hint="Select a customer." />;
  const setBlocked = (blocked: boolean) =>
    act.mutate({ run: () => apiPost(`/restaurant/customers/${customerId}/block`, { blocked, reason: blocked ? reason.trim() || undefined : undefined }), ok: blocked ? 'Customer blocked' : 'Customer unblocked' });

  return (
    <>
      <PaneHeader>
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:underline">← Back</button>
        <span className="flex-1 truncate text-sm font-medium">{c.name ?? c.phone}</span>
        {c.blocked ? <StatusBadge status="BLOCKED" /> : null}
      </PaneHeader>
      <PaneBody className="p-5">
        <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
          <Field label="Phone" value={c.phone} />
          <Field label="Name" value={c.name ?? '—'} />
          <Field label="Email" value={c.email ?? '—'} />
          <Field label="Orders" value={String(c.ordersCount)} />
          <Field label="Lifetime spend" value={formatMoney(c.lifetimeValue.amountMinor, c.lifetimeValue.currency)} />
          <Field label="Last order" value={fmtDateTime(c.lastOrderAt)} />
        </dl>

        <h3 className="mb-2 mt-6 text-sm font-semibold">Addresses</h3>
        {(c.addresses ?? []).length === 0 ? <Hint>No saved addresses.</Hint> : (
          <ul className="max-w-md space-y-2">
            {(c.addresses ?? []).map((a) => (
              <li key={a.id} className="rounded-lg border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{a.label}</span>
                  {a.isDefault ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-label="Default address" /> : null}
                </div>
                <div>{a.address}</div>
                {a.directions ? <div className="mt-0.5 text-xs italic text-muted-foreground">{a.directions}</div> : null}
              </li>
            ))}
          </ul>
        )}

        <h3 className="mb-2 mt-6 text-sm font-semibold">Order history</h3>
        {orders.isLoading ? <Spinner /> : (orders.data ?? []).length === 0 ? <Hint>No orders yet.</Hint> : (
          <ul className="max-w-md divide-y rounded-lg border">
            {(orders.data ?? []).map((o) => (
              <li key={o.id} className="px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{o.orderNo}</span>
                  <StatusBadge status={o.status} />
                  <span className="ml-auto tabular-nums">{formatMoney(o.total.amountMinor, o.total.currency)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.channel.replace(/_/g, ' ').toLowerCase()} · {fmtDateTime(o.placedAt)}
                  {o.delivery ? ` · ${o.delivery.deliveryNo} ${o.delivery.status.toLowerCase()}` : ''}
                  {o.delivery?.driver ? ` · ${o.delivery.driver.name}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 max-w-md border-t pt-4">
          {c.blocked ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Blocked{c.blockedReason ? `: ${c.blockedReason}` : ''}. They can still sign in and see their history, but cannot place orders.</p>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setBlocked(false)}>Unblock</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to them)" className="h-9" />
              <Button size="sm" variant="destructive" className="h-9" disabled={act.isPending} onClick={() => setBlocked(true)}><Ban className="size-3.5" /> Block</Button>
            </div>
          )}
        </div>
      </PaneBody>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

export { Phone as PhoneIcon };
