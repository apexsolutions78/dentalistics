import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { FormField } from '../components/FormField';
import { Flash } from '../components/Flash';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function LoginPage() {
  const { status, login, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email: string | null; password: string | null }>({
    email: null,
    password: null,
  });
  const [expiredDismissed, setExpiredDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Sign in');
  const passwordResetDone =
    (location.state as { passwordReset?: boolean } | null)?.passwordReset === true;
  const sessionExpiredNotice =
    (location.state as { sessionExpired?: boolean } | null)?.sessionExpired === true &&
    !expiredDismissed;

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    const nextErrors = {
      email:
        trimmed.length === 0
          ? 'Email is required.'
          : !EMAIL_PATTERN.test(trimmed)
            ? 'Enter a valid email address.'
            : null,
      password: password.length === 0 ? 'Password is required.' : null,
    };
    setFieldErrors(nextErrors);
    if (nextErrors.email !== null || nextErrors.password !== null) return;
    setBusy(true);
    setError(null);
    try {
      await login(trimmed, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Apex Dentalistics</h1>
        <div className="sub">Sign in to your clinic account</div>
        {passwordResetDone ? (
          <Flash
            kind="success"
            message="Password updated. Sign in with your new password."
            onDismiss={() => undefined}
          />
        ) : null}
        {sessionExpiredNotice ? (
          <Flash
            kind="error"
            message="Your session has expired. Please sign in again."
            onDismiss={() => {
              setExpiredDismissed(true);
              clearSessionExpired();
            }}
          />
        ) : null}
        {error ? <Flash kind="error" message={error} onDismiss={() => setError(null)} /> : null}
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <FormField label="Email" htmlFor="login-email" error={fieldErrors.email}>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((prev) => ({ ...prev, email: null }));
              }}
              autoFocus
              required
            />
          </FormField>
          <FormField label="Password" htmlFor="login-password" error={fieldErrors.password}>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((prev) => ({ ...prev, password: null }));
              }}
              required
            />
          </FormField>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: 0, marginBottom: 'var(--space-3)' }}
            aria-controls="login-password"
            onClick={() => setShowPassword((prev) => !prev)}
          >
            {showPassword ? 'Hide password' : 'Show password'}
          </button>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ marginTop: '12px', fontSize: 'var(--fs-label)', textAlign: 'center' }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
