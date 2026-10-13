import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Empty, Field, Input, PageHeading, Select, Spinner, TableWrap, td, th } from '../components/ui';
import { createTransfer, deleteTransfer, listAccounts, listTransfers } from '../lib/api';
import { createIdempotencyTracker } from '../lib/idempotency';
import { formatMoney } from '../lib/money';
import { todayIso } from '../lib/dates';
import { firstError, transferSchema } from '../lib/schemas';
import { useAsyncData } from '../lib/useAsyncData';

export function TransfersPage() {
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [accounts, transfers] = await Promise.all([listAccounts(), listTransfers(100)]);
    return { accounts, transfers, names: new Map(accounts.map((a) => [a.id, a.name])) };
  }, []);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function onDelete(id: string) {
    if (!window.confirm('Delete this transfer? Both account balances will be restored.')) return;
    try {
      await deleteTransfer(id);
      reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not delete the transfer.' });
    }
  }

  return (
    <>
      <PageHeading title="Transfers" description="Money moved between your own accounts, such as topping up bKash from your bank. Transfers are never income or expense." />
      {message && <div className="mb-4"><Alert tone={message.tone === 'error' ? 'error' : 'success'}>{message.text}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Recent transfers">
            {loading && <Spinner />}
            {error && <Alert>{error}</Alert>}
            {data && data.transfers.length === 0 && <Empty>No transfers yet.</Empty>}
            {data && data.transfers.length > 0 && (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>From → To</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.transfers.map((t) => (
                    <tr key={t.id}>
                      <td className={`${td} whitespace-nowrap`}>{t.transferred_on}</td>
                      <td className={td}>
                        {data.names.get(t.from_account_id) ?? 'Account'} → {data.names.get(t.to_account_id) ?? 'Account'}
                        {t.note && <span className="block text-xs text-slate-500">{t.note}</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(t.amount)}</td>
                      <td className={`${td} text-right`}>
                        <Button variant="danger" onClick={() => void onDelete(t.id)}>Delete</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <TransferForm accounts={data?.accounts ?? []} onSaved={() => { setMessage({ tone: 'success', text: 'Transfer saved.' }); reload(); }} />
      </div>
    </>
  );
}

function TransferForm({ accounts, onSaved }: { accounts: Array<{ id: string; name: string; is_archived: boolean }>; onSaved: () => void }) {
  const [fromAccountId, setFrom] = useState('');
  const [toAccountId, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [transferredOn, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tracker = useRef(createIdempotencyTracker()).current;
  const active = accounts.filter((a) => !a.is_archived);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = transferSchema.safeParse({ fromAccountId, toAccountId, amount, transferredOn, note });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTransfer(parsed.data, tracker.keyFor(JSON.stringify(parsed.data)));
      tracker.reset();
      setAmount('');
      setNote('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the transfer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New transfer">
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="From">
          <Select value={fromAccountId} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose an account</option>
            {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="To">
          <Select value={toAccountId} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose an account</option>
            {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Amount (BDT)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Date">
          <Input type="date" value={transferredOn} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note">
          <Input value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || active.length < 2}>{busy ? 'Saving…' : 'Save transfer'}</Button>
        {active.length < 2 && <p className="text-xs text-slate-500">You need at least two active accounts to transfer.</p>}
      </form>
    </Card>
  );
}
