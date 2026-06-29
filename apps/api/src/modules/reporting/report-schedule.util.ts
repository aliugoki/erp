export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface ScheduleTiming {
  frequency: Frequency;
  hour: number; // 0–23 (UTC)
  minute: number; // 0–59
  dayOfWeek?: number | null; // 0 (Sun) – 6, for weekly
  dayOfMonth?: number | null; // 1–28, for monthly
}

/**
 * The next UTC fire time strictly after `from` for a schedule. All arithmetic is in UTC so it is
 * deterministic and DST-free. Pure — `from` is injected (no clock read), so it's unit-testable.
 */
export function computeNextRun(t: ScheduleTiming, from: Date): Date {
  const hour = clamp(t.hour, 0, 23);
  const minute = clamp(t.minute, 0, 59);

  if (t.frequency === 'weekly') {
    const targetDow = clamp(t.dayOfWeek ?? 1, 0, 6);
    const next = atUtc(from, hour, minute);
    let add = (targetDow - next.getUTCDay() + 7) % 7;
    if (add === 0 && next <= from) add = 7;
    next.setUTCDate(next.getUTCDate() + add);
    return next;
  }

  if (t.frequency === 'monthly') {
    const dom = clamp(t.dayOfMonth ?? 1, 1, 28);
    const next = atUtc(from, hour, minute);
    next.setUTCDate(dom);
    if (next <= from) next.setUTCMonth(next.getUTCMonth() + 1, dom);
    return next;
  }

  // daily
  const next = atUtc(from, hour, minute);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function atUtc(base: Date, hour: number, minute: number): Date {
  const d = new Date(base.getTime());
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}
