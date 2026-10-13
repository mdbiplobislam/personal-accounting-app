import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Empty, Field, Input, Money, PageHeading, Select, Spinner, TableWrap, td, th } from '../components/ui';
import { listAccounts, listBalances, saveAccount, setAccountArchived } from '../lib/api';
import { amountOwed } from '../lib/accounting';
import { accountSchema, firstError, type AccountInput } from '../lib/schemas';
import { useAsyncData } from '../lib/useAsyncData';
import type { AccountType } from '../lib/types';

export const accountTypeOptions: Array<{ value: AccountType; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank account' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'other', label: 'Other' },
];

const typeLabel = Object.fromEntries(accountTypeOptions.map((o) => [o.value, o.label])) as Record<AccountType, string>;

const emptyForm = { name: '', type: 'cash' as AccountType, openingBalance: '0' };

export function AccountsPage() {
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [accounts, balances] = await Promise.all([listAccounts(), listBalances()]);
    return { accounts, balances: new Map(balances.map((b) => [b.account_id, b])) };
  }, []);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function startEdit(id: string) {
    const account = data?.accounts.find((a) => a.id === id);
    if (!account) return;
    setEditingId(id);
    setForm({ name: account.name, type: account.type, openingBalance: String(account.opening_balance) });
    setFormError(null);
    setSaved(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = accountSchema.safeParse({ ...form, openingBalance: form.openingBalance === '' ? 0 : form.openingBalance });
    if (!parsed.success) {
      setFormError(firstError(parsed));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await saveAccount(parsed.data as AccountInput, editingId ?? undefined);
      setSaved(editingId ? 'Account updated.' : 'Account added.');
      setEditingId(null);
      setForm(emptyForm);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the account.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(id: string, archived: boolean) {
    try {
      await setAccountArchived(id, archived);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update the account.');
    }
  }

  return (
    <>
      <PageHeading title="Accounts" description="Cash, bank, mobile wallets and credit cards. Balances are calculated from opening balance plus every movement." />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Your accounts">
            {loading && <Spinner />}
            {error && <Alert>{error}</Alert>}
            {data && data.accounts.length === 0 && <Empty>Add your first account using the form.</Empty>}
            {data && data.accounts.length > 0 && (
              <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Type</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => {
                    const balance = data.balances.get(a.id)?.current_balance ?? a.opening_balance;
                    const owed = amountOwed(a.type, balance);
                    return (
                      <tr key={a.id} className={a.is_archived ? 'opacity-60' : undefined}>
                        <td className={td}>
                          {a.name}
                          {a.is_archived && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-700">Archived</span>}
                        </td>
                        <td className={td}>{typeLabel[a.type]}</td>
                        <td className={`${td} text-right`}>
                          <Money value={balance} />
                          {owed > 0 && <span className="block text-xs text-red-600 dark:text-red-400">Owed</span>}
                        </td>
                        <td className={`${td} text-right whitespace-nowrap`}>
                          <Button variant="ghost" onClick={() => startEdit(a.id)}>Edit</Button>
                          <Button variant="ghost" onClick={() => void toggleArchive(a.id, !a.is_archived)}>
                            {a.is_archived ? 'Restore' : 'Archive'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <Card title={editingId ? 'Edit account' : 'Add account'}>
          <form ref={formRef} className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
            {formError && <Alert>{formError}</Alert>}
            {saved && <Alert tone="success">{saved}</Alert>}
            <Field label="Name">
              <Input value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
                {accountTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
            <Field
              label="Opening balance (BDT)"
              hint={form.type === 'credit_card' ? 'Enter a negative number for an amount already owed.' : 'Balance on the day you start tracking.'}
            >
              <Input inputMode="decimal" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add account'}</Button>
              {editingId && <Button variant="secondary" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button>}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
