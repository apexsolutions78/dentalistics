import type { LogLevel } from './config';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
  bindings?: Record<string, unknown>;
}

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SECRET_KEY_PATTERN =
  /pass(word)?|secret|token|authorization|api[-_]?key|credential/i;

const MAX_REDACTION_DEPTH = 6;

export function redactUrl(url: string): string {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) {
    return url;
  }
  const path = url.slice(0, qIndex);
  const query = url.slice(qIndex + 1);
  if (query === '') {
    return url;
  }
  const parts = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) {
      return pair;
    }
    const rawKey = pair.slice(0, eq);
    let decodedKey: string;
    try {
      decodedKey = decodeURIComponent(rawKey);
    } catch {
      decodedKey = rawKey;
    }
    return SECRET_KEY_PATTERN.test(decodedKey) ? `${rawKey}=[REDACTED]` : pair;
  });
  return `${path}?${parts.join('&')}`;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) {
    return '[truncated]';
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactValue(entry, depth + 1);
    }
  }
  return result;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const threshold = SEVERITY[level];
  const write =
    options.write ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const bindings = options.bindings ?? {};

  function emit(
    entryLevel: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (SEVERITY[entryLevel] < threshold) {
      return;
    }
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...(redactValue(bindings, 0) as Record<string, unknown>),
    };
    if (fields !== undefined) {
      Object.assign(entry, redactValue(fields, 0));
    }
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({
        ts: entry.ts,
        level: entryLevel,
        msg: message,
        logError: 'fields were not serializable',
      });
    }
    write(line);
  }

  const logger: Logger = {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (childBindings) =>
      createLogger({
        level,
        write,
        bindings: { ...bindings, ...childBindings },
      }),
  };
  return logger;
}
