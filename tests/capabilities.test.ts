import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../src/auth/sessions';
import { AppError } from '../src/errors';
import { requireCapability } from '../src/middleware/auth';

function sessionUser(role: SessionUser['role']): SessionUser {
  return {
    id: 1,
    email: `${role}@apextest.local`,
    role,
    organizationId: 1,
    displayName: null,
    phone: null,
    theme: 'system',
  };
}

function run(user: SessionUser | undefined, capability: string): unknown {
  const middleware = requireCapability(capability);
  let nextError: unknown = new Error('next was not called');
  middleware(
    { user } as unknown as Request,
    {} as Response,
    ((err?: unknown) => {
      nextError = err;
    }) as NextFunction,
  );
  return nextError;
}

describe('requireCapability', () => {
  it('allows every clinic role that holds appointments.create', () => {
    for (const role of ['owner', 'admin', 'receptionist'] as const) {
      expect(run(sessionUser(role), 'appointments.create')).toBeUndefined();
    }
  });

  it('rejects unauthenticated requests with 401', () => {
    const err = run(undefined, 'appointments.create');
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(401);
    expect((err as AppError).code).toBe('authentication_required');
  });

  it('lets the front desk view patient billing and keeps the books with the owner', () => {
    expect(run(sessionUser('receptionist'), 'patientBilling.view')).toBeUndefined();
    expect(run(sessionUser('owner'), 'patientBilling.manage')).toBeUndefined();
    expect(run(sessionUser('admin'), 'patientBilling.reports')).toBeUndefined();
    const manage = run(sessionUser('receptionist'), 'patientBilling.manage');
    expect(manage).toBeInstanceOf(AppError);
    expect((manage as AppError).statusCode).toBe(403);
    const reports = run(sessionUser('receptionist'), 'patientBilling.reports');
    expect(reports).toBeInstanceOf(AppError);
    expect((reports as AppError).statusCode).toBe(403);
  });

  it('fails closed for capabilities the backend map does not know', () => {
    const err = run(sessionUser('owner'), 'not.a.real.capability');
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
    expect((err as AppError).code).toBe('forbidden');
  });
});
