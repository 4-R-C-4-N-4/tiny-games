import { describe, it, expect } from 'vitest';
import { AttackerEconomy } from './attacker-economy.ts';

describe('AttackerEconomy (attacker build order)', () => {
  it('leaves the opening waves at base income', () => {
    const e = new AttackerEconomy();
    expect(e.nextAssault(1, 100, undefined)).toBe(100);
    expect(e.nextAssault(2, 200, undefined)).toBe(200);
    expect(e.banked).toBe(0);
  });

  it('auto build order: breather waves punctuated by heavier spikes', () => {
    const e = new AttackerEconomy();
    const income = 1000;
    const fielded: number[] = [];
    for (let w = 3; w <= 9; w++) fielded.push(e.nextAssault(w, income, undefined));
    expect(Math.min(...fielded)).toBeLessThan(income); // at least one breather
    expect(Math.max(...fielded)).toBeGreaterThan(income); // at least one spike
    expect(e.techLevel).toBeGreaterThanOrEqual(1); // released at least once
  });

  it("'save' banks harder; 'spike' releases the hoard immediately", () => {
    const e = new AttackerEconomy();
    e.nextAssault(3, 1000, 'save');
    e.nextAssault(4, 1000, 'save');
    expect(e.banked).toBeGreaterThan(700);
    const spike = e.nextAssault(5, 1000, 'spike');
    expect(spike).toBeGreaterThan(1000); // income + released bank
    expect(e.lastWasSpike).toBe(true);
    expect(e.banked).toBe(0);
    expect(e.techLevel).toBe(1);
  });

  it('redistributes rather than inflates — total ≈ baseline over a long run', () => {
    const e = new AttackerEconomy();
    const income = 500, N = 30;
    let total = 0;
    for (let w = 3; w < 3 + N; w++) total += e.nextAssault(w, income, undefined);
    const baseline = income * N;
    expect(total).toBeGreaterThan(baseline * 0.9);
    expect(total).toBeLessThan(baseline * 1.2);
  });
});
