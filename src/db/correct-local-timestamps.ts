import { loadEnv } from '../config';
import { ConfigError } from '../config';
import { closePool, initPool } from './pool';
import { correctLocalTimestamps } from './localTimestamps';

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): { offsetMinutes: number; before: Date; apply: boolean } {
  const known = new Set(['--offset-minutes', '--before', '--apply']);
  for (const arg of argv) {
    if (arg.startsWith('--') && !known.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const offsetRaw = readFlag(argv, '--offset-minutes');
  const beforeRaw = readFlag(argv, '--before');
  if (offsetRaw === null || beforeRaw === null) {
    throw new Error(
      'Usage: npm run db:correct-timestamps -- --offset-minutes 300 --before 2026-11-04T08:00:00Z [--apply]',
    );
  }
  if (!/^[0-9]+$/.test(offsetRaw)) {
    throw new Error('--offset-minutes must be a positive integer');
  }
  const before = new Date(beforeRaw);
  if (Number.isNaN(before.getTime())) {
    throw new Error('--before must be an ISO-8601 timestamp');
  }
  return {
    offsetMinutes: Number(offsetRaw),
    before,
    apply: argv.includes('--apply'),
  };
}

async function runCli(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadEnv();
  const pool = initPool(config.db);
  try {
    const result = await correctLocalTimestamps(pool, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'dry_run') {
      process.stdout.write('Dry run only. Re-run with --apply to write the correction once.\n');
    }
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  runCli().then(
    () => process.exit(0),
    (err: unknown) => {
      if (err instanceof ConfigError) {
        process.stderr.write(`${err.message}\n`);
      } else if (err instanceof Error) {
        process.stderr.write(`Timestamp correction failed: ${err.message}\n`);
      } else {
        process.stderr.write(`Timestamp correction failed: ${String(err)}\n`);
      }
    process.exit(1);
  },
  );
}
