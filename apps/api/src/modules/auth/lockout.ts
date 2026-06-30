/** Pure account-lockout policy — no I/O, so it's unit-testable. */

export interface FailedState {
  attempts: number;
  lockedUntil: Date | null;
}

/** Given the current consecutive-failure count, decide the next state after one more failure. On
 * reaching `maxAttempts` the account locks for `lockoutMinutes` and the counter resets to 0. */
export function nextFailedState(currentCount: number, maxAttempts: number, lockoutMinutes: number, now: Date): FailedState {
  const next = Math.max(0, currentCount) + 1;
  if (next >= maxAttempts) {
    return { attempts: 0, lockedUntil: new Date(now.getTime() + lockoutMinutes * 60_000) };
  }
  return { attempts: next, lockedUntil: null };
}

/** True while a lock is still in effect. */
export function isLocked(lockedUntil: Date | string | null | undefined, now: Date): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > now.getTime();
}
