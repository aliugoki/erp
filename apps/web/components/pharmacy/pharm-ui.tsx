'use client';
import { Loader2 } from 'lucide-react';
import type { Money } from '@/lib/types';

// ── API response shapes (match apps/api pharmacy services) ──────────────────────
export interface DrugListItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  genericName: string | null;
  brand: string | null;
  strength: string | null;
  form: string;
  schedule: string;
  rxRequired: boolean;
  controlled: boolean;
  reorderLevel: number;
  onHand: number;
  sellPrice: Money;
  costPrice: Money;
  belowReorder: boolean;
  status: string;
}

export interface DrugDetailData extends DrugListItem {
  manufacturer: string | null;
  packSize: number;
  therapeuticCategory: string | null;
  barcode: string | null;
  maxLevel: number | null;
  storage: string;
  stockValue: Money;
  currency: string;
}

export interface Lot {
  id: string;
  productId: string;
  sku: string;
  name: string;
  lotNo: string;
  expiryDate: string | null;
  qtyOnHand: number;
  unitCost: Money;
  value: Money;
  receivedOn: string | null;
  docNo: string | null;
  daysLeft?: number;
}

export interface DispenseRow {
  id: string;
  dispense_no: string;
  type: string;
  status: string;
  currency: string;
  total_minor: number;
  cogs_minor: number;
  payment_method: string;
  patient_ref: string | null;
  occurred_on: string | null;
  customer: string | null;
  line_count: number;
}

export interface DispenseDetailData {
  id: string;
  dispenseNo: string;
  type: string;
  status: string;
  currency: string;
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  cogs: Money;
  paymentMethod: string;
  insurer: string | null;
  insuranceCover: Money;
  customer: string | null;
  patientRef: string | null;
  prescriber: string | null;
  prescriptionRef: string | null;
  ward: string | null;
  occurredOn: string | null;
  notes: string | null;
  items: Array<{
    id: string;
    productId: string;
    sku: string;
    name: string;
    lotNo: string | null;
    expiryDate: string | null;
    qty: number;
    unitPrice: Money;
    unitCost: Money;
    discount: Money;
    tax: Money;
    lineTotal: Money;
  }>;
}

export interface ControlledRow {
  id: string;
  sku: string;
  name: string;
  direction: string;
  lot_no: string | null;
  qty: number;
  balance_after: number;
  schedule: string | null;
  prescriber: string | null;
  patient_ref: string | null;
  prescription_ref: string | null;
  occurred_on: string | null;
  dispense_no: string | null;
}

export interface PharmacyConfig {
  mode: string;
  controlledRegisterEnabled: boolean;
  nearExpiryDays: number;
  allowDispenseWithoutStock: boolean;
  defaultWarehouseId: string | null;
  defaultTaxBp: number;
  currency: string;
}

export interface PharmacyGlConfig {
  inventoryAccountId: string | null;
  revenueAccountId: string | null;
  cogsAccountId: string | null;
  taxAccountId: string | null;
  discountAccountId: string | null;
  receivableAccountId: string | null;
  clearingAccountId: string | null;
  writeoffAccountId: string | null;
}

export const DISPENSE_TYPES = ['RETAIL_SALE', 'RX', 'HOSPITAL_ISSUE', 'WHOLESALE'] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'CREDIT', 'INSURANCE'] as const;
export const DRUG_FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'INHALER', 'SACHET', 'OTHER'] as const;
export const DRUG_SCHEDULES = ['OTC', 'RX', 'SCHEDULE_G', 'NARCOTIC', 'PSYCHOTROPIC'] as const;

// ── Shared bits ─────────────────────────────────────────────────────────────────
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
}

export function ScheduleBadge({ schedule }: { schedule: string }) {
  const tone =
    schedule === 'NARCOTIC' || schedule === 'PSYCHOTROPIC'
      ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400'
      : schedule === 'RX' || schedule === 'SCHEDULE_G'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
        : 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{schedule}</span>;
}

export function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return <span className="text-xs text-muted-foreground">no expiry</span>;
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86_400_000);
  const tone = days < 0 ? 'bg-rose-100 text-rose-700' : days <= 90 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
  const label = days < 0 ? 'expired' : `${days}d`;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>
      <span className="text-muted-foreground">{fmtDate(expiryDate)}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    RETURNED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
    VOID: 'bg-muted text-muted-foreground',
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    INACTIVE: 'bg-muted text-muted-foreground',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[status] ?? 'bg-muted text-muted-foreground'}`}>{status}</span>;
}

export const DISPENSE_LABEL: Record<string, string> = {
  RETAIL_SALE: 'Retail sale',
  RX: 'Prescription',
  HOSPITAL_ISSUE: 'Ward issue',
  WHOLESALE: 'Wholesale',
};

export function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>;
}
