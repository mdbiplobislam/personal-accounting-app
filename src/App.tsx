import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { envError } from './lib/env';
import { Alert, Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage, SignupPage } from './pages/AuthPages';

// Feature pages load on demand, so the charting library is only fetched when a page needs it.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AccountsPage = lazy(() => import('./pages/AccountsPage').then((m) => ({ default: m.AccountsPage })));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })));
const TransfersPage = lazy(() => import('./pages/TransfersPage').then((m) => ({ default: m.TransfersPage })));
const LoansPage = lazy(() => import('./pages/LoansPage').then((m) => ({ default: m.LoansPage })));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage').then((m) => ({ default: m.BudgetsPage })));
const GoalsPage = lazy(() => import('./pages/GoalsPage').then((m) => ({ default: m.GoalsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Alert>{message}</Alert>
    </main>
  );
}

export default function App() {
  if (envError) {
    return <ConfigError message={envError} />;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Lazy><DashboardPage /></Lazy>} />
                <Route path="accounts" element={<Lazy><AccountsPage /></Lazy>} />
                <Route path="transactions" element={<Lazy><TransactionsPage /></Lazy>} />
                <Route path="transfers" element={<Lazy><TransfersPage /></Lazy>} />
                <Route path="loans" element={<Lazy><LoansPage /></Lazy>} />
                <Route path="budgets" element={<Lazy><BudgetsPage /></Lazy>} />
                <Route path="goals" element={<Lazy><GoalsPage /></Lazy>} />
                <Route path="reports" element={<Lazy><ReportsPage /></Lazy>} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
