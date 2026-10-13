// Row shapes returned by PostgREST. Keep in step with supabase/migrations.
// `npm run db:types` regenerates the authoritative version from a running local database.

export type AccountType = 'cash' | 'bank' | 'bkash' | 'nagad' | 'rocket' | 'credit_card' | 'other';
export type CategoryKind = 'income' | 'expense';
export type TransactionType =
  | 'income'
  | 'expense'
  | 'refund'
  | 'loan_out'
  | 'loan_in'
  | 'loan_repayment_in'
  | 'loan_repayment_out';
export type LoanDirection = 'given' | 'received';
export type LoanStatus = 'active' | 'settled';

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance: number;
  is_archived: boolean;
}

export interface AccountBalance {
  account_id: string;
  name: string;
  type: AccountType;
  currency: string;
  is_archived: boolean;
  opening_balance: number;
  current_balance: number;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  kind: CategoryKind;
}

export interface Transaction {
  id: string;
  account_id: string;
  category_id: string | null;
  loan_id: string | null;
  type: TransactionType;
  amount: number;
  signed_amount: number;
  occurred_on: string;
  description: string | null;
}

export interface Transfer {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transferred_on: string;
  note: string | null;
}

export interface Loan {
  id: string;
  direction: LoanDirection;
  counterparty: string;
  principal: number;
  outstanding_principal: number;
  status: LoanStatus;
  start_date: string;
  due_date: string | null;
  notes: string | null;
}

export interface LoanRepayment {
  id: string;
  loan_id: string;
  account_id: string;
  principal_amount: number;
  interest_amount: number;
  paid_on: string;
}

export interface Budget {
  id: string;
  category_id: string;
  month: string;
  amount: number;
}

export interface BudgetStatus {
  budget_id: string;
  category_id: string;
  category_name: string;
  month: string;
  budget_amount: number;
  spent: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
}

export interface MonthlySummary {
  month: number;
  income: number;
  interest_income: number;
  expense: number;
  refunds: number;
  interest_expense: number;
  total_income: number;
  net_expense: number;
  net_savings: number;
}
