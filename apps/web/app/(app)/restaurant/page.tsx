'use client';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode, Bike, Building2, CalendarClock, Check, ChefHat, ClipboardList, LayoutGrid, ListPlus, Move, Printer, Receipt, ScanLine,
  Search, Settings2, SlidersHorizontal, Timer, Trash2, UtensilsCrossed, Users,
} from 'lucide-react';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { EmptyDetail, ListRow, Pane, PaneBody, PaneHeader, RailItem, ThreePane } from '@/components/ui/three-pane';
import {
  type Branch, type DeliveryRow, type FloorArea, type InventoryProduct, type ItemDetail, type KdsTicket,
  type MenuCategory, type MenuItem, type ModifierGroup, type ModifierGroupDetail, type OrderDetail,
  type OrderRow, type Recipe, type ReservationRow, type RestaurantConfig, type RestTable,
  FoodThumb, Hint, LiveDot, Spinner, StatusBadge, fmtDateTime, imageSrc, mmss,
} from '@/components/restaurant/rest-ui';
import {
  AttachGroupControl, CheckinDialog, EditItemDialog, NewAreaDialog, NewCategoryDialog, NewMenuItemDialog,
  NewModifierDialog, NewModifierGroupDialog, NewReservationDialog, NewTableDialog,
} from '@/components/restaurant/rest-dialogs';
import { PosCart, PosMenu } from '@/components/restaurant/pos';
import { BarcodeSheetDialog } from '@/components/codes/barcode-sheet';
import {
  type Printer as PrinterRow, GenerateMissingBarcodesButton, ItemBarcodePanel, PrinterDetail, PrinterList,
  ReceiptDialog, ReprintKotButton, ScanBox, TableQrPanel, TableQrSheetDialog,
} from '@/components/restaurant/printing';
import { RecipeCard } from '@/components/restaurant/recipe';

type Section = 'dashboard' | 'pos' | 'scan' | 'menu' | 'modifiers' | 'floor' | 'kds' | 'orders' | 'deliveries' | 'reservations' | 'branches' | 'printers';

// Poll operational data on a short interval so the whole workspace reads as live.
const LIVE = 6000;

/** One mutation for every fire-and-forget action button (KDS bump, table status, delivery advance…). */
interface ActionVars { run: () => Promise<unknown>; ok: string; keys: string[] }
function useRestAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ActionVars) => v.run(),
    onSuccess: (_data, v) => {
      toast.success(v.ok);
      v.keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error('Action failed', { description: e instanceof ApiError ? e.message : '' }),
  });
}

