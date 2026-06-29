import { createHash } from 'node:crypto';
import { generate, generateSecret } from 'otplib';
import { describe, expect, it, vi } from 'vitest';
import { TwoFactorService } from '../src/modules/auth/two-factor.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A tenantTx stub whose manager.query returns a fixed user row and records UPDATEs. */
function stub(row: Record<string, unknown>) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (/^SELECT/i.test(sql.trim())) return [row];
      updates.push({ sql, params });
      return [];
    }),
  };
  const tenantTx = { runFor: (_t: string, fn: (m: unknown) => unknown) => Promise.resolve(fn(manager)) } as never;
  return { tenantTx, updates };
}

describe('TwoFactorService', () => {
  it('verifyForUser accepts a valid current TOTP, rejects a wrong one', async () => {
    const seed = generateSecret();
    const token = await generate({ secret: seed });
    const { tenantTx } = stub({ email: 'a@b.test', twofa_enabled: true, twofa_secret: seed, twofa_recovery_codes: [] });
    const svc = new TwoFactorService(tenantTx);
    expect(await svc.verifyForUser('u1', 't1', token)).toBe(true);
    expect(await svc.verifyForUser('u1', 't1', '000000')).toBe(false);
  });

  it('verifyForUser consumes a matching recovery code (one-time)', async () => {
    const recovery = 'abcde-12345';
    const { tenantTx, updates } = stub({ email: 'a@b.test', twofa_enabled: true, twofa_secret: 'AAAA', twofa_recovery_codes: [sha256(recovery)] });
    const svc = new TwoFactorService(tenantTx);
    expect(await svc.verifyForUser('u1', 't1', recovery)).toBe(true);
    const consume = updates.find((u) => /twofa_recovery_codes/.test(u.sql));
    expect(consume).toBeTruthy();
    expect(JSON.parse(consume!.params[0] as string)).toEqual([]); // matched hash removed
  });

  it('enable verifies the first code then returns 10 recovery codes', async () => {
    const seed = generateSecret();
    const token = await generate({ secret: seed });
    const { tenantTx } = stub({ email: 'a@b.test', twofa_enabled: false, twofa_secret: seed, twofa_recovery_codes: null });
    const out = await new TwoFactorService(tenantTx).enable('u1', 't1', token);
    expect(out.recoveryCodes).toHaveLength(10);
    expect(out.recoveryCodes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });

  it('rejects enable with an invalid code', async () => {
    const seed = generateSecret();
    const { tenantTx } = stub({ email: 'a@b.test', twofa_enabled: false, twofa_secret: seed, twofa_recovery_codes: null });
    await expect(new TwoFactorService(tenantTx).enable('u1', 't1', '000000')).rejects.toThrow('Invalid code');
  });
});
