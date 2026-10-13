// Dates are plain calendar dates (YYYY-MM-DD). Use local time, not toISOString(),
// which would shift a Dhaka evening into the previous UTC day.

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

/** 'YYYY-MM' from a Date, used by month pickers. */
export function toMonthValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Converts a 'YYYY-MM' month picker value into the first day of that month. */
export function monthToFirstDay(monthValue: string): string {
  return `${monthValue}-01`;
}

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function monthName(month: number): string {
  return monthNames[month - 1] ?? '';
}
