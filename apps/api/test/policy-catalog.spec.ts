import { describe, expect, it } from 'vitest';
import { POLICY_CATALOG, POLICY_BY_KEY, coercePolicyValue } from '../src/modules/policy/policy-catalog';

describe('policy catalog + value coercion', () => {
  it('every catalog entry has a unique key and a default matching its type', () => {
    const keys = new Set<string>();
    for (const p of POLICY_CATALOG) {
      expect(keys.has(p.key), `dup key ${p.key}`).toBe(false);
      keys.add(p.key);
      if (p.type === 'boolean') expect(typeof p.default).toBe('boolean');
      if (p.type === 'number' || p.type === 'money') expect(typeof p.default).toBe('number');
      if (p.type === 'enum') {
        expect(p.options && p.options.length).toBeTruthy();
        expect(p.options).toContain(p.default);
      }
    }
  });

  it('boolean policy accepts booleans, rejects others', () => {
    const def = POLICY_BY_KEY['inventory.allow_negative_stock'];
    expect(coercePolicyValue(def, true)).toBe(true);
    expect(() => coercePolicyValue(def, 'yes')).toThrow();
  });

  it('money policy requires non-negative integer minor units', () => {
    const def = POLICY_BY_KEY['finance.voucher_approval_threshold_minor'];
    expect(coercePolicyValue(def, 50000)).toBe(50000);
    expect(() => coercePolicyValue(def, 12.5)).toThrow(); // not integer minor
    expect(() => coercePolicyValue(def, -1)).toThrow(); // below min
  });

  it('number policy honours min/max bounds', () => {
    const def = POLICY_BY_KEY['crm.discount_cap_percent'];
    expect(coercePolicyValue(def, 30)).toBe(30);
    expect(() => coercePolicyValue(def, 101)).toThrow(); // above max 100
  });
});
