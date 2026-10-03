import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { apiFetch, onUnauthorized } from './api';
import type { SessionOrganization, SessionUser } from './types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: SessionUser | null;
  organization: SessionOrganization | null;
  status: AuthStatus;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (clinicName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  clearSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionResponse {
  user: SessionUser;
  organization?: SessionOrganization | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [organization, setOrganization] = useState<SessionOrganization | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);
  const hadSessionRef = useRef(false);

  useEffect(() => {
    return onUnauthorized(() => {
      if (!hadSessionRef.current) return;
      hadSessionRef.current = false;
      setUser(null);
      setOrganization(null);
      setStatus('anonymous');
      setSessionExpired(true);
    });
  }, []);

  const checkSession = useCallback((): Promise<void> => {
    return apiFetch<SessionResponse>('/api/auth/me')
      .then((res) => {
        hadSessionRef.current = true;
        setUser(res.user);
        setOrganization(res.organization ?? null);
        setStatus('authenticated');
      })
      .catch(() => {
        setUser(null);
        setOrganization(null);
        setStatus('anonymous');
      });
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const res = await apiFetch<SessionResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    hadSessionRef.current = true;
    setSessionExpired(false);
    setUser(res.user);
    setOrganization(res.organization ?? null);
    setStatus('authenticated');
  }, []);

  const signup = useCallback(
    async (clinicName: string, email: string, password: string): Promise<void> => {
      const res = await apiFetch<SessionResponse>('/api/auth/signup', {
        method: 'POST',
        body: { clinicName, email, password },
      });
      hadSessionRef.current = true;
      setSessionExpired(false);
      setUser(res.user);
      setOrganization(res.organization ?? null);
      setStatus('authenticated');
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      hadSessionRef.current = false;
      setUser(null);
      setOrganization(null);
      setStatus('anonymous');
    }
  }, []);

  const clearSessionExpired = useCallback((): void => {
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      organization,
      status,
      sessionExpired,
      login,
      signup,
      logout,
      refreshSession: checkSession,
      clearSessionExpired,
    }),
    [
      user,
      organization,
      status,
      sessionExpired,
      login,
      signup,
      logout,
      checkSession,
      clearSessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
