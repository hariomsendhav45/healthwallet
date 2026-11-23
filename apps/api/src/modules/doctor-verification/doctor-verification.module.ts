import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MedicalDocumentsModule } from '../medical-documents/medical-documents.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DoctorVerificationController } from './doctor-verification.controller';
import { DoctorVerificationService } from './doctor-verification.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { DoctorVerificationRateLimitGuard } from './doctor-verification.controller';
import { TokenService } from '../auth/token.service';

@Module({ imports: [AuthModule, MedicalDocumentsModule], controllers: [DoctorVerificationController], providers: [DoctorVerificationService, AuthGuard, RolesGuard, TokenService, SecurityRateLimiter, DoctorVerificationRateLimitGuard] })
export class DoctorVerificationModule {}
