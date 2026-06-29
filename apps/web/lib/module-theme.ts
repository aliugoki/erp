import type { CSSProperties } from 'react';

/**
 * Per-module accent hues (HSL triplets). When the user is inside a module, the workspace re-tints its
 * accent (`--primary`/`--ring`/`--glow`/`--sidebar-accent`) to the module's colour — so each module
 * feels distinct while the base light/dark theme keeps owning backgrounds, surfaces and text. The
 * same hues tint each module's icon in the sidebar, giving a colourful but coherent nav.
 */
export const MODULE_ACCENTS: Record<string, string> = {
  hr: '221 83% 56%', // blue
  finance: '160 84% 39%', // emerald
  assets: '173 80% 36%', // teal
  inventory: '32 95% 48%', // amber
  production: '14 90% 55%', // orange
  pos: '189 94% 42%', // cyan
  pharmacy: '142 71% 42%', // green
  ecommerce: '330 81% 58%', // pink
  helpdesk: '199 89% 50%', // sky
  subscriptions: '256 90% 62%', // violet
  crm: '270 76% 60%', // purple
  projects: '243 75% 62%', // indigo
  reporting: '221 83% 56%', // blue
  analytics: '243 75% 62%', // indigo
  ai: '291 80% 60%', // fuchsia
  notifications: '221 83% 56%',
};

/** First path segment → module key (`/finance/x` → `finance`, `/` → `dashboard`). */
export function moduleKey(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
}

/** The CSS-var overrides to apply on the app shell for the current route (empty off-module). */
export function moduleAccentVars(pathname: string): CSSProperties {
  const accent = MODULE_ACCENTS[moduleKey(pathname)];
  if (!accent) return {};
  return {
    '--primary': accent,
    '--ring': accent,
    '--glow': accent,
    '--sidebar-accent': accent,
  } as CSSProperties;
}

/** A ready CSS colour for a module's accent (for icon tints etc.). */
export function moduleColor(key: string, alpha = 1): string | undefined {
  const a = MODULE_ACCENTS[key];
  return a ? `hsl(${a}${alpha < 1 ? ` / ${alpha}` : ''})` : undefined;
}

/** A brightened accent for use on the dark sidebar, where mid-tone hues read dim. Lifts lightness
 * (and a touch of saturation) so each module icon stays vivid against the near-black nav. */
export function moduleColorBright(key: string): string | undefined {
  const a = MODULE_ACCENTS[key];
  if (!a) return undefined;
  const [h, s, l] = a.replace(/%/g, '').split(/\s+/).map(Number);
  const bl = Math.min(72, Math.max(62, (l ?? 50) + 16));
  const bs = Math.min(95, (s ?? 70) + 6);
  return `hsl(${h} ${bs}% ${bl}%)`;
}
