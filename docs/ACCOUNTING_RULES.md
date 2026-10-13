# Accounting rules

These rules are implemented in the database (`supabase/migrations/…005_views_and_functions.sql`)
and checked by `supabase/tests/01_accounting_rules.sql`. The client helpers in
`src/lib/accounting.ts` mirror them for display only; the database is the authority.

All money is `NUMERIC(14,2)`, in BDT by default. Amounts you enter are always positive; the
direction comes from the transaction type.

## Classification

| Movement | Stored as | Money in/out | Income | Expense | Balance effect |
|---|---|---|---|---|---|
| Salary, business, other income | `transactions` `income` | in | **yes** | no | + |
| Purchases, bills | `transactions` `expense` | out | no | **yes** | − |
| Refund of a purchase | `transactions` `refund` | in | no | **reduces expense** | + |
| Move between own accounts | `transfers` | out of one, into another | no | no | − then + |
| Lend money | `loan_out` (linked to loan) | out | no | no | − |
| Borrow money | `loan_in` (linked to loan) | in | **no** | no | + |
| Repay a loan you gave | `loan_repayment_in` | in | principal: no; interest: **income** | no | + |
| Repay a loan you took | `loan_repayment_out` | out | no | principal: no; interest: **expense** | − |

A transfer is never a `transactions` row, so it cannot leak into income or expense reports.

## Balances

```
balance = opening_balance
        + Σ signed_amount of transactions on the account   (income, refund, loan_in, loan_repayment_in: +; others: −)
        + Σ amount of transfers into the account
        − Σ amount of transfers out of the account
```

Balances are derived in the `account_balances` view, not stored, so they cannot drift from the
ledger.

## Credit cards

A credit card is an account whose balance is usually negative. Spending on it is an expense that
lowers the balance. Paying the card is a transfer from a bank or wallet, which raises it toward zero.
An `opening_balance` below zero records debt that already exists. The UI shows a negative card balance as
"Owed". Net worth subtracts card debt automatically.

## Refunds

A refund is money coming back for an earlier expense. It increases the balance of the account it
returns to, reduces expense in the reports (`net_expense = expense + interest_expense − refunds`), and
is never income. Budgets use the same netting (`budget_status.spent`).

## Loans

- Given (`direction = given`): creating the loan with an account records `loan_out`, so cash
  leaves the account. This is not an expense, because the money is still owed to you.
- Received (`direction = received`): creating the loan with an account records `loan_in`, so cash
  arrives. This is not income, because it must be repaid.
- Repayments are recorded with `record_loan_repayment()`. In one transaction it:
  1. locks the loan row (`SELECT … FOR UPDATE`), so two concurrent payments cannot both pass the
     balance check;
  2. rejects principal above the outstanding balance, and any payment on a settled loan;
  3. writes the cash movement (principal + interest), the repayment row, and the new outstanding
     principal together;
  4. marks the loan `settled` when the outstanding principal reaches zero.
- `outstanding_principal` only ever moves through that function. Clients have no write access
  to loans or repayments.
- Interest is recognised as income on loans given and as expense on loans received. Principal is
  never income or expense.

## Duplicate protection

Every money-moving write requires a client-generated `idempotency_key` (UUID). The key is unique
per user, per table. If a key has already been used, the original row is returned and nothing new
is inserted. The client reuses a key only for an identical retry. If the user changes the form, a
new key is generated, so a corrected entry is never swallowed.

## Reports

`report_monthly_summary(year)` returns one row per month:

- `income` is plain income. `interest_income` is loan interest received.
- `expense` is plain expense. `refunds` is refunds received. `interest_expense` is loan interest paid.
- `total_income = income + interest_income`
- `net_expense = expense + interest_expense − refunds`
- `net_savings = total_income − net_expense`

Transfers and loan principal do not appear in any of these figures.

## Budgets and savings goals

- A budget limits one expense category for one calendar month. Spending = expenses − refunds.
  Only expense categories can have budgets (a trigger enforces this).
- A savings goal records progress the user enters. Saving does not move money between accounts;
  record the transfer separately if the money actually moves.

## Corrections and deletion

- Ordinary income, expense and refund rows can be edited or deleted. Each change is written to
  `audit_logs`.
- Loan-linked rows cannot be edited or deleted by a client. A loan is corrected by recording the
  right repayment or by a dedicated correction function in a future migration.
- Accounts and categories with history cannot be deleted (foreign keys). Archive an account instead.
