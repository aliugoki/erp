'use client';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const THEMES = [
  { key: 'light', name: 'Light', swatch: 'hsl(221 83% 53%)' },
  { key: 'dark', name: 'Dark', swatch: 'hsl(217 91% 60%)' },
  { key: 'midnight', name: 'Midnight', swatch: 'hsl(258 90% 66%)' },
  { key: 'emerald', name: 'Emerald', swatch: 'hsl(160 84% 32%)' },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Button variant="ghost" size="icon" aria-label="Theme" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Choose theme">
          <Palette className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.key} onClick={() => setTheme(t.key)}>
            <span className="size-3 rounded-full" style={{ background: t.swatch }} />
            <span className="flex-1">{t.name}</span>
            {theme === t.key ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
