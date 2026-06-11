'use client';
import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === 'midnight';
  return (
    <Sonner
      theme={isDark ? 'dark' : 'light'}
      position="top-right"
      toastOptions={{
        classNames: {
          toast: 'group rounded-xl border bg-card text-card-foreground shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
