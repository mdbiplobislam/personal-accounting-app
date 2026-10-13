import { describe, expect, it } from 'vitest';
import { addMoney, formatMoney, hasAtMostTwoDecimals } from '../src/lib/money';

describe('money', () => {
  it('adds without floating-point drift', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(10.1, 20.2, -0.3)).toBe(30);
  });

  it('formats BDT with lakh grouping and two decimals', () => {
    expect(formatMoney(100000)).toBe('BDT 1,00,000.00');
    expect(formatMoney(1234.5)).toBe('BDT 1,234.50');
    expect(formatMoney(-600)).toBe('-BDT 600.00');
  });

  it('rejects more than two decimal places', () => {
    expect(hasAtMostTwoDecimals(12.34)).toBe(true);
    expect(hasAtMostTwoDecimals(12.345)).toBe(false);
  });
});
