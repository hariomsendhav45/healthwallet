import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { TokenService } from '../auth/token.service';
import { MedicalDocumentsModule } from '../medical-documents/medical-documents.module';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import {
  FamilyController,
  FamilyInvitationClaimRateLimitGuard,
  FamilyInvitationRateLimitGuard,
  NoStoreResponseInterceptor,
} from './family.controller';
import { FamilyService } from './family.service';

@Module({
  imports: [AuthModule, MedicalDocumentsModule],
  controllers: [FamilyController],
  providers: [FamilyService, AuthGuard, RolesGuard, TokenService, PatientProfileRateLimitGuard, SecurityRateLimiter, NoStoreResponseInterceptor, FamilyInvitationRateLimitGuard, FamilyInvitationClaimRateLimitGuard],
})
export class FamilyModule {}
