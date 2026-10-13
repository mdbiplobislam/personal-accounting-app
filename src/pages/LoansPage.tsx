import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Empty, Field, Input, Money, PageHeading, Select, Spinner, TableWrap, TextArea, td, th } from '../components/ui';
import { createLoan, listAccounts, listLoans, listRepayments, recordRepayment } from '../lib/api';
import { createIdempotencyTracker } from '../lib/idempotency';
import { formatMoney } from '../lib/money';
import { todayIso } from '../lib/dates';
import { firstError, loanSchema, repaymentSchema } from '../lib/schemas';
import { useAsyncData } from '../lib/useAsyncData';
import type { Loan } from '../lib/types';

export function LoansPage() {
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [loans, repayments, accounts] = await Promise.all([listLoans(), listRepayments(), listAccounts()]);
    return { loans, repayments, accounts };
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const given = useMemo(() => (data?.loans ?? []).filter((l) => l.direction === 'given'), [data]);
  const received = useMemo(() => (data?.loans ?? []).filter((l) => l.direction === 'received'), [data]);
  const selected = data?.loans.find((l) => l.id === selectedId) ?? null;
  const selectedRepayments = (data?.repayments ?? []).filter((r) => r.loan_id === selectedId);

  return (
    <>
      <PageHeading
        title="Loans"
        description="Money you lent out or borrowed. Loans move cash but are not income or expense: only the interest on a repayment counts."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {loading && <Spinner />}
          {error && <Alert>{error}</Alert>}
          <LoanTable title="Lent to others" loans={given} selectedId={selectedId} onSelect={setSelectedId} />
          <LoanTable title="Borrowed from others" loans={received} selectedId={selectedId} onSelect={setSelectedId} />

          {selected && (
            <Card title={`Ledger: ${selected.counterparty}`}>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                Original {formatMoney(selected.principal)} · outstanding <Money value={selected.outstanding_principal} /> · {selected.status}
              </p>
              {selectedRepayments.length === 0 ? (
                <Empty>No repayments recorded yet.</Empty>
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th className={th}>Paid on</th>
                      <th className={`${th} text-right`}>Principal</th>
                      <th className={`${th} text-right`}>Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRepayments.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>{r.paid_on}</td>
                        <td className={`${td} text-right`}>{formatMoney(r.principal_amount)}</td>
                        <td className={`${td} text-right`}>{formatMoney(r.interest_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <LoanForm accounts={data?.accounts ?? []} onSaved={reload} />
          <RepaymentForm
            loans={(data?.loans ?? []).filter((l) => l.status === 'active')}
            accounts={data?.accounts ?? []}
            initialLoanId={selectedId}
            onSaved={reload}
          />
        </div>
      </div>
    </>
  );
}

function LoanTable({ title, loans, selectedId, onSelect }: { title: string; loans: Loan[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <Card title={title}>
      {loans.length === 0 ? (
        <Empty>Nothing here yet.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Counterparty</th>
              <th className={`${th} text-right`}>Principal</th>
              <th className={`${th} text-right`}>Outstanding</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => {
              const repaidPct = l.principal > 0 ? Math.round(((l.principal - l.outstanding_principal) / l.principal) * 100) : 100;
              return (
                <tr key={l.id} className={selectedId === l.id ? 'bg-teal-50/60 dark:bg-teal-950/30' : undefined}>
                  <td className={td}>
                    <button type="button" className="font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300" onClick={() => onSelect(l.id)}>
                      {l.counterparty}
                    </button>
                    <div className="mt-1 h-1.5 w-28 rounded bg-slate-200 dark:bg-slate-800" aria-label={`${repaidPct}% repaid`}>
                      <div className="h-1.5 rounded bg-teal-600" style={{ width: `${repaidPct}%` }} />
                    </div>
                  </td>
                  <td className={`${td} text-right`}>{formatMoney(l.principal)}</td>
                  <td className={`${td} text-right`}><Money value={l.outstanding_principal} /></td>
                  <td className={td}>{l.status === 'settled' ? 'Settled' : 'Active'}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

function LoanForm({ accounts, onSaved }: { accounts: Array<{ id: string; name: string; is_archived: boolean }>; onSaved: () => void }) {
  const [direction, setDirection] = useState<'given' | 'received'>('given');
  const [counterparty, setCounterparty] = useState('');
  const [principal, setPrincipal] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tracker = useRef(createIdempotencyTracker()).current;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = loanSchema.safeParse({ direction, counterparty, principal, startDate, dueDate, accountId, notes });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createLoan(parsed.data, tracker.keyFor(JSON.stringify(parsed.data)));
      tracker.reset();
      setCounterparty('');
      setPrincipal('');
      setNotes('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the loan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Record a loan">
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Direction">
          <Select value={direction} onChange={(e) => setDirection(e.target.value as 'given' | 'received')}>
            <option value="given">I lent money</option>
            <option value="received">I borrowed money</option>
          </Select>
        </Field>
        <Field label="Person or organisation">
          <Input value={counterparty} maxLength={100} onChange={(e) => setCounterparty(e.target.value)} />
        </Field>
        <Field label="Principal (BDT)">
          <Input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Cash moved through account" hint="Optional. Leave empty to record the loan without a cash movement.">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">No cash movement</option>
            {accounts.filter((a) => !a.is_archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <TextArea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record loan'}</Button>
      </form>
    </Card>
  );
}

function RepaymentForm({
  loans,
  accounts,
  initialLoanId,
  onSaved,
}: {
  loans: Loan[];
  accounts: Array<{ id: string; name: string; is_archived: boolean }>;
  initialLoanId: string | null;
  onSaved: () => void;
}) {
  const [loanId, setLoanId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tracker = useRef(createIdempotencyTracker()).current;

  const chosenLoanId = loanId || (initialLoanId && loans.some((l) => l.id === initialLoanId) ? initialLoanId : '');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = repaymentSchema.safeParse({ loanId: chosenLoanId, accountId, principal: principal || 0, interest: interest || 0, paidOn });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordRepayment(parsed.data, tracker.keyFor(JSON.stringify(parsed.data)));
      tracker.reset();
      setPrincipal('');
      setInterest('');
      onSaved();
    } catch (err) {
      // The database message is specific (for example "principal exceeds outstanding balance").
      setError(err instanceof Error ? err.message : 'Could not record the repayment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Record a repayment">
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Loan">
          <Select value={chosenLoanId} onChange={(e) => setLoanId(e.target.value)}>
            <option value="">Choose a loan</option>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.counterparty} ({l.direction === 'given' ? 'lent' : 'borrowed'}, outstanding {formatMoney(l.outstanding_principal)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cash account">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.filter((a) => !a.is_archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Principal (BDT)">
            <Input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Interest (BDT)" hint={chosenLoanId && loans.find((l) => l.id === chosenLoanId)?.direction === 'given' ? 'Counts as income.' : 'Counts as expense.'}>
            <Input inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field label="Paid on">
          <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy || loans.length === 0}>{busy ? 'Saving…' : 'Record repayment'}</Button>
        {loans.length === 0 && <p className="text-xs text-slate-500">No active loans to repay.</p>}
      </form>
    </Card>
  );
}
