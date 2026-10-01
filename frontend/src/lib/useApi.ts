import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorMessage } from './api';

export interface AsyncResult<T> {
  status: 'loading' | 'success' | 'error';
  data: T | null;
  error: string | null;
  reload: () => void;
}

export interface Paged {
  total: number;
  limit: number;
  offset: number;
}

interface FetchState<T> {
  path: string | null;
  data: T | null;
  error: string | null;
}

export function useApi<T>(path: string | null): AsyncResult<T> {
  const [state, setState] = useState<FetchState<T>>({ path: null, data: null, error: null });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    apiFetch<T>(path)
      .then((res) => {
        if (!cancelled) setState({ path, data: res, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ path, data: null, error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const matches = path !== null && state.path === path;
  const data = matches ? state.data : null;
  const error = matches ? state.error : null;
  const status: 'loading' | 'success' | 'error' =
    path === null || !matches ? 'loading' : error !== null ? 'error' : 'success';

  return { status, data, error, reload };
}
