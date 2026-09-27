import { ValidationError } from '../errors';

export function readJsonBody(req: { body: unknown }): Record<string, unknown> {
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  return req.body as Record<string, unknown>;
}
