import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/lib/csv';

describe('toCsv', () => {
  const columns = ['date', 'description', 'amount'];

  it('writes a header and escapes commas, quotes and newlines', () => {
    const csv = toCsv(
      [{ date: '2026-03-01', description: 'Rent, March "final"\nline2', amount: 25000 }],
      columns,
    );
    expect(csv).toBe('date,description,amount\r\n2026-03-01,"Rent, March ""final""\nline2",25000');
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    const csv = toCsv([{ date: '=HYPERLINK("x")', description: '+1 555', amount: '-5' }], columns);
    const row = csv.split('\r\n')[1];
    expect(row).toContain("'=HYPERLINK");
    expect(row).not.toMatch(/(^|,)=HYPERLINK/);
    expect(row).toContain("'+1 555");
    expect(row).toContain("'-5");
  });

  it('writes empty cells for null and undefined', () => {
    expect(toCsv([{ date: null, description: undefined, amount: 0 }], columns)).toBe('date,description,amount\r\n,,0');
  });
});
