import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from './logger';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = 'internal_error',
    expose?: boolean,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose ?? statusCode < 500;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Route') {
    super(`${resource} not found`, 404, 'not_found', true);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  readonly issues: string[];

  constructor(message = 'Validation failed', issues: string[] = []) {
    super(message, 400, 'validation_failed', true);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError());
};

function errorType(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'type' in err) {
    const value = (err as { type?: unknown }).type;
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

export interface RequestErrorRecord {
  organizationId: number | null;
  method: string;
  path: string;
  statusCode: number;
  code: string;
  errorName: string | null;
  errorMessage: string | null;
}

export function errorHandler(
  logger: Logger,
  options: { recordError?: (record: RequestErrorRecord) => Promise<void> } = {},
): ErrorRequestHandler {
  return async (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    let appError: AppError;
    if (err instanceof AppError) {
      appError = err;
    } else if (errorType(err) === 'entity.parse.failed') {
      appError = new ValidationError('Malformed JSON body');
    } else if (errorType(err) === 'entity.too.large') {
      appError = new AppError('Request body too large', 413, 'payload_too_large', true);
    } else {
      appError = new AppError('Internal server error', 500, 'internal_error', false);
    }

    const status = appError.statusCode;
    const logFields: Record<string, unknown> = {
      method: req.method,
      path: req.originalUrl,
      statusCode: status,
      code: appError.code,
    };
    if (status >= 500 && err instanceof Error) {
      logFields.error = { name: err.name, message: err.message, stack: err.stack };
    } else {
      logFields.error = { name: appError.name, message: appError.message };
    }

    if (status >= 500) {
      logger.error('request failed', logFields);
      if (options.recordError !== undefined) {
        const user = req.user;
        try {
          await options.recordError({
            organizationId: user?.organizationId ?? null,
            method: req.method,
            path: req.path.slice(0, 500),
            statusCode: status,
            code: appError.code,
            errorName: err instanceof Error ? err.name : appError.name,
            errorMessage: (err instanceof Error ? err.message : appError.message).slice(0, 1000),
          });
        } catch (recordErr) {
          logger.error('error event write failed', {
            error: recordErr instanceof Error ? recordErr.message : String(recordErr),
          });
        }
      }
    } else {
      logger.warn('request rejected', logFields);
    }

    const body: { error: { code: string; message: string; issues?: string[] } } = {
      error: {
        code: appError.code,
        message: appError.expose ? appError.message : 'Internal server error',
      },
    };
    if (appError instanceof ValidationError && appError.issues.length > 0) {
      body.error.issues = appError.issues;
    }
    res.status(status).json(body);
  };
}
