// `npm run migrate` entrypoint. Kept apart from migrate.ts so tests can import
// runMigrations() without loading the app config from .env.
import { config } from '../config';
import { logger } from '../lib/logger';
import { runMigrations } from './migrate';

runMigrations(config.DATABASE_URL, (message) => logger.info(message))
  .then((applied) => logger.info({ applied: applied.length }, 'migrations up to date'))
  .catch((err) => {
    logger.error({ err }, 'migration failed');
    process.exitCode = 1;
  });
