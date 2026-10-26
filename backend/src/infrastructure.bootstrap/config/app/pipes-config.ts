import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';

export const configurePipes = (app: INestApplication) => {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
};