export default function RestaurantPage() {
  const [section, setSection] = useState<Section>('dashboard');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [station, setStation] = useState<string | null>(null); // KDS station filter
  const [manageFloor, setManageFloor] = useState(false);
  const [posOrderId, setPosOrderId] = useState<string | null>(null);
  const [menuCat, setMenuCat] = useState<string | null>(null);

  // ── Active branch (multi-outlet): client-selected context threaded into every operational
  // query + create. `null` = "All branches" (tenant-wide aggregate). Persisted per browser;
  // defaults to the head office the first time. Branch is not a security boundary — RLS still
  // scopes everything to the tenant — but it drives which outlet the workspace operates on.
  const [branchId, setBranchIdRaw] = useState<string | null>(null);
  const branchDecided = useRef(false);
  const branches = useQuery({ queryKey: ['rest-branches'], queryFn: () => apiGet<Branch[]>('/restaurant/branches') });
  const printers = useQuery({
    queryKey: ['rest-printers', branchId],
    queryFn: () => apiGet<PrinterRow[]>(branchId ? `/restaurant/printers?branchId=${branchId}` : '/restaurant/printers'),
    enabled: section === 'printers',
    refetchInterval: section === 'printers' ? LIVE : false,
  });
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('rest-branch') : null;
    if (saved !== null) { setBranchIdRaw(saved === 'ALL' ? null : saved); branchDecided.current = true; }
  }, []);
  useEffect(() => {
    if (branchDecided.current) return;
    const list = branches.data ?? [];
    if (list.length > 0) { setBranchIdRaw((list.find((b) => b.isHeadOffice) ?? list[0]).id); branchDecided.current = true; }
  }, [branches.data]);
  const setBranch = (id: string | null) => {
    setBranchIdRaw(id);
    branchDecided.current = true;
    setSel(null);
    setPosOrderId(null); // an open POS cart belongs to the branch it was started in
    if (typeof window !== 'undefined') window.localStorage.setItem('rest-branch', id ?? 'ALL');
  };
  // Append the active branch to an operational path (reads); create/update bodies carry it explicitly.
  const wb = (path: string) => (branchId ? `${path}${path.includes('?') ? '&' : '?'}branchId=${branchId}` : path);

  const items = useQuery({ queryKey: ['rest-items', branchId], queryFn: () => apiGet<MenuItem[]>(wb('/restaurant/items')) });
  const categories = useQuery({ queryKey: ['rest-categories'], queryFn: () => apiGet<MenuCategory[]>('/restaurant/categories'), enabled: section === 'menu' });
  const modGroups = useQuery({ queryKey: ['rest-modgroups'], queryFn: () => apiGet<ModifierGroup[]>('/restaurant/modifier-groups'), enabled: section === 'menu' || section === 'modifiers' });
  const itemDetail = useQuery({ queryKey: ['rest-item', sel, branchId], queryFn: () => apiGet<ItemDetail>(wb(`/restaurant/items/${sel}`)), enabled: section === 'menu' && !!sel });
  const products = useQuery({ queryKey: ['rest-inv-products'], queryFn: () => apiGet<InventoryProduct[]>('/inventory/products'), enabled: section === 'menu' });
  const recipe = useQuery({ queryKey: ['rest-recipe', sel], queryFn: () => apiGet<Recipe>(`/restaurant/items/${sel}/recipe`), enabled: section === 'menu' && !!sel, retry: false });
  const groupDetail = useQuery({ queryKey: ['rest-modgroup', sel], queryFn: () => apiGet<ModifierGroupDetail>(`/restaurant/modifier-groups/${sel}`), enabled: section === 'modifiers' && !!sel });
  const posOrder = useQuery({
    queryKey: ['rest-pos-order', posOrderId],
    queryFn: () => apiGet<OrderDetail>(`/restaurant/orders/${posOrderId}`),
    enabled: !!posOrderId,
    refetchInterval: LIVE,
  });
  const areas = useQuery({ queryKey: ['rest-areas', branchId], queryFn: () => apiGet<FloorArea[]>(wb('/restaurant/areas')), enabled: section === 'floor' });
  const tables = useQuery({ queryKey: ['rest-tables', branchId], queryFn: () => apiGet<RestTable[]>(wb('/restaurant/tables')), refetchInterval: LIVE });
  const kds = useQuery({ queryKey: ['rest-kds', branchId], queryFn: () => apiGet<KdsTicket[]>(wb('/restaurant/kds/board')), refetchInterval: LIVE });
  const orders = useQuery({ queryKey: ['rest-orders', branchId], queryFn: () => apiGet<OrderRow[]>(wb('/restaurant/orders')), refetchInterval: LIVE });
  const deliveries = useQuery({ queryKey: ['rest-deliveries', branchId], queryFn: () => apiGet<DeliveryRow[]>(wb('/restaurant/deliveries')), refetchInterval: LIVE });
  const reservations = useQuery({ queryKey: ['rest-reservations', branchId], queryFn: () => apiGet<ReservationRow[]>(wb('/restaurant/reservations')), refetchInterval: LIVE });

  const pick = (s: Section) => { setSection(s); setSel(null); setQ(''); setStation(null); setMenuCat(null); };
  const clear = () => setSel(null);

  const itemList = useMemo(
    () => (items.data ?? []).filter((i) =>
      (!q || [i.name, i.sku, i.category].some((x) => x?.toLowerCase().includes(q.toLowerCase()))) &&
      (!menuCat || i.categoryId === menuCat)),
    [items.data, q, menuCat],
  );

  const openOrders = (orders.data ?? []).filter((o) => !['CLOSED', 'VOID', 'SETTLED'].includes(o.status));
  const activeDeliveries = (deliveries.data ?? []).filter((d) => ['PENDING', 'ASSIGNED', 'PICKED_UP', 'EN_ROUTE'].includes(d.status));
  const upcomingReservations = (reservations.data ?? []).filter((r) => ['BOOKED', 'CONFIRMED', 'WAITLIST'].includes(r.status));
  const occupiedTables = (tables.data ?? []).filter((t) => t.status === 'OCCUPIED').length;
  const liveTickets = (kds.data ?? []).length;

  const wideSection = section === 'dashboard' || section === 'kds' || section === 'floor' || section === 'pos';
  const showDetail = wideSection || !!sel;

  const rail = (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      <RailItem icon={LayoutGrid} label="Dashboard" active={section === 'dashboard'} onClick={() => pick('dashboard')} tone="violet" />
      <RailItem icon={ScanLine} label="Take order (POS)" active={section === 'pos'} onClick={() => pick('pos')} tone="emerald" />
      <RailItem icon={Barcode} label="Scan" active={section === 'scan'} onClick={() => pick('scan')} tone="violet" />
      <div className="my-1 border-t" />
      <RailItem icon={UtensilsCrossed} label="Menu" count={items.data?.length} active={section === 'menu'} onClick={() => pick('menu')} />
      <RailItem icon={SlidersHorizontal} label="Modifiers" active={section === 'modifiers'} onClick={() => pick('modifiers')} />
      <RailItem icon={LayoutGrid} label="Floor" count={tables.data?.length} active={section === 'floor'} onClick={() => pick('floor')} tone="sky" />
      <RailItem icon={ChefHat} label="Kitchen (KDS)" count={liveTickets} active={section === 'kds'} onClick={() => pick('kds')} tone="amber" />
      <div className="my-1 border-t" />
      <RailItem icon={Receipt} label="Orders" count={openOrders.length} active={section === 'orders'} onClick={() => pick('orders')} tone="emerald" />
      <RailItem icon={Bike} label="Deliveries" count={activeDeliveries.length} active={section === 'deliveries'} onClick={() => pick('deliveries')} tone="sky" />
      <RailItem icon={CalendarClock} label="Reservations" count={upcomingReservations.length} active={section === 'reservations'} onClick={() => pick('reservations')} tone="rose" />
      <div className="my-1 border-t" />
      <RailItem icon={Building2} label="Branches" count={branches.data?.length} active={section === 'branches'} onClick={() => pick('branches')} tone="violet" />
      <RailItem icon={Printer} label="Printers" count={printers.data?.length} active={section === 'printers'} onClick={() => pick('printers')} />
    </div>
  );

  const list = (
    <Pane>
      {section === 'printers' ? (
        <PrinterList printers={printers.data ?? []} loading={printers.isLoading} sel={sel} onSelect={setSel} branchId={branchId} />
      ) : section === 'scan' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Scanner</span></PaneHeader>
          <PaneBody className="p-4">
            <ScanBox branchId={branchId} onOrder={(id) => { setPosOrderId(id); setSection('pos'); }} />
          </PaneBody>
        </>
      ) : section === 'pos' ? (
        <PosCart order={posOrder.data} orderId={posOrderId} setOrderId={setPosOrderId} tables={tables.data ?? []} loading={posOrder.isLoading} branchId={branchId} />
      ) : section === 'branches' ? (
        <BranchList branches={branches.data ?? []} loading={branches.isLoading} sel={sel} onPick={setSel} activeId={branchId} />
      ) : section === 'modifiers' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Modifier groups</span><NewModifierGroupDialog /></PaneHeader>
          <PaneBody>
            {modGroups.isLoading ? <Spinner /> : (modGroups.data ?? []).length === 0 ? <Hint>No modifier groups yet. Add one to offer options like spice level or add-ons.</Hint> : (
              <ul className="divide-y">{(modGroups.data ?? []).map((g) => (
                <li key={g.id}><ListRow active={sel === g.id} onClick={() => setSel(g.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{g.name}</div><div className="truncate text-xs text-muted-foreground">{g.required ? 'required · ' : ''}pick {g.minSelect}–{g.maxSelect ?? '∞'} · {g.modifierCount} option{g.modifierCount === 1 ? '' : 's'}</div></div>
                  {g.required ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">required</span> : null}
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'menu' ? (
        <>
          <PaneHeader>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu…" className="h-9 w-full pl-9" /></div>
            <GenerateMissingBarcodesButton missing={(items.data ?? []).filter((i) => !i.barcode).length} />
            <BarcodeSheetDialog
              rows={itemList.map((i) => ({
                id: i.id, code: i.barcode, name: i.name, sub: i.sku,
                price: formatMoney(i.effectivePrice.amountMinor, i.effectivePrice.currency),
              }))}
              title="Print menu barcodes"
              triggerLabel="Print"
              emptyHint="No item here has a barcode yet — use the generate button first."
            />
            <NewCategoryDialog />
            <NewMenuItemDialog />
          </PaneHeader>
          {(categories.data?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
              <button type="button" onClick={() => setMenuCat(null)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${!menuCat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All</button>
              {(categories.data ?? []).map((c) => <button key={c.id} type="button" onClick={() => setMenuCat(c.id)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${menuCat === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{c.name}</button>)}
            </div>
          ) : null}
          <PaneBody>
            {items.isLoading ? <Spinner /> : itemList.length === 0 ? <Hint>No menu items here.</Hint> : (
              <ul className="divide-y">{itemList.map((i) => (
                <li key={i.id}><ListRow active={sel === i.id} onClick={() => setSel(i.id)}>
                  <FoodThumb src={imageSrc(i.imageKey)} name={i.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate font-medium">{i.name}</span>{i.isCombo ? <span className="rounded bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">COMBO</span> : null}</div>
                    <div className="truncate text-xs text-muted-foreground">{i.category ?? 'Uncategorised'}{i.stationKey ? ` · ${i.stationKey}` : ''} · {i.prepMinutes}m</div>
                  </div>
                  <div className="text-right text-xs"><div className="font-semibold tabular-nums">{formatMoney(i.effectivePrice.amountMinor, i.effectivePrice.currency)}</div><div className={i.available ? 'text-emerald-600' : 'text-rose-600'}>{i.available ? 'available' : 'off'}</div></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'orders' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Orders</span><LiveDot /></PaneHeader>
          <PaneBody>
            {orders.isLoading ? <Spinner /> : (orders.data ?? []).length === 0 ? <Hint>No orders yet.</Hint> : (
              <ul className="divide-y">{(orders.data ?? []).map((o) => (
                <li key={o.id}><ListRow active={sel === o.id} onClick={() => setSel(o.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{o.orderNo}</div><div className="truncate text-xs text-muted-foreground">{o.channel.replace(/_/g, ' ').toLowerCase()}{o.table ? ` · ${o.table}` : ''} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}</div></div>
                  <div className="flex flex-col items-end gap-1"><span className="text-sm font-semibold tabular-nums">{formatMoney(o.total.amountMinor, o.total.currency)}</span><StatusBadge status={o.status} /></div>
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'deliveries' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Deliveries</span><LiveDot /></PaneHeader>
          <PaneBody>
            {deliveries.isLoading ? <Spinner /> : (deliveries.data ?? []).length === 0 ? <Hint>No deliveries yet.</Hint> : (
              <ul className="divide-y">{(deliveries.data ?? []).map((d) => (
                <li key={d.id}><ListRow active={sel === d.id} onClick={() => setSel(d.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.deliveryNo}</div><div className="truncate text-xs text-muted-foreground">{d.provider} · {d.orderNo}{d.etaMinutes != null ? ` · ETA ${d.etaMinutes}m` : ''}</div></div>
                  <StatusBadge status={d.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'reservations' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Reservations</span><CheckinDialog /><NewReservationDialog branchId={branchId} /></PaneHeader>
          <PaneBody>
            {reservations.isLoading ? <Spinner /> : (reservations.data ?? []).length === 0 ? <Hint>No reservations yet.</Hint> : (
              <ul className="divide-y">{(reservations.data ?? []).map((r) => (
                <li key={r.id}><ListRow active={sel === r.id} onClick={() => setSel(r.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.guestName ?? r.reservationNo}</div><div className="truncate text-xs text-muted-foreground">party {r.partySize}{r.table ? ` · ${r.table}` : ''} · {fmtDateTime(r.reservedFor)}</div></div>
                  <StatusBadge status={r.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : section === 'kds' ? (
        <KdsStationList tickets={kds.data ?? []} loading={kds.isLoading} station={station} onPick={setStation} />
      ) : section === 'floor' ? (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Tables</span><LiveDot label="live" /></PaneHeader>
          <PaneBody>
            {tables.isLoading ? <Spinner /> : (
              <ul className="divide-y">{(tables.data ?? []).map((t) => (
                <li key={t.id}><ListRow active={sel === t.id} onClick={() => setSel(t.id)}>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{t.code}</div><div className="truncate text-xs text-muted-foreground">{t.area ?? 'Unzoned'} · seats {t.capacity}</div></div>
                  <StatusBadge status={t.status} />
                </ListRow></li>
              ))}</ul>
            )}
          </PaneBody>
        </>
      ) : (
        <>
          <PaneHeader><span className="flex-1 text-sm font-medium">Live service</span><LiveDot /></PaneHeader>
          <PaneBody className="p-2">
            <p className="px-3 py-6 text-sm text-muted-foreground">Realtime snapshot of covers, kitchen load, deliveries and bookings — refreshing every few seconds.</p>
          </PaneBody>
        </>
      )}
    </Pane>
  );

  const posSettled = ['SETTLED', 'CLOSED', 'VOID'].includes(posOrder.data?.status ?? '');
  const detail = (
    <Pane>
      {section === 'printers' ? <PrinterDetail printer={(printers.data ?? []).find((p) => p.id === sel)} />
        : section === 'scan' ? <EmptyDetail icon={Barcode} title="Scan anything" hint="A table sticker opens its tab, a bill or kitchen ticket pulls up the order, a booking code checks the guest in, a product barcode finds the dish." />
        : section === 'pos' ? <PosMenu items={items.data ?? []} orderId={posOrderId} canAdd={!!posOrderId && !posSettled} loading={items.isLoading} />
        : section === 'dashboard' ? <Dashboard openOrders={openOrders} occupiedTables={occupiedTables} totalTables={tables.data?.length ?? 0} liveTickets={liveTickets} activeDeliveries={activeDeliveries.length} upcomingReservations={upcomingReservations.length} orders={orders.data ?? []} />
        : section === 'kds' ? <KdsBoard tickets={kds.data ?? []} loading={kds.isLoading} station={station} />
        : section === 'floor' ? <FloorMap tables={tables.data ?? []} areas={areas.data ?? []} loading={tables.isLoading} sel={sel} onSelect={setSel} manage={manageFloor} onToggleManage={() => setManageFloor((v) => !v)} branchId={branchId} />
        : section === 'branches' ? (sel ? <BranchAdmin branch={(branches.data ?? []).find((b) => b.id === sel)} onBack={clear} /> : <EmptyDetail icon={Building2} title="Select a branch" hint="Configure an outlet's currency, tax, service charge and default warehouse — or provision a new branch so it can take orders." />)
        : section === 'modifiers' ? (sel ? <ModifierGroupDetailView group={groupDetail.data} loading={groupDetail.isLoading} onBack={clear} /> : <EmptyDetail icon={SlidersHorizontal} title="Select a group" hint="Add options with price deltas (e.g. Extra cheese +1.00), then attach the group to menu items." />)
        : section === 'menu' ? (sel ? <ItemDetail item={itemDetail.data} loading={itemDetail.isLoading} categories={categories.data ?? []} groups={modGroups.data ?? []} products={products.data ?? []} recipe={recipe.data} recipeLoading={recipe.isLoading} onBack={clear} onDeleted={clear} /> : <EmptyDetail icon={UtensilsCrossed} title="Select an item" hint="View the photo, pricing, station routing and prep time." />)
        : section === 'orders' ? (sel ? <OrderDetail order={(orders.data ?? []).find((o) => o.id === sel)} onBack={clear} /> : <EmptyDetail icon={Receipt} title="Select an order" hint="Open a bill to see its channel, table and total." />)
        : section === 'deliveries' ? (sel ? <DeliveryDetail row={(deliveries.data ?? []).find((d) => d.id === sel)} onBack={clear} /> : <EmptyDetail icon={Bike} title="Select a delivery" hint="Track a job from dispatch to doorstep." />)
        : (sel ? <ReservationDetail row={(reservations.data ?? []).find((r) => r.id === sel)} onBack={clear} /> : <EmptyDetail icon={CalendarClock} title="Select a reservation" hint="See the booking, party size and held table." />)}
    </Pane>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><UtensilsCrossed className="h-6 w-6 text-primary" /> Restaurant</h1>
          <p className="text-sm text-muted-foreground">Menu, floor, kitchen display, orders, delivery dispatch and reservations — one live service view.</p>
        </div>
        <BranchSwitcher branches={branches.data ?? []} value={branchId} onChange={setBranch} />
      </div>
      <div className="min-h-0 flex-1"><ThreePane rail={rail} list={list} detail={detail} showDetail={showDetail} /></div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard(props: {
  openOrders: OrderRow[]; occupiedTables: number; totalTables: number; liveTickets: number;
  activeDeliveries: number; upcomingReservations: number; orders: OrderRow[];
}) {
  const openValueMinor = props.openOrders.reduce((s, o) => s + o.total.amountMinor, 0);
  const currency = props.orders[0]?.total.currency ?? 'PKR';
  return (
    <>
      <PaneHeader><span className="flex-1 text-sm font-medium">Live service</span><LiveDot label="auto-refresh" /></PaneHeader>
      <PaneBody className="p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label="Open bills" value={String(props.openOrders.length)} sub={formatMoney(openValueMinor, currency)} icon={Receipt} tone="emerald" />
          <Kpi label="Covers seated" value={`${props.occupiedTables}/${props.totalTables}`} sub="tables occupied" icon={Users} tone="sky" />
          <Kpi label="Kitchen tickets" value={String(props.liveTickets)} sub="in progress" icon={ChefHat} tone="amber" />
          <Kpi label="Deliveries out" value={String(props.activeDeliveries)} sub="active jobs" icon={Bike} tone="sky" />
          <Kpi label="Upcoming bookings" value={String(props.upcomingReservations)} sub="not yet seated" icon={CalendarClock} tone="rose" />
          <Kpi label="Open value" value={formatMoney(openValueMinor, currency)} sub="unsettled" icon={ClipboardList} tone="violet" />
        </div>
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Open orders</h3>
          {props.openOrders.length === 0 ? <p className="text-sm text-muted-foreground">Nothing open — all settled.</p> : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Order</th><th className="px-3 py-2 font-medium">Channel</th><th className="px-3 py-2 font-medium">Table</th><th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2 font-medium">Status</th></tr></thead>
                <tbody className="divide-y">{props.openOrders.slice(0, 12).map((o) => (
                  <tr key={o.id}><td className="px-3 py-2 font-medium">{o.orderNo}</td><td className="px-3 py-2 text-muted-foreground">{o.channel.replace(/_/g, ' ').toLowerCase()}</td><td className="px-3 py-2 text-muted-foreground">{o.table ?? '—'}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(o.total.amountMinor, o.total.currency)}</td><td className="px-3 py-2"><StatusBadge status={o.status} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </PaneBody>
    </>
  );
}

// ── KDS station list (2nd pane) ────────────────────────────────────────────────
function KdsStationList({ tickets, loading, station, onPick }: { tickets: KdsTicket[]; loading: boolean; station: string | null; onPick: (s: string | null) => void }) {
  const stations = useMemo(() => {
    const map = new Map<string, KdsTicket[]>();
    for (const t of tickets) (map.get(t.stationKey) ?? map.set(t.stationKey, []).get(t.stationKey)!).push(t);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tickets]);
  const count = (list: KdsTicket[], s: string) => list.filter((t) => t.status === s).length;
  return (
    <>
      <PaneHeader><span className="flex-1 text-sm font-medium">Stations</span><LiveDot /></PaneHeader>
      <PaneBody className="p-2">
        {loading ? <Spinner /> : stations.length === 0 ? <Hint>No tickets fired. The board is clear.</Hint> : (
          <div className="space-y-1">
            <ListRow active={station === null} onClick={() => onPick(null)}>
              <ChefHat className="h-4 w-4 text-amber-600" />
              <span className="flex-1 font-medium">All stations</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">{tickets.length}</span>
            </ListRow>
            {stations.map(([s, list]) => (
              <ListRow key={s} active={station === s} onClick={() => onPick(s)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.replace(/_/g, ' ')}</div>
                  <div className="mt-0.5 flex gap-1.5 text-[10px]">
                    {count(list, 'QUEUED') > 0 ? <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{count(list, 'QUEUED')} queued</span> : null}
                    {count(list, 'PREPARING') > 0 ? <span className="rounded bg-sky-100 px-1.5 font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">{count(list, 'PREPARING')} cooking</span> : null}
                    {count(list, 'READY') > 0 ? <span className="rounded bg-emerald-100 px-1.5 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{count(list, 'READY')} ready</span> : null}
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">{list.length}</span>
              </ListRow>
            ))}
          </div>
        )}
      </PaneBody>
    </>
  );
}

// ── KDS board ─────────────────────────────────────────────────────────────────
function KdsBoard({ tickets, loading, station }: { tickets: KdsTicket[]; loading: boolean; station: string | null }) {
  const shown = station ? tickets.filter((t) => t.stationKey === station) : tickets;
  const stations = useMemo(() => {
    const map = new Map<string, KdsTicket[]>();
    for (const t of shown) (map.get(t.stationKey) ?? map.set(t.stationKey, []).get(t.stationKey)!).push(t);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);
  return (
    <>
      <PaneHeader>
        <span className="flex-1 text-sm font-medium">Kitchen display{station ? ` · ${station.replace(/_/g, ' ')}` : ''}</span>
        <span className="text-xs text-muted-foreground">{shown.length} live</span>
        <LiveDot />
      </PaneHeader>
      <PaneBody className="p-4">
        {loading ? <Spinner /> : shown.length === 0 ? <Hint>No tickets fired. The board is clear.</Hint> : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stations.map(([s, list]) => (
              <div key={s} className="rounded-xl border bg-muted/10">
                <div className="flex items-center justify-between border-b px-3 py-2"><span className="text-sm font-semibold">{s.replace(/_/g, ' ')}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums">{list.length}</span></div>
                <div className="space-y-2 p-2">{list.map((t) => <TicketCard key={t.id} t={t} />)}</div>
              </div>
            ))}
          </div>
        )}
      </PaneBody>
    </>
  );
}

function TicketCard({ t }: { t: KdsTicket }) {
  const act = useRestAction();
  const overdue = t.targetMinutes != null && t.elapsedSeconds > t.targetMinutes * 60;
  const fire = (verb: string, ok: string) => act.mutate({ run: () => apiPost(`/restaurant/kds/tickets/${t.id}/${verb}`), ok, keys: ['rest-kds', 'rest-orders'] });
  return (
    <div className={`rounded-lg border bg-card p-2.5 shadow-sm ${overdue ? 'border-rose-300 ring-1 ring-rose-200 dark:border-rose-500/40 dark:ring-rose-500/20' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">{t.ticketNo}{t.table ? ` · ${t.table}` : ''}<ReprintKotButton ticketId={t.id} /></span>
        <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${overdue ? 'font-semibold text-rose-600' : 'text-muted-foreground'}`}><Timer className="h-3 w-3" />{mmss(t.elapsedSeconds)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5"><StatusBadge status={t.status} /><span className="text-[11px] text-muted-foreground">{t.channel.replace(/_/g, ' ').toLowerCase()}</span></div>
      <ul className="mt-2 space-y-1">{t.items.map((i, idx) => (
        <li key={idx} className="text-sm"><span className="font-medium tabular-nums">{i.qty}×</span> {i.name}{i.modifiers ? <span className="block pl-5 text-xs text-muted-foreground">{i.modifiers}</span> : null}</li>
      ))}</ul>
      <div className="mt-2 flex gap-1.5">
        {t.status === 'QUEUED' ? <Button size="sm" variant="outline" className="h-7 flex-1" disabled={act.isPending} onClick={() => fire('start', 'Ticket started')}>Start</Button> : null}
        {t.status === 'PREPARING' ? <Button size="sm" className="h-7 flex-1" disabled={act.isPending} onClick={() => fire('ready', 'Ready to serve')}>Ready</Button> : null}
        {t.status === 'READY' ? <Button size="sm" variant="outline" className="h-7 flex-1" disabled={act.isPending} onClick={() => fire('bump', 'Bumped')}>Bump / served</Button> : null}
      </div>
    </div>
  );
}

// ── Floor map (with drag-to-position management) ───────────────────────────────
const TABLE_FILL: Record<string, string> = {
  AVAILABLE: 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-300',
  OCCUPIED: 'bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-500/15 dark:border-sky-500/40 dark:text-sky-300',
  RESERVED: 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300',
  CLEANING: 'bg-muted border-border text-muted-foreground',
  WAITING: 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300',
};
const TABLE_ACTIONS = [
  { status: 'OCCUPIED', label: 'Seat' },
  { status: 'RESERVED', label: 'Reserve' },
  { status: 'CLEANING', label: 'Clean' },
  { status: 'AVAILABLE', label: 'Free' },
];

function FloorMap({ tables, areas, loading, sel, onSelect, manage, onToggleManage, branchId }: {
  tables: RestTable[]; areas: FloorArea[]; loading: boolean; sel: string | null;
  onSelect: (id: string) => void; manage: boolean; onToggleManage: () => void; branchId?: string | null;
}) {
  const act = useRestAction();
  const [override, setOverride] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  const posOf = (t: RestTable) => override[t.id] ?? { x: t.position.x, y: t.position.y };
  const selected = tables.find((t) => t.id === sel);

  const bounds = useMemo(() => {
    let w = 600, h = 380;
    for (const t of tables) {
      const p = override[t.id] ?? { x: t.position.x, y: t.position.y };
      w = Math.max(w, p.x + t.position.width + 40);
      h = Math.max(h, p.y + t.position.height + 40);
    }
    return { w, h };
  }, [tables, override]);

  const setStatus = (status: string) => {
    if (!selected) return;
    act.mutate({ run: () => apiPut(`/restaurant/tables/${selected.id}/status`, { status }), ok: `${selected.code} → ${status.toLowerCase()}`, keys: ['rest-tables'] });
  };
  const removeTable = () => {
    if (!selected) return;
    act.mutate({ run: () => apiDelete(`/restaurant/tables/${selected.id}`), ok: `${selected.code} removed`, keys: ['rest-tables'] });
    onSelect('');
  };

  const onPointerDown = (e: ReactPointerEvent, t: RestTable) => {
    if (!manage) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = posOf(t);
    drag.current = { id: t.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setOverride((o) => ({ ...o, [d.id]: { x: Math.max(0, Math.round(d.origX + dx)), y: Math.max(0, Math.round(d.origY + dy)) } }));
  };
  const onPointerUp = (e: ReactPointerEvent, t: RestTable) => {
    const d = drag.current;
    drag.current = null;
    if (!d) { onSelect(t.id); return; }
    if (!d.moved) { onSelect(t.id); return; }
    const p = override[d.id];
    if (p) act.mutate({ run: () => apiPatch(`/restaurant/tables/${d.id}`, { posX: p.x, posY: p.y }), ok: `${t.code} moved`, keys: ['rest-tables'] });
  };

  return (
    <>
      <PaneHeader>
        <span className="text-sm font-medium">Floor plan</span>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {manage ? (
            <>
              <NewAreaDialog branchId={branchId} />
              <NewTableDialog areas={areas} branchId={branchId} />
              {selected ? <Button size="sm" variant="destructive" className="h-7 border border-input" disabled={act.isPending} onClick={removeTable}><Trash2 className="size-3.5" /> {selected.code}</Button> : null}
            </>
          ) : selected ? (
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs font-medium text-muted-foreground">{selected.code}:</span>
              {TABLE_ACTIONS.filter((a) => a.status !== selected.status).map((a) => (
                <Button key={a.status} size="sm" variant="outline" className="h-7" disabled={act.isPending} onClick={() => setStatus(a.status)}>{a.label}</Button>
              ))}
            </div>
          ) : <span className="text-xs text-muted-foreground">{tables.length} tables</span>}
          <TableQrSheetDialog branchId={branchId} />
          <Button size="sm" variant={manage ? 'default' : 'outline'} className="h-7" onClick={onToggleManage}>{manage ? <><Move className="size-3.5" /> Done</> : <><Settings2 className="size-3.5" /> Manage</>}</Button>
        </div>
      </PaneHeader>
      <PaneBody className="p-4">
        {manage ? <p className="mb-3 text-xs text-muted-foreground">Drag tables to reposition · click to select · add areas &amp; tables above.</p> : null}
        {selected ? <div className="mb-3 max-w-md"><TableQrPanel tableId={selected.id} tableCode={selected.code} /></div> : null}
        {loading ? <Spinner /> : tables.length === 0 ? <Hint>No tables yet. Use “Manage” to add areas and tables.</Hint> : (
          <div className="overflow-auto">
            <div
              className="relative rounded-xl border bg-muted/10"
              style={{
                width: bounds.w, height: bounds.h, minWidth: '100%', touchAction: manage ? 'none' : undefined,
                backgroundImage: 'radial-gradient(circle, var(--tw-gradient-from, rgba(120,120,120,.12)) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            >
              {tables.map((t) => {
                const p = posOf(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onPointerDown={(e) => onPointerDown(e, t)}
                    onPointerMove={onPointerMove}
                    onPointerUp={(e) => onPointerUp(e, t)}
                    onClick={() => { if (!manage) onSelect(t.id); }}
                    title={`${t.code} · ${t.status}`}
                    className={`absolute flex flex-col items-center justify-center border text-xs font-semibold shadow-sm transition-colors ${TABLE_FILL[t.status] ?? 'bg-card border-border'} ${t.shape === 'ROUND' || t.shape === 'OVAL' ? 'rounded-full' : 'rounded-md'} ${sel === t.id ? 'ring-2 ring-primary' : ''} ${manage ? 'cursor-move' : 'cursor-pointer'}`}
                    style={{ left: p.x, top: p.y, width: t.position.width, height: t.position.height }}
                  >
                    <span>{t.code}</span>
                    <span className="text-[10px] font-normal opacity-70">{t.capacity}p</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          {['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'WAITING'].map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded-sm border ${TABLE_FILL[s]}`} />{s.toLowerCase()}</span>
          ))}
        </div>
      </PaneBody>
    </>
  );
}

// ── Detail panes ───────────────────────────────────────────────────────────────
function DetailShell({ title, badge, onBack, actions, children }: {
  title: string; badge?: React.ReactNode; onBack: () => void; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <>
      <PaneHeader>
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground lg:hidden">← Back</button>
        <span className="flex-1 truncate font-semibold">{title}</span>
        {actions}
        {badge}
      </PaneHeader>
      <PaneBody className="p-5">{children}</PaneBody>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function ItemDetail({ item, loading, categories, groups, products, recipe, recipeLoading, onBack, onDeleted }: {
  item?: ItemDetail; loading: boolean; categories: MenuCategory[]; groups: ModifierGroup[];
  products: InventoryProduct[]; recipe?: Recipe; recipeLoading: boolean;
  onBack: () => void; onDeleted: () => void;
}) {
  const act = useRestAction();
  if (loading || !item) return loading ? <><PaneHeader><span className="flex-1 text-sm font-medium">Item</span></PaneHeader><PaneBody><Spinner /></PaneBody></> : <EmptyDetail icon={UtensilsCrossed} title="Item" hint="Select an item." />;
  const toggle = () => act.mutate({ run: () => apiPatch(`/restaurant/items/${item.id}`, { available: !item.available }), ok: item.available ? `${item.name} 86'd` : `${item.name} back on`, keys: ['rest-items', 'rest-item'] });
  const remove = () => { act.mutate({ run: () => apiDelete(`/restaurant/items/${item.id}`), ok: `${item.name} deleted`, keys: ['rest-items'] }); onDeleted(); };
  const detach = (gid: string) => act.mutate({ run: () => apiDelete(`/restaurant/items/${item.id}/modifier-groups/${gid}`), ok: 'Group detached', keys: ['rest-item'] });
  return (
    <DetailShell title={item.name} badge={<StatusBadge status={item.available ? 'AVAILABLE' : 'INACTIVE'} />} onBack={onBack}>
      <div className="mb-5 flex items-center gap-4">
        <FoodThumb src={imageSrc(item.imageKey)} name={item.name} size={96} rounded="rounded-xl" />
        <div className="flex-1">
          <div className="text-2xl font-bold tabular-nums">{formatMoney(item.effectivePrice.amountMinor, item.effectivePrice.currency)}</div>
          <div className="text-sm text-muted-foreground">{item.category ?? 'Uncategorised'}{item.isCombo ? ' · Combo' : ''}</div>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <EditItemDialog item={item} categories={categories} />
        <Button size="sm" variant="outline" disabled={act.isPending} onClick={toggle}>{item.available ? "86 (mark unavailable)" : 'Mark available'}</Button>
        <Button size="sm" variant="destructive" disabled={act.isPending} onClick={remove}><Trash2 className="size-3.5" /> Delete</Button>
      </div>
      <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
        <Field label="SKU" value={item.sku ?? '—'} />
        <Field label="Base price" value={formatMoney(item.basePrice.amountMinor, item.basePrice.currency)} />
        <Field label="Tax" value={item.taxBp == null ? '—' : `${(item.taxBp / 100).toFixed(2)}%`} />
        <Field label="Prep time" value={`${item.prepMinutes} min`} />
        <Field label="Station" value={item.stationKey ?? '—'} />
        <Field label="Type" value={item.isCombo ? 'Combo' : 'Single'} />
      </dl>
      <div className="mt-6 max-w-md">
        <h3 className="mb-2 text-sm font-semibold">Modifier groups</h3>
        {item.modifierGroups.length === 0 ? <p className="mb-3 text-xs text-muted-foreground">No modifier groups attached.</p> : (
          <ul className="mb-3 space-y-1.5">{item.modifierGroups.map((g) => (
            <li key={g.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="flex-1 font-medium">{g.name}</span>
              <span className="text-xs text-muted-foreground">{g.required ? 'required · ' : ''}pick {g.minSelect}–{g.maxSelect ?? '∞'}</span>
              <button type="button" title="Detach" className="text-muted-foreground hover:text-rose-600" disabled={act.isPending} onClick={() => detach(g.id)}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}</ul>
        )}
        <AttachGroupControl itemId={item.id} groups={groups} attachedIds={item.modifierGroups.map((g) => g.id)} />
      </div>
      <div className="mt-4"><ItemBarcodePanel itemId={item.id} itemName={item.name} barcode={item.barcode ?? null} /></div>
      <RecipeCard itemId={item.id} recipe={recipe} loading={recipeLoading} products={products} />
    </DetailShell>
  );
}

function ModifierGroupDetailView({ group, loading, onBack }: { group?: ModifierGroupDetail; loading: boolean; onBack: () => void }) {
  const act = useRestAction();
  if (loading || !group) return loading ? <><PaneHeader><span className="flex-1 text-sm font-medium">Group</span></PaneHeader><PaneBody><Spinner /></PaneBody></> : <EmptyDetail icon={SlidersHorizontal} title="Group" hint="Select a group." />;
  const removeOption = (id: string) => act.mutate({ run: () => apiDelete(`/restaurant/modifiers/${id}`), ok: 'Option removed', keys: ['rest-modgroup', 'rest-modgroups'] });
  const removeGroup = () => act.mutate({ run: () => apiDelete(`/restaurant/modifier-groups/${group.id}`), ok: `${group.name} deleted`, keys: ['rest-modgroups'] });
  return (
    <DetailShell
      title={group.name}
      badge={<span className="text-xs text-muted-foreground">{group.required ? 'required · ' : ''}pick {group.minSelect}–{group.maxSelect ?? '∞'}</span>}
      onBack={onBack}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NewModifierDialog groupId={group.id} />
        <Button size="sm" variant="destructive" disabled={act.isPending} onClick={removeGroup}><Trash2 className="size-3.5" /> Delete group</Button>
      </div>
      {group.modifiers.length === 0 ? <Hint>No options yet. Add one (e.g. “Mild”, “Extra cheese +1.00”).</Hint> : (
        <ul className="max-w-md divide-y rounded-xl border">{group.modifiers.map((mo) => (
          <li key={mo.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <span className="flex-1 font-medium">{mo.name}</span>
            <span className="tabular-nums text-muted-foreground">{mo.priceDelta.amountMinor === 0 ? '—' : `${mo.priceDelta.amountMinor > 0 ? '+' : ''}${formatMoney(mo.priceDelta.amountMinor, mo.priceDelta.currency)}`}</span>
            <button type="button" title="Remove" className="text-muted-foreground hover:text-rose-600" disabled={act.isPending} onClick={() => removeOption(mo.id)}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}</ul>
      )}
    </DetailShell>
  );
}

function OrderDetail({ order, onBack }: { order?: OrderRow; onBack: () => void }) {
  if (!order) return <EmptyDetail icon={Receipt} title="Order" hint="Select an order." />;
  return (
    <DetailShell
      title={order.orderNo}
      badge={<StatusBadge status={order.status} />}
      onBack={onBack}
      actions={<ReceiptDialog orderId={order.id} orderNo={order.orderNo} settled={order.status === 'SETTLED'} />}
    >
      <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
        <Field label="Channel" value={order.channel.replace(/_/g, ' ').toLowerCase()} />
        <Field label="Table" value={order.table ?? '—'} />
        <Field label="Guests" value={String(order.guestCount)} />
        <Field label="Items" value={String(order.itemCount)} />
        <Field label="Total" value={formatMoney(order.total.amountMinor, order.total.currency)} />
      </dl>
    </DetailShell>
  );
}

/**
 * The door code, revealed on request rather than rendered with the rest of the job.
 *
 * It is the one thing on this screen that proves the food reached the person who ordered it, and a
 * delivery board is usually open on a counter monitor in front of whoever is standing there. Staff
 * ask for it when they have the customer on the phone.
 */
function DeliveryOtpPanel({ deliveryId }: { deliveryId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reveal = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ otp: string }>(`/restaurant/deliveries/${deliveryId}/otp`);
      setCode(res.otp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read the code');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="border-t pt-3">
      {code ? (
        <div>
          <div className="font-mono text-2xl font-bold tracking-[0.3em] tabular-nums">{code}</div>
          <p className="mt-1 text-xs text-muted-foreground">Read this to the customer — the rider asks for it at the door.</p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" className="h-9" disabled={loading} onClick={reveal}>Show door code</Button>
          {error ? <span className="text-xs text-rose-600">{error}</span> : null}
        </div>
      )}
    </div>
  );
}

function DeliveryDetail({ row, onBack }: { row?: DeliveryRow; onBack: () => void }) {
  const act = useRestAction();
  const [driver, setDriver] = useState('');
  const [otp, setOtp] = useState('');
  if (!row) return <EmptyDetail icon={Bike} title="Delivery" hint="Select a delivery." />;
  const post = (verb: string, ok: string, body?: unknown) => act.mutate({ run: () => apiPost(`/restaurant/deliveries/${row.id}/${verb}`, body), ok, keys: ['rest-deliveries', 'rest-orders'] });
  const canAssign = ['PENDING', 'ASSIGNED'].includes(row.status);
  const canComplete = ['PICKED_UP', 'EN_ROUTE'].includes(row.status);
  const terminal = ['DELIVERED', 'FAILED', 'CANCELLED'].includes(row.status);
  return (
    <DetailShell title={row.deliveryNo} badge={<StatusBadge status={row.status} />} onBack={onBack}>
      <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
        <Field label="Provider" value={row.provider} />
        <Field label="Order" value={row.orderNo} />
        <Field label="Driver" value={row.driverEmployeeId ?? 'Unassigned'} />
        <Field label="ETA" value={row.etaMinutes == null ? '—' : `${row.etaMinutes} min`} />
        <Field label="Assigned" value={fmtDateTime(row.assignedAt)} />
        <Field label="Delivered" value={fmtDateTime(row.deliveredAt)} />
        <div className="col-span-2"><Field label="Address" value={row.address ?? 'Not given — phone the customer'} /></div>
      </dl>
      {!terminal && row.provider === 'OWN' ? (
        <div className="mt-6 max-w-md space-y-3 rounded-xl border p-4">
          <p className="text-sm font-semibold">Dispatch</p>
          {canAssign ? (
            <div className="flex gap-2">
              <Input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Driver employee UUID" className="h-9" />
              <Button size="sm" className="h-9" disabled={!driver.trim() || act.isPending} onClick={() => post('assign', 'Driver assigned', { driverEmployeeId: driver.trim() })}>Assign</Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {row.status === 'ASSIGNED' ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => post('pickup', 'Picked up')}>Picked up</Button> : null}
            {row.status === 'PICKED_UP' ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => post('enroute', 'En route')}>En route</Button> : null}
            {!terminal ? <Button size="sm" variant="destructive" disabled={act.isPending} onClick={() => post('fail', 'Marked failed')}>Fail</Button> : null}
          </div>
          <DeliveryOtpPanel deliveryId={row.id} />
          {canComplete ? (
            <div className="flex gap-2 border-t pt-3">
              <Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Delivery OTP" className="h-9 tracking-widest" />
              <Button size="sm" className="h-9" disabled={otp.trim().length < 4 || act.isPending} onClick={() => post('complete', 'Delivered', { otp: otp.trim() })}>Complete</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </DetailShell>
  );
}

const RESERVATION_ACTIONS: Array<{ status: string; label: string; from: string[]; variant?: 'outline' | 'destructive' }> = [
  { status: 'CONFIRMED', label: 'Confirm', from: ['BOOKED', 'WAITLIST'], variant: 'outline' },
  { status: 'SEATED', label: 'Seat', from: ['BOOKED', 'CONFIRMED', 'WAITLIST'] },
  { status: 'COMPLETED', label: 'Complete', from: ['SEATED'], variant: 'outline' },
  { status: 'NO_SHOW', label: 'No-show', from: ['BOOKED', 'CONFIRMED'], variant: 'destructive' },
  { status: 'CANCELLED', label: 'Cancel', from: ['BOOKED', 'CONFIRMED', 'WAITLIST'], variant: 'destructive' },
];

function ReservationDetail({ row, onBack }: { row?: ReservationRow; onBack: () => void }) {
  const act = useRestAction();
  if (!row) return <EmptyDetail icon={CalendarClock} title="Reservation" hint="Select a reservation." />;
  const actions = RESERVATION_ACTIONS.filter((a) => a.from.includes(row.status));
  const setStatus = (status: string, label: string) => act.mutate({ run: () => apiPut(`/restaurant/reservations/${row.id}/status`, { status }), ok: `${row.reservationNo} — ${label.toLowerCase()}`, keys: ['rest-reservations', 'rest-tables'] });
  return (
    <DetailShell title={row.guestName ?? row.reservationNo} badge={<StatusBadge status={row.status} />} onBack={onBack}>
      <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
        <Field label="Reference" value={row.reservationNo} />
        <Field label="Phone" value={row.guestPhone ?? '—'} />
        <Field label="Party size" value={String(row.partySize)} />
        <Field label="Table" value={row.table ?? 'Unassigned'} />
        <Field label="Reserved for" value={fmtDateTime(row.reservedFor)} />
        <Field label="Duration" value={`${row.durationMinutes} min`} />
      </dl>
      {actions.length ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.status} size="sm" variant={a.variant} disabled={act.isPending} onClick={() => setStatus(a.status, a.label)}>{a.label}</Button>
          ))}
        </div>
      ) : null}
    </DetailShell>
  );
}

// ── Branches (multi-outlet) ────────────────────────────────────────────────────
type Warehouse = { id: string; name: string; code: string | null; branchId: string | null };

/** Header dropdown that sets the active operating branch. `null` value = all branches (aggregate). */
function BranchSwitcher({ branches, value, onChange }: { branches: Branch[]; value: string | null; onChange: (id: string | null) => void }) {
  if (branches.length === 0) return null;
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-sm">
      <Building2 className="h-4 w-4 text-violet-600" />
      <span className="text-xs font-medium text-muted-foreground">Branch</span>
      <select
        value={value ?? 'ALL'}
        onChange={(e) => onChange(e.target.value === 'ALL' ? null : e.target.value)}
        className="bg-transparent text-sm font-semibold outline-none"
      >
        <option value="ALL">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}{b.isHeadOffice ? ' (HQ)' : ''}{b.configured ? '' : ' — unconfigured'}</option>
        ))}
      </select>
    </label>
  );
}

/** Branch list (list pane of the Branches admin section). */
function BranchList({ branches, loading, sel, onPick, activeId }: { branches: Branch[]; loading: boolean; sel: string | null; onPick: (id: string) => void; activeId: string | null }) {
  return (
    <>
      <PaneHeader><span className="flex-1 text-sm font-medium">Branches</span><span className="text-xs text-muted-foreground">{branches.length} outlet{branches.length === 1 ? '' : 's'}</span></PaneHeader>
      <PaneBody>
        {loading ? <Spinner /> : branches.length === 0 ? <Hint>No branches yet. Create outlets under Settings → Branches, then configure each here.</Hint> : (
          <ul className="divide-y">{branches.map((b) => (
            <li key={b.id}><ListRow active={sel === b.id} onClick={() => onPick(b.id)}>
              <Building2 className={`h-4 w-4 ${b.active ? 'text-violet-600' : 'text-muted-foreground'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><span className="truncate font-medium">{b.name}</span>{b.isHeadOffice ? <span className="rounded bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">HQ</span> : null}{activeId === b.id ? <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">active</span> : null}</div>
                <div className="truncate text-xs text-muted-foreground">{b.code ?? 'no code'}</div>
              </div>
              {b.configured
                ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><Check className="h-3 w-3" /> ready</span>
                : <span className="text-[11px] font-medium text-amber-600">needs setup</span>}
            </ListRow></li>
          ))}</ul>
        )}
      </PaneBody>
    </>
  );
}

/** Per-branch restaurant config editor + one-click provision (clone head-office defaults). */
function BranchAdmin({ branch, onBack }: { branch?: Branch; onBack: () => void }) {
  const qc = useQueryClient();
  const [currency, setCurrency] = useState('');
  const [taxPct, setTaxPct] = useState('');
  const [svcPct, setSvcPct] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [autoFire, setAutoFire] = useState(true);
  const [rounding, setRounding] = useState(true);

  const config = useQuery({
    queryKey: ['rest-config', branch?.id],
    queryFn: () => apiGet<RestaurantConfig>(`/restaurant/config?branchId=${branch!.id}`),
    enabled: !!branch,
  });
  const warehouses = useQuery({ queryKey: ['rest-warehouses'], queryFn: () => apiGet<Warehouse[]>('/inventory/warehouses'), enabled: !!branch });

  useEffect(() => {
    const c = config.data;
    if (!c) return;
    setCurrency(c.currency);
    setTaxPct((c.defaultTaxBp / 100).toString());
    setSvcPct((c.serviceChargeBp / 100).toString());
    setWarehouseId(c.defaultWarehouseId ?? '');
    setAutoFire(c.autoFireKitchen);
    setRounding(c.roundingEnabled);
  }, [config.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['rest-branches'] });
    qc.invalidateQueries({ queryKey: ['rest-config', branch?.id] });
  };
  const provision = useMutation({
    mutationFn: () => apiPost(`/restaurant/branches/${branch!.id}/provision`),
    onSuccess: () => { toast.success('Branch provisioned', { description: 'Cloned head-office defaults.' }); invalidate(); },
    onError: (e) => toast.error('Could not provision', { description: e instanceof ApiError ? e.message : '' }),
  });
  const save = useMutation({
    mutationFn: () => apiPut('/restaurant/config', {
      branchId: branch!.id,
      currency: currency.trim() || undefined,
      defaultTaxBp: taxPct.trim() ? Math.round(Number(taxPct) * 100) : undefined,
      serviceChargeBp: svcPct.trim() ? Math.round(Number(svcPct) * 100) : undefined,
      defaultWarehouseId: warehouseId || null,
      autoFireKitchen: autoFire,
      roundingEnabled: rounding,
    }),
    onSuccess: () => { toast.success('Branch configuration saved'); invalidate(); },
    onError: (e) => toast.error('Could not save', { description: e instanceof ApiError ? e.message : '' }),
  });

  if (!branch) return <EmptyDetail icon={Building2} title="Branch" hint="Select a branch." />;
  // Warehouses for this branch first, then unassigned/other (a branch's stock usually lives in its own warehouse).
  const whs = (warehouses.data ?? []).slice().sort((a, b) => Number(b.branchId === branch.id) - Number(a.branchId === branch.id));
  const busy = provision.isPending || save.isPending;

  return (
    <DetailShell
      title={branch.name}
      badge={branch.configured ? <StatusBadge status="AVAILABLE" /> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">unconfigured</span>}
      onBack={onBack}
    >
      {!branch.configured ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">This outlet has no restaurant configuration yet.</p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/80">Provision it to clone the head-office currency, tax and warehouse so it can take correctly-priced orders. You can fine-tune below afterwards.</p>
          <Button size="sm" className="mt-3" disabled={busy} onClick={() => provision.mutate()}>{provision.isPending ? 'Provisioning…' : 'Provision from head office'}</Button>
        </div>
      ) : null}

      {config.isLoading ? <Spinner /> : (
        <form className="max-w-md space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Currency</label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="PKR" maxLength={3} /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Default tax %</label><Input value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" placeholder="16" /></div>
            <div className="space-y-1"><label className="text-xs text-muted-foreground">Service charge %</label><Input value={svcPct} onChange={(e) => setSvcPct(e.target.value)} inputMode="decimal" placeholder="0" /></div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Default warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
                <option value="">— none —</option>
                {whs.map((w) => <option key={w.id} value={w.id}>{w.name}{w.branchId === branch.id ? ' ✓' : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={autoFire} onChange={(e) => setAutoFire(e.target.checked)} /> Auto-fire kitchen on place</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={rounding} onChange={(e) => setRounding(e.target.checked)} /> Round bill totals</label>
          </div>
          <p className="text-xs text-muted-foreground">Stock for this outlet deducts from its default warehouse; tax follows this branch's fiscal authority (set under Settings → Branches for address, and the fiscal config API for PRA/FBR).</p>
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={busy || !branch.configured}>{save.isPending ? 'Saving…' : 'Save configuration'}</Button>
          </div>
        </form>
      )}
    </DetailShell>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone = 'default' }: { label: string; value: string; sub?: string; icon: typeof Receipt; tone?: 'default' | 'amber' | 'emerald' | 'sky' | 'rose' | 'violet' }) {
  const tones: Record<string, string> = { default: 'text-primary', amber: 'text-amber-600', emerald: 'text-emerald-600', sky: 'text-sky-600', rose: 'text-rose-600', violet: 'text-violet-600' };
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tones[tone]}`} /></div>
      <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
