import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Empty, Field, Input, PageHeading, Spinner } from '../components/ui';
import { deleteSavingsGoal, listSavingsGoals, saveSavingsGoal } from '../lib/api';
import { addMoney, formatMoney } from '../lib/money';
import { firstError, savingsGoalSchema } from '../lib/schemas';
import { useAsyncData } from '../lib/useAsyncData';
import type { SavingsGoal } from '../lib/types';

export function GoalsPage() {
  const { data, error, loading, reload } = useAsyncData(listSavingsGoals, []);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function onDelete(goal: SavingsGoal) {
    if (!window.confirm(`Delete the goal "${goal.name}"? This does not change any account balance.`)) return;
    try {
      await deleteSavingsGoal(goal.id);
      reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not delete the goal.' });
    }
  }

  return (
    <>
      <PageHeading
        title="Savings goals"
        description="Track progress toward a target. Savings are recorded by you, so they do not move money between accounts."
      />
      {message && <div className="mb-4"><Alert tone={message.tone === 'error' ? 'error' : 'success'}>{message.text}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {loading && <Spinner />}
          {error && <Alert>{error}</Alert>}
          {data && data.length === 0 && <Empty>No goals yet. Add one to start tracking progress.</Empty>}
          {data?.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onChanged={reload} onDelete={() => void onDelete(goal)} onError={(text) => setMessage({ tone: 'error', text })} />
          ))}
        </div>
        <GoalForm onSaved={() => { setMessage({ tone: 'success', text: 'Goal saved.' }); reload(); }} />
      </div>
    </>
  );
}

function GoalCard({ goal, onChanged, onDelete, onError }: { goal: SavingsGoal; onChanged: () => void; onDelete: () => void; onError: (text: string) => void }) {
  const [adding, setAdding] = useState('');
  const pct = goal.target_amount > 0 ? Math.min(100, Math.round((goal.saved_amount / goal.target_amount) * 100)) : 0;
  const remaining = Math.max(0, goal.target_amount - goal.saved_amount);

  async function addSavings(event: FormEvent) {
    event.preventDefault();
    const extra = Number(adding);
    const parsed = savingsGoalSchema.safeParse({ name: goal.name, targetAmount: goal.target_amount, savedAmount: addMoney(goal.saved_amount, extra), targetDate: goal.target_date ?? '' });
    if (!parsed.success || !(extra > 0)) {
      onError(parsed.success ? 'Enter an amount greater than zero.' : firstError(parsed) ?? 'Check the amount.');
      return;
    }
    try {
      await saveSavingsGoal({ ...parsed.data, savedAmount: parsed.data.savedAmount }, goal.id);
      setAdding('');
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update the goal.');
    }
  }

  return (
    <Card
      title={goal.name}
      actions={<Button variant="danger" onClick={onDelete}>Delete</Button>}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="text-lg font-semibold">{formatMoney(goal.saved_amount)}</span>
          <span className="text-slate-500"> of {formatMoney(goal.target_amount)}</span>
        </span>
        <span className="text-slate-600 dark:text-slate-400">
          {pct}%{goal.target_date && ` · target ${goal.target_date}`}
        </span>
      </div>
      <div className="mt-2 h-3 rounded bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-3 rounded bg-teal-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">{remaining > 0 ? `${formatMoney(remaining)} to go` : 'Goal reached'}</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={addSavings} noValidate>
        <div className="min-w-40 flex-1">
          <Field label="Add savings (BDT)">
            <Input inputMode="decimal" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">Add</Button>
      </form>
    </Card>
  );
}

function GoalForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [targetAmount, setTarget] = useState('');
  const [targetDate, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = savingsGoalSchema.safeParse({ name, targetAmount, savedAmount: 0, targetDate });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveSavingsGoal(parsed.data);
      setName('');
      setTarget('');
      setDate('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the goal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New goal">
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Goal name">
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Target (BDT)">
          <Input inputMode="decimal" value={targetAmount} onChange={(e) => setTarget(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Target date">
          <Input type="date" value={targetDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create goal'}</Button>
      </form>
    </Card>
  );
}
