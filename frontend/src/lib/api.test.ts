import { describe, expect, it, vi, afterEach } from 'vitest';
import { apiFetch, ApiError, errorMessage } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));
    const res = await apiFetch<{ ok: boolean }>('/api/health');
    expect(res.ok).toBe(true);
  });

  it('sends JSON bodies with same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/auth/login', { method: 'POST', body: { email: 'a@b.c', password: 'x' } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'x' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with status, code, and issues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, { error: { code: 'validation_failed', message: 'Invalid input', issues: ['name must be a string'] } }),
      ),
    );
    await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError);
    try {
      await apiFetch('/api/x');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe('validation_failed');
      expect(apiErr.issues).toEqual(['name must be a string']);
    }
  });

  it('maps 401 responses to an ApiError with status 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } })),
    );
    try {
      await apiFetch('/api/auth/me');
      expect.unreachable();
    } catch (err) {
      expect((err as ApiError).status).toBe(401);
    }
  });

  it('wraps network failures as ApiError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    try {
      await apiFetch('/api/x');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).code).toBe('network_error');
    }
  });

  it('surfaces error issues in errorMessage', () => {
    const err = new ApiError(400, 'validation_failed', 'Invalid input', ['phone must be 7-15 digits']);
    expect(errorMessage(err)).toContain('phone must be 7-15 digits');
    expect(errorMessage(new Error('plain'))).toBe('plain');
    expect(errorMessage('weird')).toBe('Something went wrong.');
  });
});
