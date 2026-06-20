'use client';
import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { apiBlob } from '@/lib/api';
import { cn } from '@/lib/utils';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

/** Renders an image from an auth-protected endpoint by fetching it as a Blob (with the bearer token)
 * and showing it via an object URL — since a plain <img src> can't send the Authorization header.
 * Shows a shimmer skeleton while loading, fades the image in once decoded, and falls back to a
 * polished gradient placeholder when there's no image or it can't load. */
export function AuthImage({ path, alt, className }: { path: string | null; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(path ? 'loading' : 'idle');

  useEffect(() => {
    setUrl(null);
    if (!path) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    let revoked = false;
    let obj: string | null = null;
    apiBlob(path)
      .then((b) => {
        if (revoked) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
        setStatus('loaded');
      })
      .catch(() => {
        if (!revoked) setStatus('error');
      });
    return () => {
      revoked = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [path]);

  if (url) {
    return <img src={url} alt={alt ?? ''} className={cn('animate-fade-in object-cover', className)} />;
  }
  if (status === 'loading') {
    return (
      <div className={cn('relative overflow-hidden bg-muted/50', className)} aria-hidden>
        <div className="shimmer absolute inset-0" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-muted/60 to-muted text-muted-foreground/60',
        className,
      )}
    >
      <ImageIcon className="size-1/4 opacity-70" strokeWidth={1.5} />
    </div>
  );
}
