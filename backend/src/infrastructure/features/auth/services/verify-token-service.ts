import { Injectable } from '@nestjs/common';
import { IVerifyTokenService } from '@src/domain/features/auth/services/i-verify-token-service';

@Injectable()
export class VerifyTokenService implements IVerifyTokenService {
  async verifyToken(_token: string): Promise<boolean> {
    return true;
  }
}
