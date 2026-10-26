import { INestApplication } from '@nestjs/common';

export const METRICS_PATH = '/metrics';
export const HEALTH_LIVENESS_PATH = '/health/liveness';
export const HEALTH_READINESS_PATH = '/health/readiness';

export const configureGlobalPrefix = (app: INestApplication) => {
  app.setGlobalPrefix('api', {
    exclude: [METRICS_PATH, HEALTH_LIVENESS_PATH, HEALTH_READINESS_PATH],
  });
};
