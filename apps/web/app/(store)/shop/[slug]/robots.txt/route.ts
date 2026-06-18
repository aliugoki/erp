import { NextResponse } from 'next/server';

/** Per-store robots.txt — allow crawling the storefront and point at its sitemap. */
export function GET(req: Request, { params }: { params: { slug: string } }) {
  const origin = new URL(req.url).origin;
  const body =
    `User-agent: *\n` +
    `Allow: /shop/${params.slug}\n` +
    `Sitemap: ${origin}/shop/${params.slug}/sitemap.xml\n`;
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
