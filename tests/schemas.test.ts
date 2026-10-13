import { describe, expect, it } from 'vitest';
import { loanSchema, repaymentSchema, savingsGoalSchema, transactionSchema, transferSchema } from '../src/lib/schemas';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

describe('transactionSchema', () => {
  const base = { accountId: uuidA, type: 'expense', amount: '250.50', occurredOn: '2026-03-05', categoryId: '', description: 'Lunch' };

  it('accepts a valid expense and coerces the amount', () => {
    const parsed = transactionSchema.parse(base);
    expect(parsed.amount).toBe(250.5);
    expect(parsed.categoryId).toBeNull();
  });

  it('rejects zero, negative and over-precise amounts', () => {
    expect(transactionSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: '-1' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: '1.005' }).success).toBe(false);
  });

  it('does not allow loan types through the transaction form', () => {
    expect(transactionSchema.safeParse({ ...base, type: 'loan_in' }).success).toBe(false);
  });

  it('rejects malformed dates and account ids', () => {
    expect(transactionSchema.safeParse({ ...base, occurredOn: '05/03/2026' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, accountId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('transferSchema', () => {
  it('requires two different accounts', () => {
    const result = transferSchema.safeParse({ fromAccountId: uuidA, toAccountId: uuidA, amount: '10', transferredOn: '2026-03-07', note: '' });
    expect(result.success).toBe(false);
  });

  it('accepts two different accounts', () => {
    const result = transferSchema.safeParse({ fromAccountId: uuidA, toAccountId: uuidB, amount: '10', transferredOn: '2026-03-07', note: '' });
    expect(result.success).toBe(true);
  });
});

describe('loanSchema', () => {
  const base = { direction: 'given', counterparty: 'Rahim', principal: '2000', startDate: '2026-03-10', dueDate: '', accountId: '', notes: '' };

  it('allows an empty due date and no account', () => {
    expect(loanSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a due date before the start date', () => {
    expect(loanSchema.safeParse({ ...base, dueDate: '2026-03-01' }).success).toBe(false);
  });
});

describe('repaymentSchema', () => {
  const base = { loanId: uuidA, accountId: uuidB, principal: 0, interest: 0, paidOn: '2026-04-01' };

  it('needs a principal or an interest amount', () => {
    expect(repaymentSchema.safeParse(base).success).toBe(false);
    expect(repaymentSchema.safeParse({ ...base, interest: 50 }).success).toBe(true);
  });
});

describe('savingsGoalSchema', () => {
  it('requires a positive target and a non-negative saved amount', () => {
    expect(savingsGoalSchema.safeParse({ name: 'Fund', targetAmount: 0, savedAmount: 0, targetDate: '' }).success).toBe(false);
    expect(savingsGoalSchema.safeParse({ name: 'Fund', targetAmount: 100, savedAmount: -1, targetDate: '' }).success).toBe(false);
    expect(savingsGoalSchema.safeParse({ name: 'Fund', targetAmount: 100, savedAmount: 0, targetDate: '' }).success).toBe(true);
  });
});
