import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, errorMessage } from '../../lib/api';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  useDocumentTitle('Reset password');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasToken = token !== '';

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 12) {
      setError('Password must be between 12 and 200 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Choose a new password</h1>
        {!hasToken ? (
          <>
            <div className="sub">This reset link is not valid.</div>
            <Flash
              kind="error"
              message="Reset link is invalid or has expired. Request a new one."
              onDismiss={() => undefined}
            />
            <Link className="btn btn-primary" to="/forgot-password" style={{ width: '100%' }}>
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <div className="sub">Pick a new password for your clinic account.</div>
            {error ? <Flash kind="error" message={error} onDismiss={() => setError(null)} /> : null}
            <form onSubmit={(e) => void onSubmit(e)} noValidate>
              <FormField
                label="New password"
                hint="Between 12 and 200 characters"
                htmlFor="reset-password"
                required
              >
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </FormField>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: 0, marginBottom: 'var(--space-3)' }}
                aria-controls="reset-password"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? 'Hide password' : 'Show password'}
              </button>
              <FormField label="Confirm password" htmlFor="reset-confirm" required>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </FormField>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
            <p style={{ marginTop: '12px', fontSize: 'var(--fs-label)' }}>
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
