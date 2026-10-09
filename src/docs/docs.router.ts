import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApi } from './openapi.js';

const spec = buildOpenApi();

export const docsRouter = Router();

// Swagger UI needs inline scripts/styles. This relaxed helmet applies to the docs routes only.
docsRouter.use(helmet({ contentSecurityPolicy: false }));
docsRouter.get('/openapi.json', (_req, res) => {
  res.json(spec);
});
docsRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: 'Doctor Booking API',
    swaggerOptions: { persistAuthorization: true },
  }),
);
