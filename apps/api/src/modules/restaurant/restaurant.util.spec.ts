import { describe, expect, it } from 'vitest';
import {
  canTransitionDelivery,
  canTransitionReservation,
  canTransitionTable,
  computeMenuLine,
  formatDocNo,
  money,
  normalisePhone,
  opensDeliveryJob,
  phoneSearchKey,
  recipeConsumedMilli,
  resolveMenuPrice,
  rowsOf,
} from './restaurant.util';

describe('restaurant.util', () => {
  describe('money', () => {
    it('wraps a minor amount with a currency', () => {
      expect(money(1500, 'PKR')).toEqual({ amountMinor: 1500, currency: 'PKR' });
    });
    it('coerces null/undefined to zero', () => {
      expect(money(null)).toEqual({ amountMinor: 0, currency: 'PKR' });
      expect(money(undefined)).toEqual({ amountMinor: 0, currency: 'PKR' });
    });
  });

  describe('formatDocNo', () => {
    it('zero-pads to six digits with a prefix', () => {
      expect(formatDocNo('ORD', 4)).toBe('ORD-000004');
      expect(formatDocNo('KOT', 123456)).toBe('KOT-123456');
    });
  });

  describe('computeMenuLine', () => {
    it('prices a plain line with no modifiers, discount or tax', () => {
      expect(computeMenuLine({ qty: 2, unitPriceMinor: 50000 })).toEqual({
        grossMinor: 100000,
        discountMinor: 0,
        taxableMinor: 100000,
        taxMinor: 0,
        lineTotalMinor: 100000,
      });
    });

    it('adds per-unit modifier deltas before multiplying by qty', () => {
      // (500 base + 100 extra cheese) × 3 = 1800
      const line = computeMenuLine({ qty: 3, unitPriceMinor: 500, modifierUnitMinor: 100 });
      expect(line.grossMinor).toBe(1800);
    });

    it('applies PRA 16% services tax on the post-discount amount (floored)', () => {
      // gross 100000, discount 10000, taxable 90000, tax floor(90000*1600/10000)=14400
      const line = computeMenuLine({ qty: 1, unitPriceMinor: 100000, discountMinor: 10000, taxBp: 1600 });
      expect(line).toMatchObject({ taxableMinor: 90000, taxMinor: 14400, lineTotalMinor: 104400 });
    });

    it('clamps discount to the gross and never goes negative on unit price', () => {
      const line = computeMenuLine({ qty: 1, unitPriceMinor: 100, modifierUnitMinor: -500, discountMinor: 9999 });
      expect(line.grossMinor).toBe(0); // unit floored at 0
      expect(line.discountMinor).toBe(0); // nothing to discount
      expect(line.lineTotalMinor).toBe(0);
    });
  });

  describe('resolveMenuPrice', () => {
    it('uses the base price when there is no branch override', () => {
      expect(resolveMenuPrice(50000, null)).toBe(50000);
      expect(resolveMenuPrice(50000, undefined)).toBe(50000);
    });
    it('prefers the branch override when set (including zero)', () => {
      expect(resolveMenuPrice(50000, 45000)).toBe(45000);
      expect(resolveMenuPrice(50000, 0)).toBe(0);
    });
  });

  describe('canTransitionTable', () => {
    it('allows a same-status no-op', () => {
      expect(canTransitionTable('OCCUPIED', 'OCCUPIED')).toBe(true);
    });
    it('allows seating an available or reserved table', () => {
      expect(canTransitionTable('AVAILABLE', 'OCCUPIED')).toBe(true);
      expect(canTransitionTable('RESERVED', 'OCCUPIED')).toBe(true);
    });
    it('requires cleaning before an occupied table becomes available', () => {
      expect(canTransitionTable('OCCUPIED', 'AVAILABLE')).toBe(true);
      expect(canTransitionTable('CLEANING', 'OCCUPIED')).toBe(false);
    });
  });

  describe('canTransitionDelivery', () => {
    it('walks the happy own-fleet path', () => {
      expect(canTransitionDelivery('PENDING', 'ASSIGNED')).toBe(true);
      expect(canTransitionDelivery('ASSIGNED', 'PICKED_UP')).toBe(true);
      expect(canTransitionDelivery('PICKED_UP', 'EN_ROUTE')).toBe(true);
      expect(canTransitionDelivery('EN_ROUTE', 'DELIVERED')).toBe(true);
    });
    it('allows delivering straight from picked-up (no en-route ping)', () => {
      expect(canTransitionDelivery('PICKED_UP', 'DELIVERED')).toBe(true);
    });
    it('rejects skipping pickup or moving backwards', () => {
      expect(canTransitionDelivery('PENDING', 'PICKED_UP')).toBe(false);
      expect(canTransitionDelivery('PENDING', 'DELIVERED')).toBe(false);
      expect(canTransitionDelivery('EN_ROUTE', 'ASSIGNED')).toBe(false);
    });
    it('permits reassigning an already-assigned job', () => {
      expect(canTransitionDelivery('ASSIGNED', 'ASSIGNED')).toBe(true);
    });
    it('can fail any live state but not a terminal one', () => {
      expect(canTransitionDelivery('ASSIGNED', 'FAILED')).toBe(true);
      expect(canTransitionDelivery('EN_ROUTE', 'FAILED')).toBe(true);
      expect(canTransitionDelivery('DELIVERED', 'FAILED')).toBe(false);
      expect(canTransitionDelivery('CANCELLED', 'FAILED')).toBe(false);
    });
    it('treats DELIVERED/FAILED/CANCELLED as terminal', () => {
      expect(canTransitionDelivery('DELIVERED', 'EN_ROUTE')).toBe(false);
      expect(canTransitionDelivery('CANCELLED', 'ASSIGNED')).toBe(false);
    });
  });

  describe('normalisePhone', () => {
    it('collapses every spelling of one Lahore mobile to a single key', () => {
      // The whole point: these are one customer, not four.
      const forms = ['0300 123 4567', '+92 300 1234567', '92-300-1234567', '(0300) 1234567'];
      const keys = new Set(forms.map((f) => normalisePhone(f)));
      expect(keys.size).toBe(1);
      expect([...keys][0]).toBe('+923001234567');
    });
    it('treats a leading 00 as the international prefix', () => {
      expect(normalisePhone('0092 300 1234567')).toBe('+923001234567');
    });
    it('adds the country code to a bare local number', () => {
      expect(normalisePhone('3001234567')).toBe('+923001234567');
    });
    it('leaves a foreign number alone rather than forcing +92 onto it', () => {
      expect(normalisePhone('+442071234567')).toBe('+442071234567');
    });
    it('rejects what cannot be dialled, instead of storing an unmatchable record', () => {
      expect(normalisePhone('12345')).toBeNull();
      expect(normalisePhone('9999999999999999999')).toBeNull();
      expect(normalisePhone('not a phone')).toBeNull();
      expect(normalisePhone('')).toBeNull();
      expect(normalisePhone(null)).toBeNull();
    });
  });

  describe('phoneSearchKey', () => {
    // The bug this exists for: staff type the number the way the customer says it, and the naive
    // digit match found nothing because the stored form has already turned the leading 0 into 92.
    const STORED = '+923001234567'.replace('+', '');
    it('matches the stored number from the local spelling staff actually type', () => {
      const key = phoneSearchKey('0300 123');
      expect(key).toBe('300123');
      expect(STORED.includes(key!)).toBe(true);
    });
    it('matches from the international spelling too', () => {
      for (const term of ['+92 300 123', '0092300123', '92300123', '300123']) {
        expect(STORED.includes(phoneSearchKey(term)!)).toBe(true);
      }
    });
    it('returns null for a name search, so it is not turned into a phone search', () => {
      expect(phoneSearchKey('Ayesha')).toBeNull();
      expect(phoneSearchKey('')).toBeNull();
      expect(phoneSearchKey(null)).toBeNull();
    });
  });

  describe('opensDeliveryJob', () => {
    it('opens a job for a delivery order', () => {
      expect(opensDeliveryJob('DELIVERY')).toBe(true);
    });
    it('leaves aggregator orders to the aggregator', () => {
      // Their rider, their job — created with the provider + externalRef their webhook carries. An
      // OWN job here would be a phantom run on the board with an OTP nobody was told.
      expect(opensDeliveryJob('AGGREGATOR')).toBe(false);
    });
    it('opens nothing for food that leaves with the guest', () => {
      expect(opensDeliveryJob('DINE_IN')).toBe(false);
      expect(opensDeliveryJob('TAKEAWAY')).toBe(false);
      expect(opensDeliveryJob('DRIVE_THRU')).toBe(false);
    });
  });

  describe('canTransitionReservation', () => {
    it('walks booked → confirmed → seated → completed', () => {
      expect(canTransitionReservation('BOOKED', 'CONFIRMED')).toBe(true);
      expect(canTransitionReservation('CONFIRMED', 'SEATED')).toBe(true);
      expect(canTransitionReservation('SEATED', 'COMPLETED')).toBe(true);
    });
    it('lets a walk-in be seated straight from booked, and a waitlist be confirmed/seated', () => {
      expect(canTransitionReservation('BOOKED', 'SEATED')).toBe(true);
      expect(canTransitionReservation('WAITLIST', 'CONFIRMED')).toBe(true);
      expect(canTransitionReservation('WAITLIST', 'SEATED')).toBe(true);
    });
    it('only completes a seated booking', () => {
      expect(canTransitionReservation('BOOKED', 'COMPLETED')).toBe(false);
      expect(canTransitionReservation('CONFIRMED', 'COMPLETED')).toBe(false);
    });
    it('marks no-show only before seating', () => {
      expect(canTransitionReservation('CONFIRMED', 'NO_SHOW')).toBe(true);
      expect(canTransitionReservation('SEATED', 'NO_SHOW')).toBe(false);
    });
    it('treats completed/no-show/cancelled as terminal', () => {
      expect(canTransitionReservation('COMPLETED', 'SEATED')).toBe(false);
      expect(canTransitionReservation('CANCELLED', 'CONFIRMED')).toBe(false);
      expect(canTransitionReservation('NO_SHOW', 'SEATED')).toBe(false);
    });
  });

  describe('recipeConsumedMilli', () => {
    it('scales ingredient use pro-rata by ordered servings over yield', () => {
      // recipe yields 4 servings from 1000 milli; ordering 2 servings consumes 500 milli
      expect(recipeConsumedMilli(1000, 2, 4)).toBe(500);
    });
    it('adds a waste allowance in basis points', () => {
      // 1000 milli/serving, 1 serving, yield 1, 5% waste → 1050
      expect(recipeConsumedMilli(1000, 1, 1, 500)).toBe(1050);
    });
    it('guards a zero/invalid yield against divide-by-zero', () => {
      expect(recipeConsumedMilli(1000, 3, 0)).toBe(3000);
    });
    it('returns zero for a zero-quantity line', () => {
      expect(recipeConsumedMilli(1000, 0, 4)).toBe(0);
    });
  });
});

describe('rowsOf', () => {
  it('unwraps the [rows, affected] shape TypeORM returns for UPDATE/DELETE', () => {
    expect(rowsOf([[{ id: 'a' }], 1])).toEqual([{ id: 'a' }]);
  });

  it('detects "nothing matched" — the guard that silently never fired before', () => {
    expect(rowsOf([[], 0])).toEqual([]);
    expect(rowsOf([[], 0])[0]).toBeUndefined();
  });

  it('passes SELECT / INSERT…RETURNING rows through untouched', () => {
    expect(rowsOf([{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(rowsOf([])).toEqual([]);
  });

  it('does not mistake a two-row SELECT for the affected-count shape', () => {
    const two = [{ id: 'a' }, { id: 'b' }];
    expect(rowsOf(two)).toEqual(two);
  });

  it('tolerates a null/undefined result', () => {
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf(undefined)).toEqual([]);
  });
});
