// Data access. Reads go straight to PostgREST under RLS. Multi-row writes (transactions,
// transfers, loans, repayments) go through database RPCs so they commit atomically.
// Every write carries an idempotency key, so a retried submit cannot double-post.

import { supabase } from './supabase';
import type {
  Account,
  AccountBalance,
  AccountType,
  Budget,
  BudgetStatus,
  Category,
  CategoryKind,
  Loan,
  LoanRepayment,
  MonthlySummary,
  SavingsGoal,
  Transaction,
  TransactionType,
  Transfer,
} from './types';
import type {
  AccountInput,
  BudgetInput,
  LoanInput,
  RepaymentInput,
  SavingsGoalInput,
  TransactionInput,
  TransferInput,
} from './schemas';

function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const newIdempotencyKey = (): string => crypto.randomUUID();

// ---------------------------------------------------------------- auth / profile
export async function getProfileName(userId: string): Promise<string | null> {
  const row = check(
    await db().from('profiles').select('display_name').eq('id', userId).maybeSingle<{ display_name: string | null }>(),
  );
  return row?.display_name ?? null;
}

// ---------------------------------------------------------------- accounts
export async function listAccounts(): Promise<Account[]> {
  return check(await db().from('accounts').select('*').order('name'));
}

export async function listBalances(): Promise<AccountBalance[]> {
  return check(await db().from('account_balances').select('*').order('name'));
}

export async function saveAccount(input: AccountInput, id?: string): Promise<void> {
  const payload = {
    name: input.name,
    type: input.type as AccountType,
    opening_balance: input.openingBalance,
  };
  if (id) {
    check(await db().from('accounts').update(payload).eq('id', id));
  } else {
    const user = await currentUserId();
    check(await db().from('accounts').insert({ ...payload, user_id: user }));
  }
}

export async function setAccountArchived(id: string, archived: boolean): Promise<void> {
  check(await db().from('accounts').update({ is_archived: archived }).eq('id', id));
}

// ---------------------------------------------------------------- categories
export async function listCategories(kind?: CategoryKind): Promise<Category[]> {
  let query = db().from('categories').select('*').order('name');
  if (kind) query = query.eq('kind', kind);
  return check(await query);
}

// ---------------------------------------------------------------- transactions
export interface TransactionFilters {
  search?: string;
  type?: TransactionType | '';
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
}

export async function listTransactions(
  filters: TransactionFilters,
  page: number,
  pageSize: number,
): Promise<Transaction[]> {
  let query = db().from('transactions').select('*');
  if (filters.search?.trim()) {
    // Escape LIKE wildcards so the user's text is matched literally.
    const term = filters.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
    query = query.ilike('description', `%${term}%`);
  }
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.accountId) query = query.eq('account_id', filters.accountId);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.from) query = query.gte('occurred_on', filters.from);
  if (filters.to) query = query.lte('occurred_on', filters.to);

  return check(
    await query
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1),
  );
}

export async function listAllTransactionsForExport(filters: TransactionFilters): Promise<Transaction[]> {
  const rows: Transaction[] = [];
  const size = 1000;
  for (let page = 0; ; page += 1) {
    const chunk = await listTransactions(filters, page, size);
    rows.push(...chunk);
    if (chunk.length < size) break;
  }
  return rows;
}

