import { describe, expect, it } from 'vitest';
import { isLocked, nextFailedState } from '../src/modules/auth/lockout';

const NOW = new Date('2026-06-29T12:00:00Z');

describe('account lockout policy', () => {
  it('counts up to the threshold, then locks and resets the counter', () => {
    expect(nextFailedState(0, 5, 15, NOW)).toEqual({ attempts: 1, lockedUntil: null });
    expect(nextFailedState(3, 5, 15, NOW)).toEqual({ attempts: 4, lockedUntil: null });
    // 5th consecutive failure (count 4 → 5) hits the threshold → lock for 15 minutes, counter resets.
    const locked = nextFailedState(4, 5, 15, NOW);
    expect(locked.attempts).toBe(0);
    expect(locked.lockedUntil?.toISOString()).toBe('2026-06-29T12:15:00.000Z');
  });

  it('isLocked is true only while the lock window is in the future', () => {
    expect(isLocked(null, NOW)).toBe(false);
    expect(isLocked('2026-06-29T12:10:00Z', NOW)).toBe(true);
    expect(isLocked('2026-06-29T11:59:00Z', NOW)).toBe(false); // already expired
  });
});
