import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from './ui';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/accounts', label: 'Accounts' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/transfers', label: 'Transfers' },
  { to: '/loans', label: 'Loans' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/goals', label: 'Goals' },
  { to: '/reports', label: 'Reports' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive
      ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
  ].join(' ');

export function Layout() {
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <p className="mb-6 px-3 text-lg font-bold text-teal-800 dark:text-teal-300">Personal Accounting</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:px-6">
          <p className="text-base font-bold text-teal-800 dark:text-teal-300 md:hidden">Accounting</p>
          <p className="hidden truncate text-sm text-slate-600 dark:text-slate-400 md:block">{user?.email}</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={toggle} aria-label="Toggle colour theme">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </Button>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <nav aria-label="Main mobile" className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 md:hidden">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
