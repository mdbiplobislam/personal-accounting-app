# Database schema

PostgreSQL 17 on Supabase. Every object is defined by the migrations in `supabase/migrations/`,
applied in filename order. The file list is the source of truth; this document describes it.

## Conventions

- Primary keys are `uuid` (`gen_random_uuid()`), except `audit_logs.id` (`bigint` identity).
- Every user-owned table has `user_id uuid` referencing `profiles(id)`.
- Child rows reference parents through **composite foreign keys** `(parent_id, user_id)`. A row
  therefore cannot point at another user's account, category or loan, even if RLS were bypassed.
- Money is `numeric(14,2)`. Amount columns have `CHECK (amount > 0)` where a zero or negative value is meaningless.
- Currency columns are `char(3)` with `CHECK (… ~ '^[A-Z]{3}$')`, defaulting to `BDT`.
- Timestamps are `timestamptz`. Business dates are `date`.

## Migrations

| File | Contents |
|---|---|
| `20260101000001_create_enums.sql` | enums: `account_type`, `category_kind`, `transaction_type`, `loan_direction`, `loan_status` |
| `20260101000002_create_tables.sql` | tables, constraints, foreign keys, indexes |
| `20260101000003_triggers_and_audit.sql` | `updated_at` triggers, transaction/transfer/budget validation, audit trigger |
| `20260101000004_rls_and_auth.sql` | `handle_new_user()` signup trigger, RLS enablement and policies, grants |
| `20260101000005_views_and_functions.sql` | views `account_balances`, `budget_status`; `report_monthly_summary()`; atomic RPCs |

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `profiles` | One per auth user (display name, default currency) | PK = `auth.users.id` |
| `accounts` | Cash, bank, bKash, Nagad, Rocket, credit card, other | unique `(user_id, lower(name))`; `(id, user_id)` unique |
| `categories` | Income and expense categories | unique `(user_id, kind, lower(name))` |
| `loans` | Money given or received | `outstanding_principal` between 0 and `principal`; `status = settled` iff outstanding is 0; unique `(user_id, idempotency_key)` |
| `transactions` | Income, expense, refund and loan cash movements | `signed_amount` generated; loan link present iff loan type; loan types carry no category; unique `(user_id, idempotency_key)` |
| `transfers` | Movement between two own accounts | `from_account_id <> to_account_id`; unique `(user_id, idempotency_key)` |
| `loan_repayments` | Immutable repayment record, one per transaction | `principal + interest > 0`; unique `transaction_id` |
| `budgets` | Monthly limit per expense category | `month` is the first of the month; unique `(user_id, category_id, month)`; expense categories only (trigger) |
| `savings_goals` | Target and recorded progress | `target_amount > 0`, `saved_amount >= 0` |
| `audit_logs` | Row history for every user table | append-only from the client's point of view |

## Views

- `account_balances`: current balance per account (`security_invoker`, so RLS applies).
- `budget_status`: budget versus spending per category and month.

## Functions

| Function | Access | Purpose |
|---|---|---|
| `create_transaction(...)` | authenticated | income/expense/refund; idempotent |
| `create_transfer(...)` | authenticated | transfer between two active own accounts; idempotent |
| `create_loan(...)` | authenticated | loan record, plus cash movement when an account is given; idempotent |
| `record_loan_repayment(...)` | authenticated | atomic repayment; locks the loan row; idempotent |
| `report_monthly_summary(int)` | authenticated | 12-row monthly report (invoker, so RLS applies) |
| `handle_new_user()` | trigger only | profile plus 13 default categories |
| `audit_row()` | trigger only | writes `audit_logs` |
| `validate_transaction()`, `validate_transfer()`, `validate_budget()`, `set_updated_at()` | trigger only | integrity rules |

The write RPCs are `SECURITY DEFINER` with `SET search_path = ''`. Each one checks `auth.uid()` and
ownership itself, because RLS would otherwise block the loan-linked inserts they must perform.
`PUBLIC` and `anon` have no execute right on them.

## Row Level Security

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own | — (trigger) | own | — |
| `accounts`, `categories`, `budgets`, `savings_goals`, `transfers` | own | own | own | own |
| `transactions` | own | own, non-loan types | own, non-loan types | own, non-loan types |
| `loans`, `loan_repayments` | own | — (RPC only) | — | — |
| `audit_logs` | own | — (trigger) | — | — |

`anon` has no table privileges. Every policy compares `user_id` with `(select auth.uid())`.

## Indexes

Foreign-key and filter columns are indexed: `(user_id, occurred_on desc)` on transactions,
`(user_id, transferred_on desc)` on transfers, `(user_id, status)` on loans, `(user_id, created_at desc)`
on audit logs, plus the account, category and loan lookups.
