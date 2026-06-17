'use client';
/** Client helpers + types for the public storefront (the unauthenticated `/shop/[slug]` pages). Calls
 * go through the same apiGet/apiPost (no token is attached when the visitor isn't logged in); images
 * are public URLs. The cart token is kept in localStorage, namespaced per store slug. */
import { API_URL } from '@/lib/api';
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

export interface SfProduct {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  status: string;
  isFeatured: boolean;
  price: Money;
  compareAt: Money | null;
  sku: string | null;
  onHand: number | null;
  primaryImageId: string | null;
  imageCount?: number;
  images?: { id: string; attachmentId: string; isPrimary: boolean }[];
}

export interface SfHome {
  store: SfStore;
  collections: SfCollection[];
  featured: SfProduct[];
  newest: SfProduct[];
}

export interface SfCartItem {
  productId: string;
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

/** Build a storefront API path for the given slug. */
export const sfPath = (slug: string, p = ''): string => `/shop/${slug}${p}`;

/** Public image URLs (no auth — rendered directly in <img>). */
export const productImageUrl = (slug: string, imageId: string): string => `${API_URL}/shop/${slug}/images/${imageId}`;
export const storeLogoUrl = (slug: string): string => `${API_URL}/shop/${slug}/logo`;
export const storeHeroUrl = (slug: string): string => `${API_URL}/shop/${slug}/hero`;

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
