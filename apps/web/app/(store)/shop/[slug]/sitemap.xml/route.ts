import { NextResponse } from 'next/server';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3300';

/** Per-store XML sitemap — home, catalogue, and every active product, for search engines. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const origin = new URL(req.url).origin;
  const base = `${origin}/shop/${params.slug}`;
  let products: Array<{ slug: string }> = [];
  try {
    const res = await fetch(`${API}/shop/${params.slug}/products`, { next: { revalidate: 300 } });
    if (res.ok) products = (((await res.json()) as { data?: Array<{ slug: string }> }).data ?? []);
  } catch {
    /* return a minimal sitemap if the API is unreachable */
  }
  const urls = [base, `${base}/products`, ...products.map((p) => `${base}/products/${p.slug}`)];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
  return new NextResponse(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
