import { ArgumentsHost } from '@nestjs/common';
import { Request, Response } from 'express';

export const getHttpContext = (
  context: ArgumentsHost,
): { request: Request; response: Response } => {
  const ctx = context.switchToHttp();

  return {
    request: ctx.getRequest<Request>(),
    response: ctx.getResponse<Response>(),
  };
};
