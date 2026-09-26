import { config as loadDotenv } from 'dotenv';

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: LogLevel;
  db: DbConfig;
  migrationsDir: string;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const NODE_ENVS: readonly string[] = ['development', 'test', 'production'];
const LOG_LEVELS: readonly string[] = ['debug', 'info', 'warn', 'error'];

function requiredString(
  env: NodeJS.ProcessEnv,
  name: string,
  issues: string[],
): string {
  const value = env[name];
  if (value === undefined || value === '') {
    issues.push(`${name} is required`);
    return '';
  }
  return value;
}

function optionalPort(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  issues: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    issues.push(`${name} must be an integer between 1 and 65535`);
    return fallback;
  }
  return parsed;
}

function enumValue<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly string[],
  fallback: T,
  issues: string[],
): T {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (!allowed.includes(raw)) {
    issues.push(`${name} must be one of: ${allowed.join(', ')}`);
    return fallback;
  }
  return raw as T;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const issues: string[] = [];

  const nodeEnv = enumValue<NodeEnv>(
    env,
    'NODE_ENV',
    NODE_ENVS,
    'development',
    issues,
  );
  const port = optionalPort(env, 'PORT', 3000, issues);
  const logLevel = enumValue<LogLevel>(
    env,
    'LOG_LEVEL',
    LOG_LEVELS,
    'info',
    issues,
  );

  const dbHost = requiredString(env, 'DB_HOST', issues);
  const dbPort = optionalPort(env, 'DB_PORT', 3306, issues);
  const dbUser = requiredString(env, 'DB_USER', issues);
  const dbName = requiredString(env, 'DB_NAME', issues);
  let dbPassword = '';
  if (env.DB_PASSWORD === undefined) {
    issues.push('DB_PASSWORD is required (set an empty value if unused)');
  } else {
    dbPassword = env.DB_PASSWORD;
  }

  const migrationsDir =
    env.MIGRATIONS_DIR === undefined || env.MIGRATIONS_DIR === ''
      ? './migrations'
      : env.MIGRATIONS_DIR;

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return {
    nodeEnv,
    port,
    logLevel,
    db: {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
    },
    migrationsDir,
  };
}

export function loadEnv(): AppConfig {
  loadDotenv({ quiet: true });
  return loadConfig(process.env);
}
