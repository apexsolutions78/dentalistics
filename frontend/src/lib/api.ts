export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: string[];

  constructor(status: number, code: string, message: string, issues: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    issues?: string[];
  };
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

const UNAUTHORIZED_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/me', '/api/auth/logout'];

function isUnauthorizedExempt(path: string): boolean {
  return UNAUTHORIZED_EXEMPT_PATHS.some((prefix) => path.startsWith(prefix));
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (options.body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection and try again.');
  }

  let payload: ErrorPayload | null;
  try {
    payload = (await res.json()) as ErrorPayload;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = payload?.error;
    if (res.status === 401 && !isUnauthorizedExempt(path)) {
      for (const listener of unauthorizedListeners) {
        listener();
      }
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'request_failed',
      err?.message ?? `Request failed (${res.status})`,
      Array.isArray(err?.issues) ? err.issues : [],
    );
  }
  return payload as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.issues.length > 0 ? err.issues.join(' ') : err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Something went wrong.';
}
