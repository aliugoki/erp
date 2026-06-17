'use client';
import { useEffect } from 'react';

/** Registers the service worker so the app shell (and the POS terminal) work offline. Mounted once in
 * the root layout; no UI. Safe to no-op where service workers aren't available. */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failures are non-fatal — the app still works online */
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}
