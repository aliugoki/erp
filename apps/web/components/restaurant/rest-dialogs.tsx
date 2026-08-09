'use client';
import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, LayoutGrid, ListPlus, Pencil, Plus, QrCode, SquarePlus, Tags } from 'lucide-react';
import { ApiError, apiPatch, apiPost, apiPut } from '@/lib/api';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { AREA_KINDS, type FloorArea, type ItemDetail, type ModifierGroup, TABLE_SHAPES } from '@/components/restaurant/rest-ui';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '');

// ── New menu item ────────────────────────────────────────────────────────────
export function NewMenuItemDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [prep, setPrep] = useState('');
  const [station, setStation] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isCombo, setIsCombo] = useState(false);

  function reset() { setName(''); setSku(''); setPrice(''); setPrep(''); setStation(''); setImageUrl(''); setIsCombo(false); }

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/items', {
      name: name.trim(),
      sku: sku.trim() || undefined,
      basePriceMinor: price.trim() ? Math.round(Number(price) * 100) : undefined,
      prepMinutes: prep.trim() ? Number(prep) : undefined,
      stationKey: station.trim() || undefined,
      imageKey: imageUrl.trim() || undefined,
      isCombo,
    }),
    onSuccess: () => {
      toast.success('Menu item added', { description: name });
      qc.invalidateQueries({ queryKey: ['rest-items'] });
      setOpen(false); reset();
    },
    onError: (e) => toast.error('Could not add item', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> New item</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add menu item</DialogTitle>
          <DialogDescription>Price is major units (e.g. 4.50). Link a recipe later for COGS.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="nm">Name</Label><Input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chicken Karahi" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="sku">SKU</Label><Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="KAR-01" /></div>
            <div className="space-y-2"><Label htmlFor="pr">Price</Label><Input id="pr" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12.00" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="pt">Prep (min)</Label><Input id="pt" type="number" min="0" value={prep} onChange={(e) => setPrep(e.target.value)} placeholder="15" /></div>
            <div className="space-y-2"><Label htmlFor="st">Station</Label><Input id="st" value={station} onChange={(e) => setStation(e.target.value)} placeholder="HOT_KITCHEN" /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="img">Photo URL</Label><Input id="img" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/dish.jpg" /></div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2"><Label htmlFor="cb">Combo / meal deal</Label><Switch id="cb" checked={isCombo} onCheckedChange={setIsCombo} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add item'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New reservation ──────────────────────────────────────────────────────────
export function NewReservationDialog({ branchId }: { branchId?: string | null } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [reservedFor, setReservedFor] = useState('');
  const [waitlist, setWaitlist] = useState(false);

  function reset() { setGuestName(''); setGuestPhone(''); setPartySize('2'); setReservedFor(''); setWaitlist(false); }

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/reservations', {
      branchId: branchId ?? undefined,
      guestName: guestName.trim() || undefined,
      guestPhone: guestPhone.trim() || undefined,
      partySize: partySize.trim() ? Number(partySize) : undefined,
      reservedFor: new Date(reservedFor).toISOString(),
      waitlist,
    }),
    onSuccess: () => {
      toast.success('Reservation booked', { description: guestName || 'Guest' });
      qc.invalidateQueries({ queryKey: ['rest-reservations'] });
      setOpen(false); reset();
    },
    onError: (e) => toast.error('Could not book', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><CalendarPlus className="size-4" /> Book</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reservation</DialogTitle>
          <DialogDescription>Book a table or add the party to the waitlist.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="gn">Guest name</Label><Input id="gn" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Ayesha" /></div>
            <div className="space-y-2"><Label htmlFor="gp">Phone</Label><Input id="gp" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+92…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="ps">Party size</Label><Input id="ps" type="number" min="1" value={partySize} onChange={(e) => setPartySize(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="rf">Reserved for</Label><Input id="rf" type="datetime-local" value={reservedFor} onChange={(e) => setReservedFor(e.target.value)} required={!waitlist} /></div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2"><Label htmlFor="wl">Waitlist (no fixed time)</Label><Switch id="wl" checked={waitlist} onCheckedChange={setWaitlist} /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={(!reservedFor && !waitlist) || create.isPending}>{create.isPending ? 'Booking…' : 'Book'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── QR / code check-in ───────────────────────────────────────────────────────
export function CheckinDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  const checkin = useMutation({
    mutationFn: () => apiPost('/restaurant/reservations/checkin', { code: code.trim().toUpperCase() }),
    onSuccess: () => {
      toast.success('Guest seated', { description: code.toUpperCase() });
      qc.invalidateQueries({ queryKey: ['rest-reservations'] });
      qc.invalidateQueries({ queryKey: ['rest-tables'] });
      setOpen(false); setCode('');
    },
    onError: (e) => toast.error('Check-in failed', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); checkin.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><QrCode className="size-4" /> Check-in</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reservation check-in</DialogTitle>
          <DialogDescription>Enter the code from the guest&apos;s booking QR to seat them.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="cc">Check-in code</Label><Input id="cc" value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1B2C3" className="uppercase tracking-widest" required /></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={code.trim().length < 4 || checkin.isPending}>{checkin.isPending ? 'Seating…' : 'Seat guest'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New floor area ───────────────────────────────────────────────────────────
export function NewAreaDialog({ branchId }: { branchId?: string | null } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('INDOOR');

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/areas', { name: name.trim(), kind, branchId: branchId ?? undefined }),
    onSuccess: () => {
      toast.success('Area added', { description: name });
      qc.invalidateQueries({ queryKey: ['rest-areas'] });
      setOpen(false); setName(''); setKind('INDOOR');
    },
    onError: (e) => toast.error('Could not add area', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><LayoutGrid className="size-4" /> Area</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New floor area</DialogTitle>
          <DialogDescription>Group tables into zones — Main Hall, Terrace, VIP…</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="an">Name</Label><Input id="an" value={name} onChange={(e) => setName(e.target.value)} placeholder="Terrace" required /></div>
          <div className="space-y-2">
            <Label htmlFor="ak">Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="ak"><SelectValue /></SelectTrigger>
              <SelectContent>{AREA_KINDS.map((k) => <SelectItem key={k} value={k}>{k.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add area'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New table ────────────────────────────────────────────────────────────────
export function NewTableDialog({ areas, branchId }: { areas: FloorArea[]; branchId?: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [shape, setShape] = useState<string>('RECT');
  const [areaId, setAreaId] = useState<string>('');

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/tables', {
      code: code.trim(),
      capacity: Number(capacity) || 2,
      shape,
      branchId: branchId ?? undefined,
      areaId: areaId || undefined,
      // drop new tables into open space; they can be dragged into place on the map.
      posX: 24, posY: 24, width: shape === 'ROUND' ? 64 : 88, height: 64,
    }),
    onSuccess: () => {
      toast.success('Table added', { description: code });
      qc.invalidateQueries({ queryKey: ['rest-tables'] });
      setOpen(false); setCode(''); setCapacity('4'); setShape('RECT'); setAreaId('');
    },
    onError: (e) => toast.error('Could not add table', { description: e instanceof ApiError ? e.message : '' }),
  });

  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><SquarePlus className="size-4" /> Table</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New table</DialogTitle>
          <DialogDescription>Add a table, then drag it into position on the floor plan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="tc">Code</Label><Input id="tc" value={code} onChange={(e) => setCode(e.target.value)} placeholder="T8" required /></div>
            <div className="space-y-2"><Label htmlFor="tcap">Seats</Label><Input id="tcap" type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tsh">Shape</Label>
              <Select value={shape} onValueChange={setShape}>
                <SelectTrigger id="tsh"><SelectValue /></SelectTrigger>
                <SelectContent>{TABLE_SHAPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tar">Area</Label>
              <Select value={areaId} onValueChange={setAreaId}>
                <SelectTrigger id="tar"><SelectValue placeholder="Unzoned" /></SelectTrigger>
                <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!code.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add table'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New menu category ────────────────────────────────────────────────────────
export function NewCategoryDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/categories', { name: name.trim() }),
    onSuccess: () => { toast.success('Category added', { description: name }); qc.invalidateQueries({ queryKey: ['rest-categories'] }); setOpen(false); setName(''); },
    onError: (e) => toast.error('Could not add category', { description: errMsg(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Tags className="size-4" /> Category</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New category</DialogTitle><DialogDescription>Group menu items — Curries, BBQ, Breads…</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="cn">Name</Label><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Desserts" required /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add category'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit menu item ───────────────────────────────────────────────────────────
export function EditItemDialog({ item, categories }: { item: ItemDetail; categories: Array<{ id: string; name: string }> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((item.basePrice.amountMinor / 100).toFixed(2));
  const [prep, setPrep] = useState(String(item.prepMinutes));
  const [station, setStation] = useState(item.stationKey ?? '');
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [imageUrl, setImageUrl] = useState(item.imageKey ?? '');

  const save = useMutation({
    mutationFn: () => apiPatch(`/restaurant/items/${item.id}`, {
      name: name.trim(), basePriceMinor: Math.round(Number(price || '0') * 100),
      prepMinutes: prep.trim() ? Number(prep) : undefined, stationKey: station.trim() || undefined,
      categoryId: categoryId || undefined, imageKey: imageUrl.trim() || undefined,
    }),
    onSuccess: () => { toast.success('Item updated', { description: name }); qc.invalidateQueries({ queryKey: ['rest-items'] }); qc.invalidateQueries({ queryKey: ['rest-item', item.id] }); setOpen(false); },
    onError: (e) => toast.error('Could not update', { description: errMsg(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setName(item.name); setPrice((item.basePrice.amountMinor / 100).toFixed(2)); setPrep(String(item.prepMinutes)); setStation(item.stationKey ?? ''); setCategoryId(item.categoryId ?? ''); setImageUrl(item.imageKey ?? ''); } }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Pencil className="size-3.5" /> Edit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {item.name}</DialogTitle><DialogDescription>Price is major units (e.g. 12.00).</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="en">Name</Label><Input id="en" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="ep">Price</Label><Input id="ep" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="epr">Prep (min)</Label><Input id="epr" type="number" min="0" value={prep} onChange={(e) => setPrep(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="es">Station</Label><Input id="es" value={station} onChange={(e) => setStation(e.target.value)} placeholder="HOT_KITCHEN" /></div>
            <div className="space-y-2">
              <Label htmlFor="ec">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="ec"><SelectValue placeholder="Uncategorised" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label htmlFor="ei">Photo URL</Label><Input id="ei" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/dish.jpg" /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!name.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New modifier group ───────────────────────────────────────────────────────
export function NewModifierGroupDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [minSel, setMinSel] = useState('0');
  const [maxSel, setMaxSel] = useState('1');
  const [required, setRequired] = useState(false);

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/modifier-groups', {
      name: name.trim(), minSelect: Number(minSel) || 0, maxSelect: maxSel.trim() ? Number(maxSel) : undefined, required,
    }),
    onSuccess: () => { toast.success('Group added', { description: name }); qc.invalidateQueries({ queryKey: ['rest-modgroups'] }); setOpen(false); setName(''); setMinSel('0'); setMaxSel('1'); setRequired(false); },
    onError: (e) => toast.error('Could not add group', { description: errMsg(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Group</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New modifier group</DialogTitle><DialogDescription>e.g. “Spice level”, “Add-ons”. Min/max control how many options a guest picks.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="gn">Name</Label><Input id="gn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spice level" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="gmin">Min select</Label><Input id="gmin" type="number" min="0" value={minSel} onChange={(e) => setMinSel(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="gmax">Max select</Label><Input id="gmax" type="number" min="0" value={maxSel} onChange={(e) => setMaxSel(e.target.value)} /></div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2"><Label htmlFor="greq">Required</Label><Switch id="greq" checked={required} onCheckedChange={setRequired} /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add group'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New modifier (option) ────────────────────────────────────────────────────
export function NewModifierDialog({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [delta, setDelta] = useState('0');

  const create = useMutation({
    mutationFn: () => apiPost('/restaurant/modifiers', { groupId, name: name.trim(), priceDeltaMinor: Math.round(Number(delta || '0') * 100) }),
    onSuccess: () => { toast.success('Option added', { description: name }); qc.invalidateQueries({ queryKey: ['rest-modgroup', groupId] }); qc.invalidateQueries({ queryKey: ['rest-modgroups'] }); setOpen(false); setName(''); setDelta('0'); },
    onError: (e) => toast.error('Could not add option', { description: errMsg(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><ListPlus className="size-3.5" /> Option</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New option</DialogTitle><DialogDescription>Price delta adds to the line (e.g. +1.00 for extra cheese; 0 for “Medium”).</DialogDescription></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="mn">Name</Label><Input id="mn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Extra cheese" required /></div>
          <div className="space-y-2"><Label htmlFor="md">Price delta</Label><Input id="md" type="number" step="0.01" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="1.00" /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Adding…' : 'Add option'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Attach a modifier group to an item ───────────────────────────────────────
export function AttachGroupControl({ itemId, groups, attachedIds }: { itemId: string; groups: ModifierGroup[]; attachedIds: string[] }) {
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState('');
  const available = groups.filter((g) => !attachedIds.includes(g.id));
  const attach = useMutation({
    mutationFn: (gid: string) => apiPut(`/restaurant/items/${itemId}/modifier-groups`, { groupId: gid }),
    onSuccess: () => { toast.success('Group attached'); qc.invalidateQueries({ queryKey: ['rest-item', itemId] }); setGroupId(''); },
    onError: (e) => toast.error('Could not attach', { description: errMsg(e) }),
  });
  if (!available.length) return <p className="text-xs text-muted-foreground">All groups attached.</p>;
  return (
    <div className="flex gap-2">
      <Select value={groupId} onValueChange={setGroupId}>
        <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Attach a modifier group…" /></SelectTrigger>
        <SelectContent>{available.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" className="h-9" disabled={!groupId || attach.isPending} onClick={() => attach.mutate(groupId)}>Attach</Button>
    </div>
  );
}
