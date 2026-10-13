// Client-side mirror of the accounting rules in supabase/migrations (see docs/ACCOUNTING_RULES.md).
// The database is the authority: these helpers only shape data for display and are covered by
// tests/accounting.test.ts. Nothing here is used to decide what is actually stored.

import { addMoney, toPaisa, fromPaisa } from './money';
import type { AccountType, TransactionType } from './types';

const MONEY_IN: ReadonlySet<TransactionType> = new Set<TransactionType>([
  'income',
  'refund',
  'loan_in',
  'loan_repayment_in',
]);

const LOAN_MOVEMENTS: ReadonlySet<TransactionType> = new Set<TransactionType>([
  'loan_out',
  'loan_in',
  'loan_repayment_in',
  'loan_repayment_out',
]);

export function signedAmount(type: TransactionType, amount: number): number {
  return MONEY_IN.has(type) ? amount : -amount;
}

export function isLoanMovement(type: TransactionType): boolean {
  return LOAN_MOVEMENTS.has(type);
}

/** Only plain income counts as income. Loans, transfers and refunds never do. */
export function countsAsIncome(type: TransactionType): boolean {
  return type === 'income';
}

/** Expenses are reduced by refunds, so a refund is shown separately and netted. */
export function countsAsExpense(type: TransactionType): boolean {
  return type === 'expense';
}

/**
 * Balance of an account from its opening balance and its signed movements.
 * Mirrors public.account_balances.
 */
export function accountBalance(
  openingBalance: number,
  movements: ReadonlyArray<{ type: TransactionType; amount: number }>,
  transfersIn: number[] = [],
  transfersOut: number[] = [],
): number {
  const movementPaisa = movements.reduce((sum, m) => sum + toPaisa(signedAmount(m.type, m.amount)), 0);
  const inPaisa = transfersIn.reduce((sum, a) => sum + toPaisa(a), 0);
  const outPaisa = transfersOut.reduce((sum, a) => sum + toPaisa(a), 0);
  return fromPaisa(toPaisa(openingBalance) + movementPaisa + inPaisa - outPaisa);
}

/** Credit cards: a negative balance is money owed. Display it as a positive "owed" figure. */
export function amountOwed(type: AccountType, balance: number): number {
  return type === 'credit_card' && balance < 0 ? -balance : 0;
}

/** Net worth: every active account's balance; card debt is subtracted automatically. */
export function netWorth(balances: ReadonlyArray<{ current_balance: number; is_archived: boolean }>): number {
  return addMoney(...balances.filter((b) => !b.is_archived).map((b) => b.current_balance));
}
