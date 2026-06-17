'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Loader2, Store } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPut, apiUpload } from '@/lib/api';
import type { PosBranding } from '@/lib/types';
import { AuthImage } from '@/components/auth-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Admin card to set the store branding printed on every receipt — name, address, phone, footer line,
 * and a logo (stored in `app_attachment`). Writes are admin-gated server-side; non-admins simply get a
 * 403 on save. The logo preview reuses {@link AuthImage} (bearer-authenticated blob fetch).
 */
export function BrandingCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pos-branding'], queryFn: () => apiGet<PosBranding>('/pos/branding') });
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoVersion, setLogoVersion] = useState(0); // bust AuthImage cache after re-upload

  useEffect(() => {
    if (!q.data) return;
    setStoreName(q.data.storeName ?? '');
    setAddress(q.data.address ?? '');
    setPhone(q.data.phone ?? '');
    setReceiptFooter(q.data.receiptFooter ?? '');
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      apiPut<PosBranding>('/pos/branding', { storeName, address, phone, receiptFooter }),
    onSuccess: () => {
      toast.success('Receipt branding saved');
      void qc.invalidateQueries({ queryKey: ['pos-branding'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed (admin only)'),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiUpload<{ hasLogo: boolean }>('/pos/branding/logo', fd);
    },
    onSuccess: () => {
      toast.success('Logo updated');
      setLogoVersion((v) => v + 1);
      void qc.invalidateQueries({ queryKey: ['pos-branding'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Upload failed (admin only)'),
  });

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Store className="h-4 w-4" /> Receipt branding (admin)
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Shown at the top of every printed receipt — your store name, contact details, logo, and a footer line.
      </p>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
            {q.data?.hasLogo ? (
              <AuthImage
                key={logoVersion}
                path="/pos/branding/logo"
                alt="Store logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <Store className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageUp className="mr-2 h-4 w-4" />}
            {q.data?.hasLogo ? 'Replace logo' : 'Upload logo'}
          </Button>
        </div>
        <div className="grid gap-3">
          <Field label="Store name">
            <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="MetaXperts Store" />
          </Field>
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Market Rd, Lahore" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" />
          </Field>
          <Field label="Receipt footer">
            <Input value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} placeholder="Thank you for shopping!" />
          </Field>
          <div className="flex justify-end">
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save branding
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
