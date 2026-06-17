import { describe, expect, it } from 'vitest';
import { budgetRemaining, entryBill, entryCost, projectActuals } from '../src/modules/projects/projects.util';

describe('projects.util', () => {
  it('entryCost = minutes × hourly cost rate', () => {
    expect(entryCost(60, 200_000)).toBe(200_000); // 1h @ 2,000.00
    expect(entryCost(90, 200_000)).toBe(300_000); // 1.5h
    expect(entryCost(30, 200_000)).toBe(100_000); // 0.5h
    expect(entryCost(0, 200_000)).toBe(0);
  });

  it('entryBill = minutes × bill rate, zero when non-billable', () => {
    expect(entryBill(120, 300_000, true)).toBe(600_000); // 2h @ 3,000.00
    expect(entryBill(120, 300_000, false)).toBe(0); // non-billable
  });

  it('projectActuals rolls up labour + expenses (cost + billable)', () => {
    const a = projectActuals(
      [
        { minutes: 60, costMinor: 200_000, billMinor: 300_000 },
        { minutes: 30, costMinor: 100_000, billMinor: 0 }, // non-billable
      ],
      [
        { amountMinor: 50_000, billable: true },
        { amountMinor: 20_000, billable: false },
      ],
    );
    expect(a.minutes).toBe(90);
    expect(a.laborCostMinor).toBe(300_000);
    expect(a.billableMinor).toBe(300_000);
    expect(a.expenseCostMinor).toBe(70_000);
    expect(a.billableExpenseMinor).toBe(50_000);
    expect(a.totalCostMinor).toBe(370_000); // labour 300k + expenses 70k
    expect(a.totalBillableMinor).toBe(350_000); // billable labour 300k + billable expense 50k
  });

  it('budgetRemaining = budget − cost (negative when over)', () => {
    expect(budgetRemaining(1_000_000, 370_000)).toBe(630_000);
    expect(budgetRemaining(300_000, 370_000)).toBe(-70_000);
  });
});
