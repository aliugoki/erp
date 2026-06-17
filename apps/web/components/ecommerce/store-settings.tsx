'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImageUp, Loader2, Store } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, apiGet, apiPut, apiUpload } from '@/lib/api';
import type { EcStore } from '@/lib/types';
import { AuthImage } from '@/components/auth-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const toMinor = (major: string): number => Math.round((Number(major) || 0) * 100);
const toMajor = (minor?: number): string => (minor == null ? '' : String(minor / 100));

/** Store branding + publishing. The storefront goes live at /shop/<slug> once published. */
export function StoreSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ec-store'], queryFn: () => apiGet<EcStore>('/ecommerce/store') });
  const [f, setF] = useState({
    name: '', tagline: '', description: '', currency: 'PKR', accentColor: '#4f46e5',
    heroHeadline: '', heroSubtext: '', supportEmail: '', supportPhone: '', address: '',
    defaultTaxRate: '0', shippingFlat: '0', freeShippingOver: '',
  });
  const [published, setPublished] = useState(false);
  const [logoV, setLogoV] = useState(0);
  const [heroV, setHeroV] = useState(0);
  const logoRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = q.data;
    if (!s || !s.configured) return;
    setF({
      name: s.name ?? '', tagline: s.tagline ?? '', description: s.description ?? '', currency: s.currency ?? 'PKR',
      accentColor: s.accentColor ?? '#4f46e5', heroHeadline: s.heroHeadline ?? '', heroSubtext: s.heroSubtext ?? '',
      supportEmail: s.supportEmail ?? '', supportPhone: s.supportPhone ?? '', address: s.address ?? '',
      defaultTaxRate: String(s.defaultTaxRate ?? 0), shippingFlat: toMajor(s.shippingFlat?.amountMinor),
      freeShippingOver: toMajor(s.freeShippingOver?.amountMinor ?? undefined),
    });
    setPublished(!!s.published);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => apiPut<EcStore>('/ecommerce/store', {
      name: f.name || undefined, tagline: f.tagline, description: f.description, currency: f.currency,
      accentColor: f.accentColor, heroHeadline: f.heroHeadline, heroSubtext: f.heroSubtext,
      supportEmail: f.supportEmail || undefined, supportPhone: f.supportPhone, address: f.address,
      defaultTaxRate: Number(f.defaultTaxRate) || 0, shippingFlatMinor: toMinor(f.shippingFlat),
      freeShippingOverMinor: f.freeShippingOver ? toMinor(f.freeShippingOver) : undefined, published,
    }),
    onSuccess: () => { toast.success('Store saved'); void qc.invalidateQueries({ queryKey: ['ec-store'] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Save failed (admin only)'),
  });

  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: 'logo' | 'hero'; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiUpload(`/ecommerce/store/${kind}`, fd);
    },
    onSuccess: (_d, v) => {
      toast.success(`${v.kind} updated`);
      if (v.kind === 'logo') setLogoV((x) => x + 1); else setHeroV((x) => x + 1);
      void qc.invalidateQueries({ queryKey: ['ec-store'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Upload failed'),
  });

  const slug = q.data?.storefrontSlug;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* Publish bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div>
          <p className="font-medium">{published ? 'Your store is live' : 'Your store is hidden'}</p>
          <p className="text-sm text-muted-foreground">
            {slug ? <>Public URL: <code className="rounded bg-muted px-1.5 py-0.5">/shop/{slug}</code></> : 'Save the store to get its URL.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {slug ? (
            <a href={`/shop/${slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              View storefront <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Published</span>
            <Switch checked={published} onCheckedChange={setPublished} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Brand */}
        <div className="rounded-xl border p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Store className="h-4 w-4" /> Brand</h3>
          <div className="space-y-3">
            <Field label="Store name"><Input value={f.name} onChange={set('name')} placeholder="My Store" /></Field>
            <Field label="Tagline"><Input value={f.tagline} onChange={set('tagline')} placeholder="Quality goods, fast delivery" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency"><Input value={f.currency} onChange={set('currency')} maxLength={3} /></Field>
              <Field label="Accent color">
                <div className="flex items-center gap-2">
                  <input type="color" value={f.accentColor} onChange={set('accentColor')} className="h-9 w-12 cursor-pointer rounded border" />
                  <Input value={f.accentColor} onChange={set('accentColor')} />
                </div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ImageSlot label="Logo" version={logoV} src="/ecommerce/store/logo" has={!!q.data?.hasLogo} busy={upload.isPending} onPick={() => logoRef.current?.click()} />
              <ImageSlot label="Hero image" version={heroV} src="/ecommerce/store/hero" has={!!q.data?.hasHero} busy={upload.isPending} onPick={() => heroRef.current?.click()} />
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate({ kind: 'logo', file }); e.target.value = ''; }} />
            <input ref={heroRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate({ kind: 'hero', file }); e.target.value = ''; }} />
          </div>
        </div>

        {/* Storefront content + commerce */}
        <div className="space-y-6">
          <div className="rounded-xl border p-5">
            <h3 className="mb-4 text-sm font-semibold">Homepage hero</h3>
            <div className="space-y-3">
              <Field label="Headline"><Input value={f.heroHeadline} onChange={set('heroHeadline')} placeholder="Summer Collection" /></Field>
              <Field label="Subtext"><Input value={f.heroSubtext} onChange={set('heroSubtext')} placeholder="Up to 40% off selected items" /></Field>
              <Field label="Description"><Input value={f.description} onChange={set('description')} /></Field>
            </div>
          </div>
          <div className="rounded-xl border p-5">
            <h3 className="mb-4 text-sm font-semibold">Shipping, tax & support</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Flat shipping"><Input value={f.shippingFlat} onChange={set('shippingFlat')} inputMode="decimal" /></Field>
              <Field label="Free shipping over"><Input value={f.freeShippingOver} onChange={set('freeShippingOver')} inputMode="decimal" placeholder="(none)" /></Field>
              <Field label="Default tax %"><Input value={f.defaultTaxRate} onChange={set('defaultTaxRate')} inputMode="numeric" /></Field>
              <Field label="Support email"><Input value={f.supportEmail} onChange={set('supportEmail')} /></Field>
              <Field label="Support phone"><Input value={f.supportPhone} onChange={set('supportPhone')} /></Field>
              <Field label="Address"><Input value={f.address} onChange={set('address')} /></Field>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save store
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}

function ImageSlot({ label, src, has, version, busy, onPick }: { label: string; src: string; has: boolean; version: number; busy: boolean; onPick: () => void }) {
  return (
    <div className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <button type="button" onClick={onPick} disabled={busy} className="flex h-20 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30 hover:bg-muted/50">
        {has ? <AuthImage key={version} path={src} alt={label} className="h-full w-full object-contain" /> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><ImageUp className="h-4 w-4" /> Upload</span>}
      </button>
    </div>
  );
}
