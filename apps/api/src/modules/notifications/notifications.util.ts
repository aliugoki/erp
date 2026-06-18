import type {
  CrmDealClosedV1,
  CrmLeadConvertedV1,
  EcommerceOrderPlacedV1,
  FinanceInvoicePaidV1,
  HrLeaveApprovedV1,
  HrPayrollRunCompletedV1,
  InventoryLowStockV1,
  ProductionOrderCompletedV1,
} from '@metaxperts/shared';

export const NOTIFICATION_CATEGORIES = ['crm', 'inventory', 'finance', 'hr', 'production', 'ecommerce', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type Severity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

/** A built notification message, independent of who receives it. */
export interface NotificationDraft {
  type: string;
  title: string;
  body: string;
  severity: Severity;
  category: NotificationCategory;
  link: string | null;
}

export function formatMinor(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Pure event → message builders (testable; recipient resolution lives in the consumer) ────────────
export function dealWonDraft(p: CrmDealClosedV1): NotificationDraft {
  return {
    type: 'crm.deal_won',
    title: `Deal won: ${p.title}`,
    body: `Closed-won at ${formatMinor(p.valueMinor, p.currency)}.`,
    severity: 'SUCCESS',
    category: 'crm',
    link: '/crm',
  };
}

export function leadConvertedDraft(p: CrmLeadConvertedV1): NotificationDraft {
  return {
    type: 'crm.lead_converted',
    title: 'Lead converted to an account',
    body: p.dealId ? `A new opportunity worth ${formatMinor(p.valueMinor, p.currency)} was created.` : 'The lead became a customer account.',
    severity: 'SUCCESS',
    category: 'crm',
    link: '/crm/leads',
  };
}

export function lowStockDraft(p: InventoryLowStockV1, productName?: string | null): NotificationDraft {
  return {
    type: 'inventory.low_stock',
    title: `Low stock: ${productName ?? 'product'}`,
    body: `On hand ${p.onHand}, below the minimum of ${p.minStock}. Consider reordering.`,
    severity: 'WARNING',
    category: 'inventory',
    link: '/inventory',
  };
}

export function invoicePaidDraft(p: FinanceInvoicePaidV1): NotificationDraft {
  return {
    type: 'finance.invoice_paid',
    title: `Invoice paid: ${p.number}`,
    body: `Payment of ${formatMinor(p.totalMinor, p.currency)} received.`,
    severity: 'SUCCESS',
    category: 'finance',
    link: '/finance',
  };
}

export function leaveApprovedDraft(p: HrLeaveApprovedV1): NotificationDraft {
  return {
    type: 'hr.leave_approved',
    title: 'Leave request approved',
    body: `${p.days} day(s) approved (${p.startDate} → ${p.endDate}).`,
    severity: 'INFO',
    category: 'hr',
    link: '/hr/leave',
  };
}

export function payrollDraft(p: HrPayrollRunCompletedV1): NotificationDraft {
  return {
    type: 'hr.payroll_run_completed',
    title: `Payroll completed: ${p.periodYear}-${String(p.periodMonth).padStart(2, '0')}`,
    body: `${p.employeeCount} employee(s), net ${formatMinor(p.totalNetMinor, p.currency)}.`,
    severity: 'INFO',
    category: 'hr',
    link: '/hr/payroll',
  };
}

export function ecommerceOrderDraft(p: EcommerceOrderPlacedV1): NotificationDraft {
  return {
    type: 'ecommerce.order_placed',
    title: `New online order: ${p.orderNo}`,
    body: `${p.lineCount} item(s), ${formatMinor(p.totalMinor, p.currency)} — ${p.paymentMethod === 'CARD' ? 'paid by card' : 'cash on delivery'}.`,
    severity: 'SUCCESS',
    category: 'ecommerce',
    link: '/ecommerce',
  };
}

export function productionCompletedDraft(p: ProductionOrderCompletedV1): NotificationDraft {
  return {
    type: 'production.order_completed',
    title: `Production complete: ${p.orderNo}`,
    body: `${p.producedQty} unit(s) received at ${formatMinor(p.unitCostMinor, p.currency)}/unit.`,
    severity: 'SUCCESS',
    category: 'production',
    link: '/production',
  };
}
