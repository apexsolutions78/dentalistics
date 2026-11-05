import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flash } from '../../components/Flash';
import { FormField } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/states';
import { apiFetch, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSubmit } from '../../lib/useAsync';

interface ProfileUser {
  id: number;
  email: string;
  role: 'owner' | 'receptionist' | 'admin';
  organizationId: number | null;
  displayName: string | null;
  phone: string | null;
}

interface ProfileClinic {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

interface ProfileResponse {
  user: ProfileUser;
  clinic: ProfileClinic | null;
}

interface AccountForm {
  displayName: string;
  email: string;
  phone: string;
  currentPassword: string;
}

interface ClinicForm {
  name: string;
  phone: string;
  email: string;
  address: string;
}

function accountFrom(profile: ProfileResponse): AccountForm {
  return {
    displayName: profile.user.displayName ?? '',
    email: profile.user.email,
    phone: profile.user.phone ?? '',
    currentPassword: '',
  };
}

function clinicFrom(clinic: ProfileClinic): ClinicForm {
  return {
    name: clinic.name,
    phone: clinic.phone ?? '',
    email: clinic.email ?? '',
    address: clinic.address ?? '',
  };
}

export function ProfilePage() {
  const { user, refreshSession, logout } = useAuth();
  const navigate = useNavigate();
  const accountSubmit = useSubmit();
  const clinicSubmit = useSubmit();
  const passwordSubmit = useSubmit();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountForm | null>(null);
  const [clinic, setClinic] = useState<ClinicForm | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<ProfileResponse>('/api/profile')
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        setAccount(accountFrom(next));
        setClinic(next.clinic === null ? null : clinicFrom(next.clinic));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const emailChanged =
    account !== null && profile !== null && account.email.trim().toLowerCase() !== profile.user.email;

  const saveAccount = async (): Promise<void> => {
    if (account === null) return;
    if (emailChanged && account.currentPassword === '') {
      accountSubmit.setError('Enter your current password to change the email.');
      return;
    }
    const saved = await accountSubmit.submit(() =>
      apiFetch<ProfileResponse>('/api/profile', {
        method: 'PATCH',
        body: {
          displayName: account.displayName.trim(),
          email: account.email.trim(),
          phone: account.phone.trim(),
          ...(emailChanged ? { currentPassword: account.currentPassword } : {}),
        },
      }),
    );
    if (saved === null) return;
    setProfile(saved);
    setAccount(accountFrom(saved));
    setClinic(saved.clinic === null ? null : clinicFrom(saved.clinic));
    await refreshSession();
  };

  const saveClinic = async (): Promise<void> => {
    if (clinic === null) return;
    if (clinic.name.trim() === '') {
      clinicSubmit.setError('Clinic name cannot be empty.');
      return;
    }
    const saved = await clinicSubmit.submit(() =>
      apiFetch<ProfileResponse>('/api/profile', {
        method: 'PATCH',
        body: {
          clinic: {
            name: clinic.name.trim(),
            phone: clinic.phone.trim(),
            email: clinic.email.trim(),
            address: clinic.address.trim(),
          },
        },
      }),
    );
    if (saved === null) return;
    setProfile(saved);
    setClinic(saved.clinic === null ? null : clinicFrom(saved.clinic));
    await refreshSession();
  };

  const savePassword = async (): Promise<void> => {
    if (newPassword.length < 12) {
      passwordSubmit.setError('Password must be between 12 and 200 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      passwordSubmit.setError('Passwords do not match.');
      return;
    }
    const saved = await passwordSubmit.submit(async () => {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      return true;
    });
    if (saved === null) return;
    await logout();
    navigate('/login', { replace: true, state: { passwordReset: true } });
  };

  return (
    <div className="profile-page">
      <PageHeader
        title="Profile"
        subtitle={
          user?.role === 'owner'
            ? 'Your sign-in details, and the clinic contact details patients see.'
            : 'Your sign-in details. Clinic settings stay with the clinic owner.'
        }
      />
      {loadError !== null ? <Flash kind="error" message={loadError} onDismiss={() => setLoadError(null)} /> : null}
      {profile === null && loadError === null ? <LoadingState label="Loading your profile…" /> : null}
      {account !== null ? (
        <section className="card">
          <h2 className="card-title">Your account</h2>
          {accountSubmit.saved ? (
            <Flash kind="success" message="Account saved." onDismiss={accountSubmit.clearFeedback} />
          ) : null}
          {accountSubmit.error !== null ? (
            <Flash kind="error" message={accountSubmit.error} onDismiss={accountSubmit.clearFeedback} />
          ) : null}
          <div className="form-grid">
            <FormField label="Name" htmlFor="profile-name" hint="Shown in the menu. Leave blank to use the start of your email.">
              <input
                className="input"
                value={account.displayName}
                autoComplete="name"
                onChange={(event) => {
                  setAccount({ ...account, displayName: event.target.value });
                  accountSubmit.clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Email" htmlFor="profile-email" required>
              <input
                className="input"
                type="email"
                value={account.email}
                autoComplete="email"
                onChange={(event) => {
                  setAccount({ ...account, email: event.target.value });
                  accountSubmit.clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Phone" htmlFor="profile-phone" hint="Digits only, optional leading +">
              <input
                className="input"
                value={account.phone}
                autoComplete="tel"
                inputMode="tel"
                onChange={(event) => {
                  setAccount({ ...account, phone: event.target.value });
                  accountSubmit.clearFeedback();
                }}
              />
            </FormField>
            {emailChanged ? (
              <FormField
                label="Current password for this email"
                htmlFor="profile-email-password"
                hint="Required to confirm an email change."
                required
              >
                <input
                  className="input"
                  type="password"
                  value={account.currentPassword}
                  autoComplete="current-password"
                  onChange={(event) => {
                    setAccount({ ...account, currentPassword: event.target.value });
                    accountSubmit.clearFeedback();
                  }}
                />
              </FormField>
            ) : null}
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={accountSubmit.saving}
              onClick={() => void saveAccount()}
            >
              {accountSubmit.saving ? 'Saving…' : 'Save account'}
            </button>
          </div>
        </section>
      ) : null}

      {clinic !== null ? (
        <section className="card">
          <h2 className="card-title">Clinic</h2>
          <p className="page-subtitle">
            Hours, timezone, and logo stay in <Link to="/settings/clinic">Clinic settings</Link>.
          </p>
          {clinicSubmit.saved ? (
            <Flash kind="success" message="Clinic details saved." onDismiss={clinicSubmit.clearFeedback} />
          ) : null}
          {clinicSubmit.error !== null ? (
            <Flash kind="error" message={clinicSubmit.error} onDismiss={clinicSubmit.clearFeedback} />
          ) : null}
          <div className="form-grid">
            <FormField label="Clinic name" htmlFor="profile-clinic-name" required>
              <input
                className="input"
                value={clinic.name}
                onChange={(event) => {
                  setClinic({ ...clinic, name: event.target.value });
                  clinicSubmit.clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Clinic phone" htmlFor="profile-clinic-phone" hint="Digits only, optional leading +">
              <input
                className="input"
                value={clinic.phone}
                inputMode="tel"
                onChange={(event) => {
                  setClinic({ ...clinic, phone: event.target.value });
                  clinicSubmit.clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Clinic email" htmlFor="profile-clinic-email">
              <input
                className="input"
                type="email"
                value={clinic.email}
                onChange={(event) => {
                  setClinic({ ...clinic, email: event.target.value });
                  clinicSubmit.clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Address" htmlFor="profile-clinic-address">
              <input
                className="input"
                value={clinic.address}
                onChange={(event) => {
                  setClinic({ ...clinic, address: event.target.value });
                  clinicSubmit.clearFeedback();
                }}
              />
            </FormField>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={clinicSubmit.saving}
              onClick={() => void saveClinic()}
            >
              {clinicSubmit.saving ? 'Saving…' : 'Save clinic'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Password</h2>
        <p className="page-subtitle">Changing your password signs you out on every device.</p>
        {passwordSubmit.error !== null ? (
          <Flash kind="error" message={passwordSubmit.error} onDismiss={passwordSubmit.clearFeedback} />
        ) : null}
        <div className="form-grid">
          <FormField label="Current password" htmlFor="profile-current-password" required>
            <input
              className="input"
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                passwordSubmit.clearFeedback();
              }}
            />
          </FormField>
          <FormField label="New password" htmlFor="profile-new-password" hint="Between 12 and 200 characters" required>
            <input
              className="input"
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(event) => {
                setNewPassword(event.target.value);
                passwordSubmit.clearFeedback();
              }}
            />
          </FormField>
          <FormField label="Confirm new password" htmlFor="profile-confirm-password" required>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                passwordSubmit.clearFeedback();
              }}
            />
          </FormField>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={passwordSubmit.saving}
            onClick={() => void savePassword()}
          >
            {passwordSubmit.saving ? 'Updating…' : 'Change password'}
          </button>
        </div>
      </section>
    </div>
  );
}
