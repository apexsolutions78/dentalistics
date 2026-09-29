import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, errorMessage } from './api';
import { useAuth } from './auth';
import type {
  ClinicSettings,
  MemberUser,
  PreviewResult,
  Settings,
} from './types';

interface SettingsResponse {
  settings: Settings;
}

export interface SettingsState {
  status: 'loading' | 'success' | 'error';
  settings: Settings | null;
  error: string | null;
}

export function useSettings(): {
  state: SettingsState;
  reload: () => void;
  patchClinic: (body: Partial<ClinicSettings>) => Promise<Settings>;
  patchAutomation: <K extends keyof Settings['automations']>(
    key: K,
    body: unknown,
  ) => Promise<Settings>;
  patchProvider: (key: 'telephony' | 'whatsapp', body: unknown) => Promise<Settings>;
  patchTemplate: (name: string, body: unknown) => Promise<Settings>;
} {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [state, setState] = useState<SettingsState>({ status: 'loading', settings: null, error: null });
  const runId = useRef(0);

  const reload = useCallback(() => {
    if (orgId === null) return;
    runId.current += 1;
    const id = runId.current;
    apiFetch<SettingsResponse>(`/api/organizations/${orgId}/settings`)
      .then((res) => {
        if (runId.current === id) {
          setState({ status: 'success', settings: res.settings, error: null });
        }
      })
      .catch((err: unknown) => {
        if (runId.current === id) {
          setState({ status: 'error', settings: null, error: errorMessage(err) });
        }
      });
  }, [orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const patch = useCallback(
    async (path: string, body: unknown): Promise<Settings> => {
      const res = await apiFetch<SettingsResponse>(path, { method: 'PATCH', body });
      setState({ status: 'success', settings: res.settings, error: null });
      return res.settings;
    },
    [],
  );

  const patchClinic = useCallback(
    (body: Partial<ClinicSettings>) =>
      patch(`/api/organizations/${orgId}/settings/clinic`, body),
    [patch, orgId],
  );

  const patchAutomation = useCallback(
    <K extends keyof Settings['automations']>(key: K, body: unknown) =>
      patch(`/api/organizations/${orgId}/settings/automations/${String(key)}`, body),
    [patch, orgId],
  );

  const patchProvider = useCallback(
    (key: 'telephony' | 'whatsapp', body: unknown) =>
      patch(`/api/organizations/${orgId}/settings/providers/${key}`, body),
    [patch, orgId],
  );

  const patchTemplate = useCallback(
    (name: string, body: unknown) =>
      patch(`/api/organizations/${orgId}/settings/templates/${encodeURIComponent(name)}`, body),
    [patch, orgId],
  );

  return { state, reload, patchClinic, patchAutomation, patchProvider, patchTemplate };
}

interface MembersResponse {
  users: MemberUser[];
}

export function useMembers(): {
  status: 'loading' | 'success' | 'error';
  members: MemberUser[];
  error: string | null;
  reload: () => void;
} {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [members, setMembers] = useState<MemberUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  const reload = useCallback(() => {
    if (orgId === null) return;
    runId.current += 1;
    const id = runId.current;
    apiFetch<MembersResponse>(`/api/organizations/${orgId}/users`)
      .then((res) => {
        if (runId.current === id) {
          setMembers(res.users);
          setStatus('success');
        }
      })
      .catch((err: unknown) => {
        if (runId.current === id) {
          setError(errorMessage(err));
          setStatus('error');
        }
      });
  }, [orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status, members, error, reload };
}

export async function previewTemplate(
  orgId: number,
  content: string,
): Promise<PreviewResult> {
  return apiFetch<PreviewResult>(`/api/organizations/${orgId}/settings/templates/preview`, {
    method: 'POST',
    body: { body: content },
  });
}
