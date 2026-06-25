'use client';
import { cn } from '@/lib/utils';

export interface ChipOption {
  value: string;
  label: string;
  hint?: string;
}

/** A compact multi-select rendered as toggle chips (used for picking roles / capabilities). */
export function ToggleChips({
  options,
  selected,
  onToggle,
}: {
  options: ChipOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => onToggle(o.value)}
            title={o.hint}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              on ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-accent',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
