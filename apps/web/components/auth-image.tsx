'use client';
import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { apiBlob } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Renders an image from an auth-protected endpoint by fetching it as a Blob (with the bearer token)
 * and showing it via an object URL — since a plain <img src> can't send the Authorization header.
 * Falls back to a placeholder when there's no image or it can't load. */
export function AuthImage({ path, alt, className }: { path: string | null; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let revoked = false;
    let obj: string | null = null;
    apiBlob(path)
      .then((b) => {
        if (revoked) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [path]);

  if (url) {
    return <img src={url} alt={alt ?? ''} className={cn('object-cover', className)} />;
  }
  return (
    <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
      <ImageIcon className="size-1/3 opacity-50" />
    </div>
  );
}
