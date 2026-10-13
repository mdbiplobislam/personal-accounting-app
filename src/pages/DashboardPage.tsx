import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { Card, Empty, Money, PageHeading, Spinner, StatCard, Alert } from '../components/ui';
import { listAccounts, listBalances, listCategories, listTransactions, monthlyReport } from '../lib/api';
import { amountOwed, netWorth } from '../lib/accounting';
import { formatMoney } from '../lib/money';
import { monthName } from '../lib/dates';
import { useAsyncData } from '../lib/useAsyncData';
import type { AccountType, MonthlySummary, Transaction } from '../lib/types';

const accountTypeLabel: Record<AccountType, string> = {
  cash: 'Cash', bank: 'Bank', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', credit_card: 'Credit card', other: 'Other',
};

interface DashboardData {
  balances: Awaited<ReturnType<typeof listBalances>>;
  report: MonthlySummary[];
  recent: Transaction[];
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
}

async function loadDashboard(): Promise<DashboardData> {
  const year = new Date().getFullYear();
  const [balances, report, recent, accounts, categories] = await Promise.all([
    listBalances(),
    monthlyReport(year),
    listTransactions({}, 0, 6),
    listAccounts(),
    listCategories(),
  ]);
  return {
    balances,
    report,
    recent,
    accountNames: new Map(accounts.map((a) => [a.id, a.name])),
    categoryNames: new Map(categories.map((c) => [c.id, c.name])),
  };
}

export function DashboardPage() {
  const { data, error, loading } = useAsyncData(loadDashboard, []);

  if (loading) return <Spinner />;
  if (error || !data) return <Alert>{error ?? 'Could not load the dashboard.'}</Alert>;

  const currentMonth = new Date().getMonth() + 1;
  const thisMonth = data.report.find((m) => m.month === currentMonth);
  const yearTotals = data.report.reduce(
    (acc, m) => ({ income: acc.income + m.total_income, expense: acc.expense + m.net_expense }),
    { income: 0, expense: 0 },
  );
  const chartData = data.report.map((m) => ({
    month: monthName(m.month),
    Income: m.total_income,
    Expense: m.net_expense,
  }));
  const owedTotal = data.balances.reduce((sum, b) => sum + amountOwed(b.type, b.current_balance), 0);

  return (
    <>
      <PageHeading title="Dashboard" description="Your position this month and across the year." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net worth" hint={owedTotal > 0 ? `Includes ${formatMoney(owedTotal)} card debt` : undefined}>
          <Money value={netWorth(data.balances)} />
        </StatCard>
        <StatCard label="Income this month" hint="Excludes transfers and borrowed money">
          <Money value={thisMonth?.total_income ?? 0} />
        </StatCard>
        <StatCard label="Net expense this month" hint="Expenses less refunds">
          <Money value={thisMonth?.net_expense ?? 0} />
        </StatCard>
        <StatCard label="Net savings this month">
          <Money value={thisMonth?.net_savings ?? 0} />
        </StatCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={`Income and expense, ${new Date().getFullYear()}`} className="lg:col-span-2">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={72} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend />
                <Bar dataKey="Income" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expense" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Year to date: income {formatMoney(yearTotals.income)}, net expense {formatMoney(yearTotals.expense)}.
          </p>
        </Card>

        <Card title="Accounts" actions={<Link className="text-sm font-medium text-teal-700 dark:text-teal-300" to="/accounts">Manage</Link>}>
          {data.balances.length === 0 ? (
            <Empty>No accounts yet. Add one to start tracking.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.balances.filter((b) => !b.is_archived).map((b) => (
                <li key={b.account_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{b.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{accountTypeLabel[b.type]}</span>
                  </span>
                  <Money value={b.current_balance} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent transactions" className="mt-4" actions={<Link className="text-sm font-medium text-teal-700 dark:text-teal-300" to="/transactions">View all</Link>}>
        {data.recent.length === 0 ? (
          <Empty>No transactions yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recent.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{t.description || t.type}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {t.occurred_on} · {data.accountNames.get(t.account_id) ?? 'Account'}
                    {t.category_id && ` · ${data.categoryNames.get(t.category_id) ?? ''}`}
                  </span>
                </span>
                <Money value={t.signed_amount} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
