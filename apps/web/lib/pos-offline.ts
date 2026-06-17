'use client';
/**
 * Offline persistence for the POS terminal — a local cache of the product catalogue + open shift, and
 * a durable queue of sales rung while offline. Backed by localStorage (synchronous, robust, no extra
 * dependency; ample for a register's catalogue + pending sales). Each queued sale carries a client
 * Idempotency-Key so replay-on-reconnect is processed exactly once by the server.
 */
import type { PosSale, Product } from '@/lib/types';

const K = {
  catalog: 'mx_pos_catalog',
  shift: (registerId: string) => `mx_pos_shift_${registerId}`,
  queue: 'mx_pos_queue',
  activeRegister: 'mx_pos_active_register',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

// ── Catalogue + shift snapshot (so the terminal has data offline) ───────────────
export function saveCatalog(products: Product[]): void {
  // Keep it slim — only what the till needs to ring a sale.
  write(K.catalog, products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, sellPrice: p.sellPrice, onHand: p.onHand })));
}
export function loadCatalog(): Product[] {
  return read<Product[]>(K.catalog, []);
}

export interface ShiftSnapshot {
  shiftId: string;
  registerId: string;
  registerName: string;
  currency: string;
  warehouseId: string | null;
}
export function saveShift(snap: ShiftSnapshot): void {
  write(K.shift(snap.registerId), snap);
}
export function loadShift(registerId: string): ShiftSnapshot | null {
  return read<ShiftSnapshot | null>(K.shift(registerId), null);
}

/** Remember the last register used while online, so the till can resume it offline. */
export function saveActiveRegister(registerId: string): void {
  write(K.activeRegister, registerId);
}
export function loadActiveRegister(): string | null {
  return read<string | null>(K.activeRegister, null);
}

// ── Offline sale queue ──────────────────────────────────────────────────────────
export interface QueuedSale {
  key: string; // Idempotency-Key (uuid)
  payload: Record<string, unknown>; // the exact /pos/sales body to replay
  receipt: PosSale; // a provisional receipt to show/print immediately
  createdAt: number;
  status: 'pending' | 'error';
  error?: string;
}

export function getQueue(): QueuedSale[] {
  return read<QueuedSale[]>(K.queue, []);
}
export function enqueueSale(entry: QueuedSale): void {
  const q = getQueue();
  q.push(entry);
  write(K.queue, q);
}
export function updateQueued(key: string, patch: Partial<QueuedSale>): void {
  write(K.queue, getQueue().map((e) => (e.key === key ? { ...e, ...patch } : e)));
}
export function removeQueued(key: string): void {
  write(K.queue, getQueue().filter((e) => e.key !== key));
}
export const pendingCount = (): number => getQueue().filter((e) => e.status === 'pending').length;
