import express from 'express';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { documentsRouter } from './routes/documents';
import { healthRouter } from './routes/health';
import { metricsRouter } from './routes/metrics';
import { tenantRouter } from './routes/tenant';
import { usageRouter } from './routes/usage';
import { widgetRouter } from './routes/widget';

// Builds the Express app without starting a server, so tests can drive it with Supertest.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Lets req.ip be the real client IP (from X-Forwarded-For) when the request came
  // through a trusted proxy such as Next.js. Needed for per-IP rate limits.
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(requestContext);
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter);
  app.use(metricsRouter);
  app.use(authRouter);
  app.use(tenantRouter);
  app.use(documentsRouter);
  app.use(chatRouter);
  app.use(usageRouter);
  app.use(widgetRouter);

  // Order matters: these must come after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
