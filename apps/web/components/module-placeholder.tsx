import { Construction } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/** Placeholder for modules whose UI screens are still being built — the backend APIs already exist. */
export function ModulePlaceholder({ name, note }: { name: string; note: string }) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Construction className="size-6" />
          </div>
          <h2 className="text-xl font-semibold">{name}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{note}</p>
        </CardContent>
      </Card>
    </div>
  );
}
