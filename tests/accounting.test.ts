import { describe, expect, it } from 'vitest';
import { accountBalance, amountOwed, countsAsExpense, countsAsIncome, isLoanMovement, netWorth, signedAmount } from '../src/lib/accounting';

describe('accounting rules', () => {
  it('income and refunds are money in; expenses and loans given are money out', () => {
    expect(signedAmount('income', 100)).toBe(100);
    expect(signedAmount('refund', 25)).toBe(25);
    expect(signedAmount('loan_in', 500)).toBe(500);
    expect(signedAmount('loan_repayment_in', 50)).toBe(50);
    expect(signedAmount('expense', 100)).toBe(-100);
    expect(signedAmount('loan_out', 500)).toBe(-500);
    expect(signedAmount('loan_repayment_out', 50)).toBe(-50);
  });

  it('only plain income counts as income, so borrowed money and refunds never do', () => {
    expect(countsAsIncome('income')).toBe(true);
    expect(countsAsIncome('loan_in')).toBe(false);
    expect(countsAsIncome('refund')).toBe(false);
    expect(countsAsIncome('loan_repayment_in')).toBe(false);
  });

  it('only plain expense counts as expense, refunds are netted separately', () => {
    expect(countsAsExpense('expense')).toBe(true);
    expect(countsAsExpense('refund')).toBe(false);
    expect(countsAsExpense('loan_out')).toBe(false);
  });

  it('flags loan movements so the UI can label them', () => {
    expect(isLoanMovement('loan_out')).toBe(true);
    expect(isLoanMovement('loan_repayment_out')).toBe(true);
    expect(isLoanMovement('income')).toBe(false);
    expect(isLoanMovement('refund')).toBe(false);
  });

  it('computes an account balance from opening balance, movements and transfers', () => {
    const balance = accountBalance(1000, [
      { type: 'income', amount: 5000 },
      { type: 'expense', amount: 300 },
      { type: 'refund', amount: 50 },
    ], [], [200]);
    expect(balance).toBe(5550);
  });

  it('adds transfers in and subtracts transfers out', () => {
    expect(accountBalance(0, [], [400], [150])).toBe(250);
  });

  it('keeps cent precision without floating-point drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    const balance = accountBalance(0, [
      { type: 'income', amount: 0.1 },
      { type: 'income', amount: 0.2 },
    ]);
    expect(balance).toBe(0.3);
  });

  it('a credit card shows its debt as amount owed and nothing when in credit', () => {
    expect(amountOwed('credit_card', -600)).toBe(600);
    expect(amountOwed('credit_card', 250)).toBe(0);
    expect(amountOwed('bank', -600)).toBe(0);
  });

  it('net worth excludes archived accounts and subtracts card debt', () => {
    const worth = netWorth([
      { current_balance: 4200, is_archived: false },
      { current_balance: -600, is_archived: false },
      { current_balance: 9999, is_archived: true },
    ]);
    expect(worth).toBe(3600);
  });
});
