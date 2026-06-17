/**
 * Versioned domain event contracts (ADR-004 / ADR-005 A5). Every event type is `domain.event.vN`.
 * Breaking payload changes add a new `.v(N+1)` type; additive changes don't. The `EventPayloads` map
 * binds each type to its payload, so publishing/subscribing with a mismatched payload fails typecheck.
 */
import type { BaseEvent } from './index';

export interface InventoryLowStockV1 {
  productId: string;
  onHand: number;
  minStock: number;
}

export interface FinanceInvoicePaidV1 {
  invoiceId: string;
  number: string;
  clientId: string | null;
  totalMinor: number;
  currency: string;
}

export interface HrEmployeeCreatedV1 {
  employeeId: string;
  employeeCode: string;
  departmentId: string | null;
}

export interface HrLeaveApprovedV1 {
  leaveRequestId: string;
  employeeId: string;
  leaveTypeId: string;
  days: number;
  startDate: string;
  endDate: string;
  approverId?: string | null;
}

export interface HrPayrollRunCompletedV1 {
  runId: string;
  periodYear: number;
  periodMonth: number;
  employeeCount: number;
  totalNetMinor: number;
  currency: string;
}

export interface CrmDealClosedV1 {
  dealId: string;
  title: string;
  clientId: string;
  valueMinor: number;
  currency: string;
  /** User the deal is assigned to, if any — the notification recipient (additive, optional). */
  assignedTo?: string | null;
}

export interface CrmLeadConvertedV1 {
  leadId: string;
  /** The account (crm_client) the lead became. */
  clientId: string;
  /** The opportunity created from the lead, if one was requested. */
  dealId?: string | null;
  valueMinor: number;
  currency: string;
  ownerId?: string | null;
}

export interface PosSaleCompletedV1 {
  saleId: string;
  saleNo: string;
  registerId: string;
  shiftId: string;
  clientId: string | null;
  /** SALE or RETURN — a return is a refund of an earlier sale. */
  type: 'SALE' | 'RETURN';
  /** Net total in minor units (negative-effect returns still carry a positive total here). */
  totalMinor: number;
  /** Cost of goods sold captured at sale time, for margin reporting. */
  cogsMinor: number;
  currency: string;
  lineCount: number;
}

export interface ProductionOrderCompletedV1 {
  orderId: string;
  orderNo: string;
  /** Finished-good product produced. */
  productId: string;
  producedQty: number;
  materialCostMinor: number;
  operationCostMinor: number;
  overheadMinor: number;
  totalCostMinor: number;
  unitCostMinor: number;
  currency: string;
}

/** Canonical event type strings. */
export const EVENT_TYPES = {
  INVENTORY_LOW_STOCK: 'inventory.low_stock.v1',
  FINANCE_INVOICE_PAID: 'finance.invoice_paid.v1',
  HR_EMPLOYEE_CREATED: 'hr.employee_created.v1',
  HR_LEAVE_APPROVED: 'hr.leave_approved.v1',
  HR_PAYROLL_RUN_COMPLETED: 'hr.payroll_run_completed.v1',
  CRM_DEAL_CLOSED: 'crm.deal_closed.v1',
  CRM_LEAD_CONVERTED: 'crm.lead_converted.v1',
  POS_SALE_COMPLETED: 'pos.sale_completed.v1',
  PRODUCTION_ORDER_COMPLETED: 'production.order_completed.v1',
} as const;

/** Type → payload binding. The source of truth for typed publish/subscribe. */
export interface EventPayloads {
  'inventory.low_stock.v1': InventoryLowStockV1;
  'finance.invoice_paid.v1': FinanceInvoicePaidV1;
  'hr.employee_created.v1': HrEmployeeCreatedV1;
  'hr.leave_approved.v1': HrLeaveApprovedV1;
  'hr.payroll_run_completed.v1': HrPayrollRunCompletedV1;
  'crm.deal_closed.v1': CrmDealClosedV1;
  'crm.lead_converted.v1': CrmLeadConvertedV1;
  'pos.sale_completed.v1': PosSaleCompletedV1;
  'production.order_completed.v1': ProductionOrderCompletedV1;
}

export type EventType = keyof EventPayloads;

/** A fully-typed event for a known type. */
export type DomainEvent<K extends EventType = EventType> = BaseEvent<EventPayloads[K]> & { type: K };

/** The broker domain (exchange) an event belongs to — the first segment of its type. */
export function domainOf(type: string): string {
  return type.split('.')[0] ?? 'unknown';
}

export const EVENT_DOMAINS = ['hr', 'finance', 'inventory', 'crm', 'pos', 'production', 'notifications', 'orders'] as const;
