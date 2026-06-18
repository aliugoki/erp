import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3300';

interface SeoProduct {
  title: string;
  subtitle: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  primaryImageId: string | null;
}

/** Server-rendered SEO/OpenGraph for a product page — search engines and social cards see real tags
 * without running the client app. Falls back to the product's own title/description. */
export async function generateMetadata({ params }: { params: { slug: string; productSlug: string } }): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/shop/${params.slug}/products/${params.productSlug}`, { next: { revalidate: 300 } });
    if (!res.ok) return { title: 'Product' };
    const p = ((await res.json()) as { data?: SeoProduct }).data;
    if (!p) return { title: 'Product' };
    const title = p.seoTitle?.trim() || p.title;
    const description = (p.seoDescription?.trim() || p.subtitle || p.description || `Buy ${p.title} online.`).slice(0, 300);
    const images = p.primaryImageId ? [`${API}/shop/${params.slug}/images/${p.primaryImageId}`] : undefined;
    return {
      title,
      description,
      openGraph: { title, description, type: 'website', images },
      twitter: { card: images ? 'summary_large_image' : 'summary', title, description, images },
    };
  } catch {
    return { title: 'Product' };
  }
}

export default function ProductLayout({ children }: { children: ReactNode }) {
  return children;
}
