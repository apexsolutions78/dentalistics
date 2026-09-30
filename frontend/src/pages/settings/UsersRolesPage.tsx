import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useMembers } from '../../lib/settings';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { MemberUser } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';
import { SettingsBody } from './SettingsBody';
import { useSettings } from '../../lib/settings';

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner — full access' },
  { value: 'receptionist', label: 'Receptionist — no settings access' },
];

function roleTone(role: string): BadgeTone {
  if (role === 'owner') return 'new';
  if (role === 'admin') return 'success';
  return 'default';
}

function formatWhen(value: string | null): string {
  if (value === null) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function UsersRolesPage() {
  const { user } = useAuth();
  const { state, reload } = useSettings();
  const { status, members, error: membersError, reload: reloadMembers } = useMembers();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const { submit: submitRemove, saving: removing, error: removeError, clearFeedback: clearRemove } = useSubmit();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('receptionist');
  const [confirmTarget, setConfirmTarget] = useState<MemberUser | null>(null);
  const [memberMsg, setMemberMsg] = useState<string | null>(null);

  const addMember = async (): Promise<void> => {
    if (user === null) return;
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${user.organizationId}/users`, {
        method: 'POST',
        body: { email: email.trim(), password, role },
      });
      return true;
    });
    if (ok !== null) {
      setEmail('');
      setPassword('');
      reloadMembers();
    }
  };

  const disableMember = async (member: MemberUser): Promise<void> => {
    if (user === null) return;
    const ok = await submitRemove(async () => {
      await apiFetch(`/api/organizations/${user.organizationId}/users/${member.id}`, {
        method: 'DELETE',
      });
      return true;
    });
    setConfirmTarget(null);
    if (ok !== null) {
      setMemberMsg('User disabled.');
      reloadMembers();
    }
  };

  const enableMember = async (member: MemberUser): Promise<void> => {
    if (user === null) return;
    setMemberMsg(null);
    const ok = await submitRemove(async () => {
      await apiFetch(`/api/organizations/${user.organizationId}/users/${member.id}/enable`, {
        method: 'POST',
      });
      return true;
    });
    if (ok !== null) {
      setMemberMsg('User enabled.');
      reloadMembers();
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & roles"
        subtitle="Owners manage settings; receptionists work the daily schedule without settings access"
      />
      <SettingsBody state={state} onRetry={reload}>
        {() => (
          <div>
            <div className="card">
              <h2 className="card-title">Clinic users</h2>
              {memberMsg ? (
                <Flash kind="success" message={memberMsg} onDismiss={() => setMemberMsg(null)} />
              ) : null}
              {removeError ? <Flash kind="error" message={removeError} onDismiss={clearRemove} /> : null}
              {status === 'loading' ? <LoadingState label="Loading users…" /> : null}
              {status === 'error' ? <ErrorState message={membersError ?? 'Users could not be loaded.'} onRetry={reloadMembers} /> : null}
              {status === 'success' && members.length === 0 ? (
                <EmptyState title="No users" description="No users belong to this clinic yet." />
              ) : null}
              {status === 'success' && members.length > 0 ? (
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Clinic users table">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Email</th>
                        <th scope="col">Role</th>
                        <th scope="col">Status</th>
                        <th scope="col">Last sign-in</th>
                        <th scope="col" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => {
                        const isSelf = member.id === user?.id;
                        return (
                          <tr key={member.id}>
                            <td>
                              {member.email}
                              {isSelf ? <span className="meta-line"> (you)</span> : null}
                            </td>
                            <td>
                              <StatusBadge label={member.role} tone={roleTone(member.role)} />
                            </td>
                            <td>
                              <StatusBadge
                                label={member.status}
                                tone={member.status === 'active' ? 'success' : 'danger'}
                              />
                            </td>
                            <td>{formatWhen(member.lastLoginAt)}</td>
                            <td style={{ textAlign: 'right' }}>
                              {member.status === 'active' && !isSelf ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={removing}
                                  onClick={() => {
                                    clearRemove();
                                    setMemberMsg(null);
                                    setConfirmTarget(member);
                                  }}
                                >
                                  Disable
                                </button>
                              ) : null}
                              {member.status === 'disabled' ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={removing}
                                  onClick={() => void enableMember(member)}
                                >
                                  {removing ? 'Enabling…' : 'Enable'}
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="card">
              <h2 className="card-title">Add a user</h2>
              {saved ? <Flash kind="success" message="User added." onDismiss={clearFeedback} /> : null}
              {error ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}
              <div className="form-grid">
                <FormField label="Email">
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFeedback();
                    }}
                  />
                </FormField>
                <FormField label="Password" hint="12–200 characters. The server enforces the password policy.">
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFeedback();
                    }}
                  />
                </FormField>
                <FormField label="Role">
                  <select
                    className="select"
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value);
                      clearFeedback();
                    }}
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void addMember()}
                  disabled={saving || email.trim().length === 0 || password.length === 0}
                >
                  {saving ? 'Adding…' : 'Add user'}
                </button>
              </div>
            </div>

            <ConfirmDialog
              open={confirmTarget !== null}
              title="Disable user?"
              body={
                confirmTarget !== null
                  ? `${confirmTarget.email} will no longer be able to sign in. Their history is kept. You can re-enable the account later.`
                  : ''
              }
              confirmLabel="Disable user"
              danger
              busy={removing}
              onConfirm={() => {
                if (confirmTarget !== null) void disableMember(confirmTarget);
              }}
              onCancel={() => {
                setConfirmTarget(null);
                clearRemove();
              }}
            />
          </div>
        )}
      </SettingsBody>
    </div>
  );
}
