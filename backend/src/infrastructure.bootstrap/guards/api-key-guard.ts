import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  user?: {
    Groups: string;
  };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
