import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Empty, Field, Input, Money, PageHeading, Select, Spinner, TableWrap, td, th } from '../components/ui';
import {
  createTransaction,
  deleteTransaction,
  listAccounts,
  listAllTransactionsForExport,
  listCategories,
  listTransactions,
  type TransactionFilters,
} from '../lib/api';
import { toCsv, downloadCsv } from '../lib/csv';
import { createIdempotencyTracker } from '../lib/idempotency';
import { isLoanMovement } from '../lib/accounting';
import { todayIso } from '../lib/dates';
import { firstError, transactionSchema } from '../lib/schemas';
import { useAsyncData } from '../lib/useAsyncData';
import type { Transaction, TransactionType } from '../lib/types';

const PAGE_SIZE = 25;

const typeLabel: Record<TransactionType, string> = {
  income: 'Income',
  expense: 'Expense',
  refund: 'Refund',
  loan_out: 'Loan given',
  loan_in: 'Loan received',
  loan_repayment_in: 'Loan repaid to you',
  loan_repayment_out: 'Loan repaid by you',
};

const emptyFilters: TransactionFilters = { search: '', type: '', accountId: '', categoryId: '', from: '', to: '' };

export function TransactionsPage() {
  const [filters, setFilters] = useState<TransactionFilters>(emptyFilters);
  const [pages, setPages] = useState(1);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const lookups = useAsyncData(async () => {
    const [accounts, categories] = await Promise.all([listAccounts(), listCategories()]);
    return {
      accounts,
      categories,
      accountNames: new Map(accounts.map((a) => [a.id, a.name])),
      categoryNames: new Map(categories.map((c) => [c.id, c.name])),
    };
  }, []);

  const list = useAsyncData(async () => {
    const rows = await listTransactions(filters, 0, PAGE_SIZE * pages);
    return { rows, hasMore: rows.length === PAGE_SIZE * pages };
  }, [filters, pages]);

  async function onDelete(row: Transaction) {
    if (!window.confirm('Delete this transaction? Balances will update and the change is recorded in the audit log.')) return;
    try {
      await deleteTransaction(row.id);
      setMessage({ tone: 'success', text: 'Transaction deleted.' });
      list.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not delete the transaction.' });
    }
  }

  async function onExport() {
    try {
      const rows = await listAllTransactionsForExport(filters);
      const names = lookups.data;
      const csv = toCsv(
        rows.map((r) => ({
          date: r.occurred_on,
          type: typeLabel[r.type],
          account: names?.accountNames.get(r.account_id) ?? '',
          category: r.category_id ? names?.categoryNames.get(r.category_id) ?? '' : '',
          description: r.description ?? '',
          amount: r.amount,
          signed_amount: r.signed_amount,
        })),
        ['date', 'type', 'account', 'category', 'description', 'amount', 'signed_amount'],
      );
      downloadCsv(`transactions-${todayIso()}.csv`, csv);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Export failed.' });
    }
  }

  const categoryMap = lookups.data?.categoryNames;

  return (
    <>
      <PageHeading
        title="Transactions"
        description="Income, expenses and refunds. Transfers and loans have their own pages and never count as income or expense."
        actions={<Button variant="secondary" onClick={() => void onExport()} disabled={!lookups.data}>Export CSV</Button>}
      />

      {message && <div className="mb-4"><Alert tone={message.tone === 'error' ? 'error' : 'success'}>{message.text}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Filters">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Search description">
                <Input value={filters.search} onChange={(e) => { setPages(1); setFilters({ ...filters, search: e.target.value }); }} placeholder="e.g. groceries" />
              </Field>
              <Field label="Type">
                <Select value={filters.type} onChange={(e) => { setPages(1); setFilters({ ...filters, type: e.target.value as TransactionType | '' }); }}>
                  <option value="">All</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="refund">Refund</option>
                  <option value="loan_out">Loan given</option>
                  <option value="loan_in">Loan received</option>
                  <option value="loan_repayment_in">Loan repaid to you</option>
                  <option value="loan_repayment_out">Loan repaid by you</option>
                </Select>
              </Field>
              <Field label="Account">
                <Select value={filters.accountId} onChange={(e) => { setPages(1); setFilters({ ...filters, accountId: e.target.value }); }}>
                  <option value="">All accounts</option>
                  {lookups.data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              <Field label="Category">
                <Select value={filters.categoryId} onChange={(e) => { setPages(1); setFilters({ ...filters, categoryId: e.target.value }); }}>
                  <option value="">All categories</option>
                  {lookups.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="From">
                <Input type="date" value={filters.from} onChange={(e) => { setPages(1); setFilters({ ...filters, from: e.target.value }); }} />
              </Field>
              <Field label="To">
                <Input type="date" value={filters.to} onChange={(e) => { setPages(1); setFilters({ ...filters, to: e.target.value }); }} />
              </Field>
            </div>
            <div className="mt-3">
              <Button variant="ghost" onClick={() => { setPages(1); setFilters(emptyFilters); }}>Clear filters</Button>
            </div>
          </Card>

          <Card title="Results" className="mt-4">
            {list.loading && <Spinner />}
            {list.error && <Alert>{list.error}</Alert>}
            {list.data && list.data.rows.length === 0 && <Empty>No transactions match these filters.</Empty>}
            {list.data && list.data.rows.length > 0 && (
              <>
                <TableWrap>
                  <thead>
                    <tr>
                      <th className={th}>Date</th>
                      <th className={th}>Description</th>
                      <th className={th}>Account</th>
                      <th className={`${th} text-right`}>Amount</th>
                      <th className={th}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={`${td} whitespace-nowrap`}>{r.occurred_on}</td>
                        <td className={td}>
                          <span className="block">{r.description || typeLabel[r.type]}</span>
                          <span className="text-xs text-slate-500">
                            {typeLabel[r.type]}
                            {r.category_id && categoryMap?.get(r.category_id) ? ` · ${categoryMap.get(r.category_id)}` : ''}
                            {isLoanMovement(r.type) && ' · loan'}
                          </span>
                        </td>
                        <td className={td}>{lookups.data?.accountNames.get(r.account_id) ?? ''}</td>
                        <td className={`${td} text-right`}><Money value={r.signed_amount} /></td>
                        <td className={`${td} text-right`}>
                          {!isLoanMovement(r.type) && (
                            <Button variant="danger" onClick={() => void onDelete(r)}>Delete</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
                {list.data.hasMore && (
                  <div className="mt-3 text-center">
                    <Button variant="secondary" onClick={() => setPages((p) => p + 1)}>Load more</Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        <TransactionForm
          accounts={lookups.data?.accounts ?? []}
          categories={lookups.data?.categories ?? []}
          onSaved={(text) => {
            setMessage({ tone: 'success', text });
            list.reload();
          }}
        />
      </div>
    </>
  );
}

function TransactionForm({
  accounts,
  categories,
  onSaved,
}: {
  accounts: Array<{ id: string; name: string; is_archived: boolean }>;
  categories: Array<{ id: string; name: string; kind: 'income' | 'expense' }>;
  onSaved: (text: string) => void;
}) {
  const [type, setType] = useState<'income' | 'expense' | 'refund'>('expense');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tracker = useRef(createIdempotencyTracker()).current;

  const activeAccounts = accounts.filter((a) => !a.is_archived);
  const wantedKind = type === 'income' ? 'income' : 'expense';
  const categoryOptions = useMemo(() => categories.filter((c) => c.kind === wantedKind), [categories, wantedKind]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = { accountId: accountId || '', type, amount, occurredOn, categoryId, description };
    const parsed = transactionSchema.safeParse(payload);
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signature = JSON.stringify(parsed.data);
      await createTransaction(parsed.data, tracker.keyFor(signature));
      tracker.reset();
      setAmount('');
      setDescription('');
      onSaved('Transaction saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the transaction.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add transaction">
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Type">
          <Select value={type} onChange={(e) => { setType(e.target.value as typeof type); setCategoryId(''); }}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="refund">Refund</option>
          </Select>
        </Field>
        <Field label="Account">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">Choose an account</option>
            {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Amount (BDT)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </Field>
        <Field label="Date">
          <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
        </Field>
        <Field label="Category" hint={type === 'refund' ? 'Refunds reduce the expense category they belong to.' : undefined}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Description">
          <Input value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || activeAccounts.length === 0}>
          {busy ? 'Saving…' : 'Save transaction'}
        </Button>
        {activeAccounts.length === 0 && <p className="text-xs text-slate-500">Add an active account first.</p>}
      </form>
    </Card>
  );
}
