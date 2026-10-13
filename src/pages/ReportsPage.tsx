import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Button, Card, Field, PageHeading, Select, Spinner, TableWrap, td, th } from '../components/ui';
import { monthlyReport } from '../lib/api';
import { downloadCsv, toCsv } from '../lib/csv';
import { monthName } from '../lib/dates';
import { addMoney, formatMoney } from '../lib/money';
import { useAsyncData } from '../lib/useAsyncData';

const columns = [
  { key: 'month', label: 'Month' },
  { key: 'income', label: 'Income' },
  { key: 'interest_income', label: 'Loan interest income' },
  { key: 'total_income', label: 'Total income' },
  { key: 'expense', label: 'Expense' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'interest_expense', label: 'Loan interest expense' },
  { key: 'net_expense', label: 'Net expense' },
  { key: 'net_savings', label: 'Net savings' },
] as const;

type ColumnKey = (typeof columns)[number]['key'];

export function ReportsPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const { data, error, loading } = useAsyncData(() => monthlyReport(year), [year]);

  const totals = (key: Exclude<ColumnKey, 'month'>) =>
    data ? addMoney(...data.map((row) => row[key])) : 0;

  function onExport() {
    if (!data) return;
    const rows = data.map((row) => ({ ...row, month: `${year}-${String(row.month).padStart(2, '0')}` }));
    const csv = toCsv(rows, columns.map((c) => c.key));
    downloadCsv(`monthly-report-${year}.csv`, csv);
  }

  const chart = data?.map((row) => ({
    month: monthName(row.month),
    Income: row.total_income,
    'Net expense': row.net_expense,
    'Net savings': row.net_savings,
  }));

  return (
    <>
      <PageHeading
        title="Reports"
        description="Monthly and yearly totals. Transfers and loan principal are excluded. Refunds reduce expense."
        actions={
          <div className="flex items-end gap-2">
            <Field label="Year">
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </Field>
            <Button variant="secondary" onClick={onExport} disabled={!data}>Export CSV</Button>
          </div>
        }
      />

      {loading && <Spinner />}
      {error && <Alert>{error}</Alert>}

      {data && (
        <>
          <Card title={`Year ${year} at a glance`}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-slate-500">Total income</p><p className="text-lg font-semibold">{formatMoney(totals('total_income'))}</p></div>
              <div><p className="text-slate-500">Net expense</p><p className="text-lg font-semibold">{formatMoney(totals('net_expense'))}</p></div>
              <div><p className="text-slate-500">Refunds</p><p className="text-lg font-semibold">{formatMoney(totals('refunds'))}</p></div>
              <div><p className="text-slate-500">Net savings</p><p className="text-lg font-semibold">{formatMoney(totals('net_savings'))}</p></div>
            </div>
          </Card>

          <Card title="Income, expense and savings by month" className="mt-4">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={72} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                  <Legend />
                  <Bar dataKey="Income" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Net expense" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Net savings" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Monthly detail" className="mt-4">
            <TableWrap>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={`${th} ${c.key === 'month' ? '' : 'text-right'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.month}>
                    {columns.map((c) => (
                      <td key={c.key} className={`${td} ${c.key === 'month' ? '' : 'text-right tabular-nums'}`}>
                        {c.key === 'month' ? monthName(row.month) : formatMoney(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}
