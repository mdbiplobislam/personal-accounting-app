import { z } from 'zod';
import { hasAtMostTwoDecimals } from './money';

// Validation shared by every form. The database enforces the same limits, so a bypassed
// form still cannot store bad data.

const MAX_MONEY = 999_999_999_999.99;

const money = (min: number) =>
  z.coerce
    .number<number>()
    .refine(Number.isFinite, 'Enter a number')
    .refine(hasAtMostTwoDecimals, 'Use at most two decimal places')
    .min(min, min === 0 ? 'Must be zero or more' : `Must be at least ${min}`)
    .max(MAX_MONEY, 'Amount is too large');

const positiveMoney = money(0.01);
const isoDate = z.iso.date('Use a date in YYYY-MM-DD format');
const uuid = z.uuid('Choose a valid option');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .optional()
    .transform((value) => (value ? value : undefined));

export const accountTypeValues = ['cash', 'bank', 'bkash', 'nagad', 'rocket', 'credit_card', 'other'] as const;

export const accountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Keep it under 100 characters'),
  type: z.enum(accountTypeValues, 'Choose an account type'),
  openingBalance: z.coerce
    .number<number>()
    .refine(Number.isFinite, 'Enter a number')
    .refine(hasAtMostTwoDecimals, 'Use at most two decimal places')
    .refine((n) => Math.abs(n) <= MAX_MONEY, 'Amount is too large'),
});
export type AccountInput = z.infer<typeof accountSchema>;

export const transactionSchema = z.object({
  accountId: uuid,
  type: z.enum(['income', 'expense', 'refund'], 'Choose a type'),
  amount: positiveMoney,
  occurredOn: isoDate,
  categoryId: z.union([uuid, z.literal('')]).transform((value) => (value ? value : null)),
  description: optionalText(255),
});
export type TransactionInput = z.infer<typeof transactionSchema>;

export const transferSchema = z
  .object({
    fromAccountId: uuid,
    toAccountId: uuid,
    amount: positiveMoney,
    transferredOn: isoDate,
    note: optionalText(255),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: 'Choose two different accounts',
    path: ['toAccountId'],
  });
export type TransferInput = z.infer<typeof transferSchema>;

export const loanSchema = z
  .object({
    direction: z.enum(['given', 'received'], 'Choose a direction'),
    counterparty: z.string().trim().min(1, 'Name is required').max(100, 'Keep it under 100 characters'),
    principal: positiveMoney,
    startDate: isoDate,
    dueDate: z.union([isoDate, z.literal('')]).optional().transform((value) => (value ? value : undefined)),
    accountId: z.union([uuid, z.literal('')]).transform((value) => (value ? value : null)),
    notes: optionalText(500),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.startDate, {
    message: 'Due date cannot be before the start date',
    path: ['dueDate'],
  });
export type LoanInput = z.infer<typeof loanSchema>;

export const repaymentSchema = z
  .object({
    loanId: uuid,
    accountId: uuid,
    principal: money(0),
    interest: money(0),
    paidOn: isoDate,
  })
  .refine((v) => v.principal + v.interest > 0, {
    message: 'Enter a principal or interest amount',
    path: ['principal'],
  });
export type RepaymentInput = z.infer<typeof repaymentSchema>;

export const budgetSchema = z.object({
  categoryId: uuid,
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Choose a month'),
  amount: positiveMoney,
});
export type BudgetInput = z.infer<typeof budgetSchema>;

export const savingsGoalSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Keep it under 100 characters'),
  targetAmount: positiveMoney,
  savedAmount: money(0),
  targetDate: z.union([isoDate, z.literal('')]).optional().transform((value) => (value ? value : undefined)),
});
export type SavingsGoalInput = z.infer<typeof savingsGoalSchema>;

/** Returns the first error message, or null. Handy for showing one message per form. */
export function firstError(result: { success: true } | { success: false; error: z.ZodError }): string | null {
  return result.success ? null : (result.error.issues[0]?.message ?? 'Check the form and try again');
}
