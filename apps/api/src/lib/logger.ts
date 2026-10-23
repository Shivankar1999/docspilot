import pino from 'pino';
import { config } from '../config';

// JSON logs everywhere (easy for log tools to parse); pretty-printed only in local dev.
export const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
