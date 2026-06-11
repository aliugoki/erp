'use client';
import { LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeSwitcher } from '@/components/theme-switcher';

export function Topbar({ title }: { title: string }) {
  const { user, logout } = useAuth();
  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-1">
        <ThemeSwitcher />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserIcon className="size-4" />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[16rem]">
            <DropdownMenuLabel>Signed in</DropdownMenuLabel>
            <div className="px-2 pb-2 text-xs text-muted-foreground">
              <p className="truncate">User: {user?.userId.slice(0, 8)}…</p>
              <p className="truncate">Tenant: {user?.tenantId.slice(0, 8)}…</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {user?.roles.map((r) => (
                  <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                    {r}
                  </span>
                ))}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
