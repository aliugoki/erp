'use client';
/** Client helpers + types for the public storefront (the unauthenticated `/shop/[slug]` pages). Calls
 * go through the same apiGet/apiPost (no token is attached when the visitor isn't logged in); images
 * are public URLs. The cart token + customer session token are kept in localStorage, namespaced per
 * store slug. */
import { API_URL, ApiError } from '@/lib/api';
import type { Money } from '@/lib/types';

export interface SfStore {
  name: string;
  tagline: string | null;
  description: string | null;
  currency: string;
  accentColor: string;
  hasLogo: boolean;
  hasHero: boolean;
  heroHeadline: string | null;
  heroSubtext: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  address: string | null;
  published: boolean;
}

export interface SfCollection {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  isFeatured: boolean;
  productCount?: number;
}

export interface SfVariant {
  id: string;
  label: string;
  isDefault: boolean;
  price: Money;
  compareAt: Money | null;
  onHand: number | null;
}

export interface SfReview {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
  verified: boolean;
  createdAt: string | null;
}

export interface SfProduct {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: string;
  isFeatured: boolean;
  price: Money;
  compareAt: Money | null;
  sku: string | null;
  category: string | null;
  onHand: number | null;
  primaryImageId: string | null;
  imageCount?: number;
  images?: { id: string; attachmentId: string; isPrimary: boolean }[];
  variants?: SfVariant[];
  reviews?: SfReview[];
  ratingAvg?: number;
  ratingCount?: number;
}

export interface SfHome {
  store: SfStore;
  collections: SfCollection[];
  featured: SfProduct[];
  newest: SfProduct[];
}

export interface SfCartItem {
  productId: string;
  variantId: string | null;
  variantLabel: string | null;
  slug: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  primaryImageId: string | null;
}

export interface SfCart {
  token: string;
  discountCode: string | null;
  currency: string;
  items: SfCartItem[];
  totals: { subtotalMinor: number; discountMinor: number; taxMinor: number; shippingMinor: number; totalMinor: number };
}

export interface SfOrderLine {
  id: string;
  title: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface SfPaymentSession {
  paymentId: string;
  clientSecret: string;
  provider: string;
  redirectUrl: string | null;
}
export interface SfPayment {
  id: string;
  orderNo: string | null;
  provider: string;
  status: string;
  amount: Money;
}

export interface SfOrder {
  id: string;
  orderNo: string;
  customerName: string;
  customerEmail: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: Money;
  discount: Money;
  tax: Money;
  shipping: Money;
  total: Money;
  placedAt: string | null;
  lines: SfOrderLine[];
}

export interface SfTicketMessage {
  id: string;
  authorType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
  authorName: string;
  body: string;
  createdAt: string | null;
}
export interface SfTicket {
  id: string;
  ticketNo: string;
  subject: string;
  status: string;
  priority: string;
  csatRating: number | null;
  lastActivityAt: string | null;
  createdAt: string | null;
  messages?: SfTicketMessage[];
}

export interface SfMoney { amountMinor: number; currency: string; }
export interface SfSubInvoice {
  id: string;
  invoiceNo: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: SfMoney;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
}
export interface SfSubscription {
  id: string;
  subscriptionNo: string;
  planName: string | null;
  status: string;
  amount: SfMoney;
  billingInterval: string;
  intervalCount: number;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  invoices?: SfSubInvoice[];
}

/** Build a storefront API path for the given slug. */
export const sfPath = (slug: string, p = ''): string => `/shop/${slug}${p}`;

/** Public image URLs (no auth — rendered directly in <img>). */
export const productImageUrl = (slug: string, imageId: string): string => `${API_URL}/shop/${slug}/images/${imageId}`;
export const storeLogoUrl = (slug: string): string => `${API_URL}/shop/${slug}/logo`;
export const storeHeroUrl = (slug: string): string => `${API_URL}/shop/${slug}/hero`;

export interface SfCustomer {
  id: string;
  email: string;
  name: string;
}
export interface SfAuthResult {
  token: string;
  customer: SfCustomer;
}

// ── Customer session token (per store) ──────────────────────────────────────────
const custKey = (slug: string): string => `mx_store_cust_${slug}`;
export function getCustomerToken(slug: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(custKey(slug));
}
export function setCustomerToken(slug: string, value: string): void {
  localStorage.setItem(custKey(slug), value);
}
export function clearCustomerToken(slug: string): void {
  localStorage.removeItem(custKey(slug));
}

/** GET a storefront endpoint with the customer session token attached (for /account/*). */
export async function customerGet<T>(slug: string, path: string): Promise<T> {
  return customerFetch<T>(slug, path, { method: 'GET' });
}

/** POST a storefront endpoint with the customer session token attached (e.g. submitting a review). */
export async function customerPost<T>(slug: string, path: string, body?: unknown): Promise<T> {
  return customerFetch<T>(slug, path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

async function customerFetch<T>(slug: string, path: string, init: RequestInit): Promise<T> {
  const tok = getCustomerToken(slug);
  const res = await fetch(`${API_URL}${sfPath(slug, path)}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: ['Bearer', tok].join(' ') } : {}), ...init.headers },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new ApiError(res.status, data.detail ?? data.title ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as { data?: T };
  return (json.data ?? (json as T)) as T;
}

// ── Cart token (per store) ──────────────────────────────────────────────────────
const cartKey = (slug: string): string => `mx_store_cart_${slug}`;
export function getCartToken(slug: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(cartKey(slug));
}
export function setCartToken(slug: string, token: string): void {
  localStorage.setItem(cartKey(slug), token);
}
export function clearCartToken(slug: string): void {
  localStorage.removeItem(cartKey(slug));
}
