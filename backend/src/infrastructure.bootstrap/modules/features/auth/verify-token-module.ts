import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { IVerifyTokenService } from '@src/domain/features/auth/services/i-verify-token-service';
import { DispatcherProvider } from '@src/infrastructure.bootstrap/config/core/cqrs/dispatcher-provider';
import { VerifyTokenService } from '@src/infrastructure/features/auth/services/verify-token-service';

@Global()
@Module({
  // imports: [
  //     HttpModule.registerAsync({
  //         useClass: httpclient
  //     })
  // ],
  controllers: [],
  providers: [
    VerifyTokenService,
    {
      provide: IVerifyTokenService,
      useClass: VerifyTokenService,
    },
    DispatcherProvider,
  ],
  exports: [IVerifyTokenService],
})
export class VerifyTokenModule {}