export async function createTransaction(input: TransactionInput, idempotencyKey: string): Promise<void> {
  check(
    await db().rpc('create_transaction', {
      p_account_id: input.accountId,
      p_type: input.type,
      p_amount: input.amount,
      p_occurred_on: input.occurredOn,
      p_category_id: input.categoryId,
      p_description: input.description ?? null,
      p_idempotency_key: idempotencyKey,
    }),
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  check(await db().from('transactions').delete().eq('id', id));
}

// ---------------------------------------------------------------- transfers
export async function listTransfers(limit: number): Promise<Transfer[]> {
  return check(
    await db().from('transfers').select('*').order('transferred_on', { ascending: false }).limit(limit),
  );
}

export async function createTransfer(input: TransferInput, idempotencyKey: string): Promise<void> {
  check(
    await db().rpc('create_transfer', {
      p_from_account_id: input.fromAccountId,
      p_to_account_id: input.toAccountId,
      p_amount: input.amount,
      p_transferred_on: input.transferredOn,
      p_note: input.note ?? null,
      p_idempotency_key: idempotencyKey,
    }),
  );
}

export async function deleteTransfer(id: string): Promise<void> {
  check(await db().from('transfers').delete().eq('id', id));
}

// ---------------------------------------------------------------- loans
export async function listLoans(): Promise<Loan[]> {
  return check(await db().from('loans').select('*').order('start_date', { ascending: false }));
}

export async function listRepayments(): Promise<LoanRepayment[]> {
  return check(await db().from('loan_repayments').select('*').order('paid_on', { ascending: false }));
}

export async function createLoan(input: LoanInput, idempotencyKey: string): Promise<void> {
  check(
    await db().rpc('create_loan', {
      p_direction: input.direction,
      p_counterparty: input.counterparty,
      p_principal: input.principal,
      p_start_date: input.startDate,
      p_due_date: input.dueDate ?? null,
      p_account_id: input.accountId,
      p_notes: input.notes ?? null,
      p_idempotency_key: idempotencyKey,
    }),
  );
}

export async function recordRepayment(input: RepaymentInput, idempotencyKey: string): Promise<void> {
  check(
    await db().rpc('record_loan_repayment', {
      p_loan_id: input.loanId,
      p_account_id: input.accountId,
      p_principal: input.principal,
      p_interest: input.interest,
      p_paid_on: input.paidOn,
      p_idempotency_key: idempotencyKey,
    }),
  );
}

// ---------------------------------------------------------------- budgets
export async function listBudgetStatus(monthFirstDay: string): Promise<BudgetStatus[]> {
  return check(
    await db().from('budget_status').select('*').eq('month', monthFirstDay).order('category_name'),
  );
}

export async function listBudgets(): Promise<Budget[]> {
  return check(await db().from('budgets').select('*'));
}

export async function saveBudget(input: BudgetInput & { month: string }, id?: string): Promise<void> {
  const payload = { category_id: input.categoryId, month: input.month, amount: input.amount };
  if (id) {
    check(await db().from('budgets').update(payload).eq('id', id));
  } else {
    check(await db().from('budgets').insert({ ...payload, user_id: await currentUserId() }));
  }
}

export async function deleteBudget(id: string): Promise<void> {
  check(await db().from('budgets').delete().eq('id', id));
}

// ---------------------------------------------------------------- savings goals
export async function listSavingsGoals(): Promise<SavingsGoal[]> {
  return check(await db().from('savings_goals').select('*').order('target_date', { ascending: true, nullsFirst: false }));
}

export async function saveSavingsGoal(input: SavingsGoalInput, id?: string): Promise<void> {
  const payload = {
    name: input.name,
    target_amount: input.targetAmount,
    saved_amount: input.savedAmount,
    target_date: input.targetDate ?? null,
  };
  if (id) {
    check(await db().from('savings_goals').update(payload).eq('id', id));
  } else {
    check(await db().from('savings_goals').insert({ ...payload, user_id: await currentUserId() }));
  }
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  check(await db().from('savings_goals').delete().eq('id', id));
}

// ---------------------------------------------------------------- reports
export async function monthlyReport(year: number): Promise<MonthlySummary[]> {
  return check(await db().rpc('report_monthly_summary', { p_year: year }));
}

// ---------------------------------------------------------------- helpers
export async function currentUserId(): Promise<string> {
  const { data, error } = await db().auth.getUser();
  if (error || !data.user) throw new Error('You are signed out. Sign in again to continue.');
  return data.user.id;
}
