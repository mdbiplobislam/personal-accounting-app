import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Empty, Field, Input, Money, PageHeading, Select, Spinner, td, th, TableWrap } from '../components/ui';
import { deleteBudget, listBudgetStatus, listCategories, saveBudget } from '../lib/api';
import { formatMoney } from '../lib/money';
import { monthToFirstDay, toMonthValue } from '../lib/dates';
import { budgetSchema, firstError } from '../lib/schemas';
import { useAsyncData } from '../lib/useAsyncData';

export function BudgetsPage() {
  const [monthValue, setMonthValue] = useState(() => toMonthValue(new Date()));
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const monthFirstDay = monthToFirstDay(monthValue);

  const { data, error, loading, reload } = useAsyncData(async () => {
    const [statuses, categories] = await Promise.all([listBudgetStatus(monthFirstDay), listCategories('expense')]);
    return { statuses, categories };
  }, [monthFirstDay]);

  async function onDelete(budgetId: string) {
    if (!window.confirm('Remove this budget for the selected month?')) return;
    try {
      await deleteBudget(budgetId);
      reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not remove the budget.' });
    }
  }

  return (
    <>
      <PageHeading
        title="Budgets"
        description="Monthly spending limits per expense category. Spending is expenses minus refunds."
        actions={
          <Field label="Month">
            <Input type="month" value={monthValue} onChange={(e) => e.target.value && setMonthValue(e.target.value)} />
          </Field>
        }
      />
      {message && <div className="mb-4"><Alert tone={message.tone === 'error' ? 'error' : 'success'}>{message.text}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="This month">
            {loading && <Spinner />}
            {error && <Alert>{error}</Alert>}
            {data && data.statuses.length === 0 && <Empty>No budgets for this month yet.</Empty>}
            {data && data.statuses.length > 0 && (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Category</th>
                    <th className={`${th} text-right`}>Spent</th>
                    <th className={`${th} text-right`}>Budget</th>
                    <th className={th}>Progress</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.statuses.map((s) => {
                    const pct = s.budget_amount > 0 ? Math.min(100, Math.round((s.spent / s.budget_amount) * 100)) : 0;
                    const over = s.spent > s.budget_amount;
                    return (
                      <tr key={s.budget_id}>
                        <td className={td}>{s.category_name}</td>
                        <td className={`${td} text-right`}><Money value={s.spent} /></td>
                        <td className={`${td} text-right`}>{formatMoney(s.budget_amount)}</td>
                        <td className={td}>
                          <div className="h-2 w-32 rounded bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                            <div className={`h-2 rounded ${over ? 'bg-red-500' : 'bg-teal-600'}`} style={{ width: `${pct}%` }} />
                          </div>
                          {over && <span className="text-xs text-red-600 dark:text-red-400">Over budget</span>}
                        </td>
                        <td className={`${td} text-right`}>
                          <Button variant="danger" onClick={() => void onDelete(s.budget_id)}>Remove</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <BudgetForm
          monthFirstDay={monthFirstDay}
          categories={data?.categories ?? []}
          onSaved={() => { setMessage({ tone: 'success', text: 'Budget saved.' }); reload(); }}
          onError={(text) => setMessage({ tone: 'error', text })}
        />
      </div>
    </>
  );
}

function BudgetForm({
  monthFirstDay,
  categories,
  onSaved,
  onError,
}: {
  monthFirstDay: string;
  categories: Array<{ id: string; name: string }>;
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = budgetSchema.safeParse({ categoryId, month: monthFirstDay.slice(0, 7), amount });
    if (!parsed.success) {
      setFormError(firstError(parsed));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await saveBudget({ ...parsed.data, month: monthFirstDay });
      setAmount('');
      onSaved();
    } catch (err) {
      // A second budget for the same category and month is rejected by a unique constraint.
      const text = err instanceof Error && /duplicate key/i.test(err.message)
        ? 'A budget already exists for this category this month. Remove it first to change it.'
        : err instanceof Error ? err.message : 'Could not save the budget.';
      setFormError(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Set a budget">
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="Expense category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Monthly limit (BDT)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save budget'}</Button>
      </form>
    </Card>
  );
}

