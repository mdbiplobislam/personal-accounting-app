// Money is handled as integer paisa (1/100 taka) inside the app so that sums never drift.
// The database stores NUMERIC(14,2); values cross the boundary as numbers with 2 decimals.

export const CURRENCY = 'BDT';

export function toPaisa(amount: number): number {
  return Math.round(amount * 100);
}

export function fromPaisa(paisa: number): number {
  return paisa / 100;
}

export function addMoney(...values: number[]): number {
  return fromPaisa(values.reduce((sum, value) => sum + toPaisa(value), 0));
}

// en-IN grouping (1,00,000) is the convention used for taka in Bangladesh as well.
const formatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${CURRENCY} ${formatter.format(Math.abs(amount))}`;
}

export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}
