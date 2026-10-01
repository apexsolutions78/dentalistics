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
import type { SessionUser } from './types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: SessionUser | null;
  status: AuthStatus;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  user: SessionUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);
  const hadSessionRef = useRef(false);

  useEffect(() => {
    return onUnauthorized(() => {
      if (!hadSessionRef.current) return;
      hadSessionRef.current = false;
      setUser(null);
      setStatus('anonymous');
      setSessionExpired(true);
    });
  }, []);

  const checkSession = useCallback((): void => {
    apiFetch<MeResponse>('/api/auth/me')
      .then((res) => {
        hadSessionRef.current = true;
        setUser(res.user);
        setStatus('authenticated');
      })
      .catch(() => {
        setUser(null);
        setStatus('anonymous');
      });
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const res = await apiFetch<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    hadSessionRef.current = true;
    setSessionExpired(false);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      hadSessionRef.current = false;
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const clearSessionExpired = useCallback((): void => {
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({ user, status, sessionExpired, login, logout, clearSessionExpired }),
    [user, status, sessionExpired, login, logout, clearSessionExpired],
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

export function canManageSettings(user: SessionUser | null): boolean {
  return user !== null && (user.role === 'owner' || user.role === 'admin');
}
