import { AppError } from '../errors';
import type { SessionUser } from '../auth/sessions';

export function assertOrgExists(user: SessionUser, organizationId: number): void {
  if (user.role === 'admin') {
    return;
  }
  if (user.organizationId !== organizationId) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
}

export function assertCanManageMembers(user: SessionUser, organizationId: number): void {
  assertOrgExists(user, organizationId);
  if (user.role !== 'admin' && user.role !== 'owner') {
    throw new AppError('Forbidden', 403, 'forbidden', true);
  }
}
