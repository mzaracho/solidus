export const IVerifyTokenService = Symbol.for('IVerifyTokenService');

export interface IVerifyTokenService {
  verifyToken(token: string): Promise<boolean>;
}
