import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, errorMessage } from '../../lib/api';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';

interface ForgotResponse {
  message: string;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  useDocumentTitle('Forgot password');

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (email.trim() === '') {
      setError('Enter your account email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<ForgotResponse>('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setSentMessage(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Forgot password</h1>
        {sentMessage !== null ? (
          <>
            <div className="sub">Request received</div>
            <Flash kind="success" message={sentMessage} onDismiss={() => setSentMessage(null)} />
            <p style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
              Check the email inbox for your clinic account. The link is valid for 30 minutes.
            </p>
            <Link className="btn btn-secondary" to="/login" style={{ width: '100%' }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="sub">
              Enter your account email and we will send you a reset link.
            </div>
            {error ? <Flash kind="error" message={error} onDismiss={() => setError(null)} /> : null}
            <form onSubmit={(e) => void onSubmit(e)} noValidate>
              <FormField label="Email" required>
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </FormField>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={busy}
              >
                {busy ? 'Sending…' : 'Send reset link'}
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
