import type { Logger } from 'pino';
import type { AuthContext } from '../middleware/auth';

// Fields our middleware attaches to every request.
declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      auth?: AuthContext; // set by requireUser / requireTenant
    }
  }
}

export {};
