import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { SecurityRateLimiter } from './security-rate-limiter.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SMS_PROVIDER } from './sms/sms-provider';
import { DevelopmentMockSmsProvider } from './sms/development-mock-sms.provider';
import { ConfigService } from '@nestjs/config';
import { UnconfiguredSmsProvider } from './sms/unconfigured-sms.provider';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    SessionService,
    TokenService,
    SecurityRateLimiter,
    AuthGuard,
    RolesGuard,
    {
      provide: SMS_PROVIDER,
      useFactory: (config: ConfigService) =>
        config.get<string>('NODE_ENV', process.env.NODE_ENV ?? 'development') === 'production'
          ? new UnconfiguredSmsProvider()
          : new DevelopmentMockSmsProvider(config),
      inject: [ConfigService],
    },
  ],
  exports: [AuthGuard, RolesGuard, SecurityRateLimiter],
})
export class AuthModule {}
