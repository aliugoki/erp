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

export interface PharmacyDispenseCompletedV1 {
  dispenseId: string;
  dispenseNo: string;
  /** Dispense channel — drives revenue recognition (retail counter, prescription, ward issue, B2B). */
  type: 'RETAIL_SALE' | 'RX' | 'HOSPITAL_ISSUE' | 'WHOLESALE';
  /** Net total in minor units. */
  totalMinor: number;
  /** Cost of goods dispensed (weighted-average), for margin reporting + the GL cost side. */
  cogsMinor: number;
  currency: string;
  lineCount: number;
}

export interface PharmacyStockAdjustedV1 {
  adjustmentId: string;
  adjNo: string;
  /** RTV = return to vendor, WRITEOFF = expiry/damage, ADJUST = cycle-count correction. */
  type: 'RTV' | 'WRITEOFF' | 'ADJUST';
  /** Net inventory value moved in minor units (positive = inventory decreased). */
  valueMinor: number;
  currency: string;
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

export interface AssetDepreciationPostedV1 {
  runId: string;
  runNo: string;
  /** Period end date (YYYY-MM-DD) the depreciation belongs to. */
  period: string;
  assetCount: number;
  totalMinor: number;
  currency: string;
}

export interface EcommerceOrderPlacedV1 {
  orderId: string;
  orderNo: string;
  /** Linked CRM account (upserted from the customer email), if any. */
  clientId: string | null;
  /** COD or CARD — a CARD order is paid at placement; COD is collected on delivery. */
  paymentMethod: 'COD' | 'CARD';
  totalMinor: number;
  taxMinor: number;
  shippingMinor: number;
  /** Cost of goods sold captured at placement, for margin reporting + GL. */
  cogsMinor: number;
  currency: string;
  lineCount: number;
}

export interface EcommerceOrderStatusChangedV1 {
  orderId: string;
  orderNo: string;
  /** New fulfilment status (PENDING | PAID | FULFILLED | SHIPPED | CANCELLED | REFUNDED). */
  status: string;
  previousStatus: string;
}

export interface HelpdeskTicketCreatedV1 {
  ticketId: string;
  ticketNo: string;
  subject: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  requesterEmail: string;
  clientId: string | null;
  assignedTo: string | null;
  teamId: string | null;
}

export interface HelpdeskTicketAssignedV1 {
  ticketId: string;
  ticketNo: string;
  assignedTo: string;
}

export interface HelpdeskTicketRepliedV1 {
  ticketId: string;
  ticketNo: string;
  requesterEmail: string;
  /** Who sent the reply — an AGENT reply notifies the customer; a CUSTOMER reply notifies the agent. */
  authorType: 'AGENT' | 'CUSTOMER';
  assignedTo: string | null;
}

export interface HelpdeskTicketResolvedV1 {
  ticketId: string;
  ticketNo: string;
  requesterEmail: string;
  clientId: string | null;
}

export interface HelpdeskSlaBreachedV1 {
  ticketId: string;
  ticketNo: string;
  /** Which SLA target was missed. */
  breachType: 'FIRST_RESPONSE' | 'RESOLUTION';
  assignedTo: string | null;
  teamId: string | null;
}

export interface SubscriptionCreatedV1 {
  subscriptionId: string;
  subscriptionNo: string;
  planId: string;
  customerEmail: string;
  clientId: string | null;
  amountMinor: number;
  currency: string;
}

export interface SubscriptionInvoicePaidV1 {
  invoiceId: string;
  invoiceNo: string;
  subscriptionId: string;
  clientId: string | null;
  customerEmail: string;
  totalMinor: number;
  currency: string;
}

export interface SubscriptionPaymentFailedV1 {
  invoiceId: string;
  invoiceNo: string;
  subscriptionId: string;
  customerEmail: string;
  attemptCount: number;
  totalMinor: number;
  currency: string;
}

export interface SubscriptionCanceledV1 {
  subscriptionId: string;
  subscriptionNo: string;
  customerEmail: string;
  /** Why it ended — e.g. customer request or exhausted dunning attempts. */
  reason: 'CUSTOMER' | 'DUNNING' | 'ADMIN';
}

/** Canonical event type strings. */
export interface RestaurantOrderPlacedV1 {
  orderId: string;
  orderNo: string;
  branchId: string | null;
  channel: string;
  tableId: string | null;
  guestCount: number;
  totalMinor: number;
  currency: string;
  itemCount: number;
}

export interface RestaurantOrderConfirmedV1 {
  orderId: string;
  orderNo: string;
  branchId: string | null;
  ticketCount: number;
  stations: string[];
}

export interface RestaurantKdsTicketReadyV1 {
  orderId: string;
  ticketId: string;
  ticketNo: string;
  stationKey: string;
  branchId: string | null;
}

export interface RestaurantOrderServedV1 {
  orderId: string;
  orderNo: string;
  branchId: string | null;
}

export interface RestaurantBillSettledPaymentV1 {
  method: string;
  amountMinor: number;
  tipMinor: number;
}

/** The rich settlement event consumed by GL posting, inventory deduction, fiscalization and loyalty. */
export interface RestaurantBillSettledV1 {
  orderId: string;
  orderNo: string;
  branchId: string | null;
  channel: string;
  customerId: string | null;
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  tipMinor: number;
  roundingMinor: number;
  totalMinor: number;
  cogsMinor: number;
  currency: string;
  payments: RestaurantBillSettledPaymentV1[];
}

export interface RestaurantOrderVoidedV1 {
  orderId: string;
  orderNo: string;
  branchId: string | null;
  reason: string | null;
}

export interface RestaurantDeliveryAssignedV1 {
  orderId: string;
  deliveryId: string;
  deliveryNo: string;
  branchId: string | null;
  provider: string;
  driverEmployeeId: string | null;
  customerId: string | null;
  etaMinutes: number | null;
}

export interface RestaurantDeliveryCompletedV1 {
  orderId: string;
  deliveryId: string;
  deliveryNo: string;
  branchId: string | null;
  provider: string;
}

export interface RestaurantReservationCreatedV1 {
  reservationId: string;
  reservationNo: string;
  branchId: string | null;
  customerId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  partySize: number;
  reservedFor: string;
}

export const EVENT_TYPES = {
  INVENTORY_LOW_STOCK: 'inventory.low_stock.v1',
  FINANCE_INVOICE_PAID: 'finance.invoice_paid.v1',
  HR_EMPLOYEE_CREATED: 'hr.employee_created.v1',
  HR_LEAVE_APPROVED: 'hr.leave_approved.v1',
  HR_PAYROLL_RUN_COMPLETED: 'hr.payroll_run_completed.v1',
  CRM_DEAL_CLOSED: 'crm.deal_closed.v1',
  CRM_LEAD_CONVERTED: 'crm.lead_converted.v1',
  POS_SALE_COMPLETED: 'pos.sale_completed.v1',
  PHARMACY_DISPENSE_COMPLETED: 'pharmacy.dispense_completed.v1',
  PHARMACY_STOCK_ADJUSTED: 'pharmacy.stock_adjusted.v1',
  PRODUCTION_ORDER_COMPLETED: 'production.order_completed.v1',
  ASSET_DEPRECIATION_POSTED: 'asset.depreciation_posted.v1',
  ECOMMERCE_ORDER_PLACED: 'ecommerce.order_placed.v1',
  ECOMMERCE_ORDER_STATUS_CHANGED: 'ecommerce.order_status_changed.v1',
  HELPDESK_TICKET_CREATED: 'helpdesk.ticket_created.v1',
  HELPDESK_TICKET_ASSIGNED: 'helpdesk.ticket_assigned.v1',
  HELPDESK_TICKET_REPLIED: 'helpdesk.ticket_replied.v1',
  HELPDESK_TICKET_RESOLVED: 'helpdesk.ticket_resolved.v1',
  HELPDESK_SLA_BREACHED: 'helpdesk.sla_breached.v1',
  SUBSCRIPTION_CREATED: 'subscription.created.v1',
  SUBSCRIPTION_INVOICE_PAID: 'subscription.invoice_paid.v1',
  SUBSCRIPTION_PAYMENT_FAILED: 'subscription.payment_failed.v1',
  SUBSCRIPTION_CANCELED: 'subscription.canceled.v1',
  RESTAURANT_ORDER_PLACED: 'restaurant.order_placed.v1',
  RESTAURANT_ORDER_CONFIRMED: 'restaurant.order_confirmed.v1',
  RESTAURANT_KDS_TICKET_READY: 'restaurant.kds_ticket_ready.v1',
  RESTAURANT_ORDER_SERVED: 'restaurant.order_served.v1',
  RESTAURANT_BILL_SETTLED: 'restaurant.bill_settled.v1',
  RESTAURANT_ORDER_VOIDED: 'restaurant.order_voided.v1',
  RESTAURANT_DELIVERY_ASSIGNED: 'restaurant.delivery_assigned.v1',
  RESTAURANT_DELIVERY_COMPLETED: 'restaurant.delivery_completed.v1',
  RESTAURANT_RESERVATION_CREATED: 'restaurant.reservation_created.v1',
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
  'pharmacy.dispense_completed.v1': PharmacyDispenseCompletedV1;
  'pharmacy.stock_adjusted.v1': PharmacyStockAdjustedV1;
  'production.order_completed.v1': ProductionOrderCompletedV1;
  'asset.depreciation_posted.v1': AssetDepreciationPostedV1;
  'ecommerce.order_placed.v1': EcommerceOrderPlacedV1;
  'ecommerce.order_status_changed.v1': EcommerceOrderStatusChangedV1;
  'helpdesk.ticket_created.v1': HelpdeskTicketCreatedV1;
  'helpdesk.ticket_assigned.v1': HelpdeskTicketAssignedV1;
  'helpdesk.ticket_replied.v1': HelpdeskTicketRepliedV1;
  'helpdesk.ticket_resolved.v1': HelpdeskTicketResolvedV1;
  'helpdesk.sla_breached.v1': HelpdeskSlaBreachedV1;
  'subscription.created.v1': SubscriptionCreatedV1;
  'subscription.invoice_paid.v1': SubscriptionInvoicePaidV1;
  'subscription.payment_failed.v1': SubscriptionPaymentFailedV1;
  'subscription.canceled.v1': SubscriptionCanceledV1;
  'restaurant.order_placed.v1': RestaurantOrderPlacedV1;
  'restaurant.order_confirmed.v1': RestaurantOrderConfirmedV1;
  'restaurant.kds_ticket_ready.v1': RestaurantKdsTicketReadyV1;
  'restaurant.order_served.v1': RestaurantOrderServedV1;
  'restaurant.bill_settled.v1': RestaurantBillSettledV1;
  'restaurant.order_voided.v1': RestaurantOrderVoidedV1;
  'restaurant.delivery_assigned.v1': RestaurantDeliveryAssignedV1;
  'restaurant.delivery_completed.v1': RestaurantDeliveryCompletedV1;
  'restaurant.reservation_created.v1': RestaurantReservationCreatedV1;
}

export type EventType = keyof EventPayloads;

/** A fully-typed event for a known type. */
export type DomainEvent<K extends EventType = EventType> = BaseEvent<EventPayloads[K]> & { type: K };

/** The broker domain (exchange) an event belongs to — the first segment of its type. */
export function domainOf(type: string): string {
  return type.split('.')[0] ?? 'unknown';
}

export const EVENT_DOMAINS = ['hr', 'finance', 'inventory', 'crm', 'pos', 'production', 'asset', 'ecommerce', 'helpdesk', 'subscription', 'notifications', 'orders', 'restaurant'] as const;
