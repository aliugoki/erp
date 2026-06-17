import type { MetadataRoute } from 'next';

/** PWA manifest — lets the ERP (especially the POS terminal) be installed to a device and run
 * offline. Served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MetaXperts ERP',
    short_name: 'MetaXperts',
    description: 'Multi-tenant ERP — POS works offline and syncs when reconnected.',
    start_url: '/pos',
    display: 'standalone',
    background_color: '#0b0b0f',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
