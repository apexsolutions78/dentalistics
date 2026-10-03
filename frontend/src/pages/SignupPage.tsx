import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { FormField } from '../components/FormField';
import { Flash } from '../components/Flash';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

interface FieldErrors {
  clinicName: string | null;
  email: string | null;
  password: string | null;
}

export function SignupPage() {
  const { status, signup } = useAuth();
  const navigate = useNavigate();
  const [clinicName, setClinicName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({
    clinicName: null,
    email: null,
    password: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Start your free trial');

  if (status === 'authenticated') {
    return <Navigate to="/onboarding" replace />;
  }

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    const trimmedName = clinicName.trim();
    const trimmedEmail = email.trim();
    const nextErrors: FieldErrors = {
      clinicName:
        trimmedName.length < 2 ? 'Enter your clinic name (at least 2 characters).' : null,
      email:
        trimmedEmail.length === 0
          ? 'Email is required.'
          : !EMAIL_PATTERN.test(trimmedEmail)
            ? 'Enter a valid email address.'
            : null,
      password:
        password.length < 12 || password.length > 200
          ? 'Password must be between 12 and 200 characters.'
          : null,
    };
    setFieldErrors(nextErrors);
    if (nextErrors.clinicName !== null || nextErrors.email !== null || nextErrors.password !== null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup(trimmedName, trimmedEmail, password);
      navigate('/onboarding', { replace: true });
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
        <div className="sub">Start your free trial - no card required</div>
        {error ? <Flash kind="error" message={error} onDismiss={() => setError(null)} /> : null}
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <FormField label="Clinic name" htmlFor="signup-clinic" error={fieldErrors.clinicName}>
            <input
              className="input"
              type="text"
              autoComplete="organization"
              value={clinicName}
              onChange={(e) => {
                setClinicName(e.target.value);
                setFieldErrors((prev) => ({ ...prev, clinicName: null }));
              }}
              autoFocus
              required
            />
          </FormField>
          <FormField label="Your email" htmlFor="signup-email" error={fieldErrors.email}>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((prev) => ({ ...prev, email: null }));
              }}
              required
            />
          </FormField>
          <FormField label="Password" htmlFor="signup-password" error={fieldErrors.password}>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
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
            aria-controls="signup-password"
            onClick={() => setShowPassword((prev) => !prev)}
          >
            {showPassword ? 'Hide password' : 'Show password'}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={busy}
          >
            {busy ? 'Creating your account…' : 'Start free trial'}
          </button>
        </form>
        <p style={{ marginTop: '12px', fontSize: 'var(--fs-label)', textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
