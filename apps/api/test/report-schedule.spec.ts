import { describe, expect, it } from 'vitest';
import { computeNextRun } from '../src/modules/reporting/report-schedule.util';

const iso = (d: Date) => d.toISOString();

describe('computeNextRun', () => {
  it('daily: same day if the time is still ahead, else next day', () => {
    const from = new Date('2026-06-25T06:00:00Z');
    expect(iso(computeNextRun({ frequency: 'daily', hour: 8, minute: 30 }, from))).toBe('2026-06-25T08:30:00.000Z');
    const afternoon = new Date('2026-06-25T09:00:00Z');
    expect(iso(computeNextRun({ frequency: 'daily', hour: 8, minute: 30 }, afternoon))).toBe('2026-06-26T08:30:00.000Z');
  });

  it('weekly: advances to the target weekday (and rolls a full week when due now)', () => {
    // 2026-06-25 is a Thursday (UTC getUTCDay = 4). Target Monday (1).
    const from = new Date('2026-06-25T06:00:00Z');
    expect(iso(computeNextRun({ frequency: 'weekly', hour: 9, minute: 0, dayOfWeek: 1 }, from))).toBe('2026-06-29T09:00:00.000Z');
    // Same weekday, but the time already passed → +7 days.
    const thuLate = new Date('2026-06-25T10:00:00Z');
    expect(iso(computeNextRun({ frequency: 'weekly', hour: 9, minute: 0, dayOfWeek: 4 }, thuLate))).toBe('2026-07-02T09:00:00.000Z');
  });

  it('monthly: this month if the day is ahead, else next month', () => {
    const from = new Date('2026-06-25T06:00:00Z');
    expect(iso(computeNextRun({ frequency: 'monthly', hour: 7, minute: 0, dayOfMonth: 28 }, from))).toBe('2026-06-28T07:00:00.000Z');
    const past = new Date('2026-06-25T06:00:00Z');
    expect(iso(computeNextRun({ frequency: 'monthly', hour: 7, minute: 0, dayOfMonth: 1 }, past))).toBe('2026-07-01T07:00:00.000Z');
  });

  it('clamps out-of-range fields', () => {
    const from = new Date('2026-06-25T06:00:00Z');
    const r = computeNextRun({ frequency: 'daily', hour: 99, minute: 99 }, from);
    expect(r.getUTCHours()).toBe(23);
    expect(r.getUTCMinutes()).toBe(59);
  });
});
