import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { firstError } from '../lib/schemas';

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-center text-lg font-bold text-teal-800 dark:text-teal-300">Personal Accounting</p>
        <Card title={title}>{children}</Card>
        <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">{footer}</p>
      </div>
    </main>
  );
}

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    const failure = await signIn(parsed.data.email, parsed.data.password);
    setBusy(false);
    if (failure) {
      setError('Email or password is incorrect.');
      return;
    }
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    navigate(from, { replace: true });
  }

  return (
    <AuthShell title="Sign in" footer={<>No account? <Link className="font-medium text-teal-700 dark:text-teal-300" to="/signup">Create one</Link></>}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { user, signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(firstError(parsed));
      return;
    }
    setBusy(true);
    const failure = await signUp(parsed.data.email, parsed.data.password, displayName.trim() || parsed.data.email.split('@')[0]);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setNotice('Account created. If email confirmation is enabled, check your inbox before signing in.');
  }

  return (
    <AuthShell title="Create account" footer={<>Already registered? <Link className="font-medium text-teal-700 dark:text-teal-300" to="/login">Sign in</Link></>}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Field label="Display name">
          <Input value={displayName} maxLength={100} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
      </form>
    </AuthShell>
  );
}
