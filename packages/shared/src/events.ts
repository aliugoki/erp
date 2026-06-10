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

export interface CrmDealClosedV1 {
  dealId: string;
  title: string;
  clientId: string;
  valueMinor: number;
  currency: string;
}

/** Canonical event type strings. */
export const EVENT_TYPES = {
  INVENTORY_LOW_STOCK: 'inventory.low_stock.v1',
  FINANCE_INVOICE_PAID: 'finance.invoice_paid.v1',
  HR_EMPLOYEE_CREATED: 'hr.employee_created.v1',
  CRM_DEAL_CLOSED: 'crm.deal_closed.v1',
} as const;

/** Type → payload binding. The source of truth for typed publish/subscribe. */
export interface EventPayloads {
  'inventory.low_stock.v1': InventoryLowStockV1;
  'finance.invoice_paid.v1': FinanceInvoicePaidV1;
  'hr.employee_created.v1': HrEmployeeCreatedV1;
  'crm.deal_closed.v1': CrmDealClosedV1;
}

export type EventType = keyof EventPayloads;

/** A fully-typed event for a known type. */
export type DomainEvent<K extends EventType = EventType> = BaseEvent<EventPayloads[K]> & { type: K };

/** The broker domain (exchange) an event belongs to — the first segment of its type. */
export function domainOf(type: string): string {
  return type.split('.')[0] ?? 'unknown';
}

export const EVENT_DOMAINS = ['hr', 'finance', 'inventory', 'crm', 'notifications'] as const;
