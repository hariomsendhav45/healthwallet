import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokenService } from '../auth/token.service';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import { MedicalDocumentsModule } from '../medical-documents/medical-documents.module';
import {
  PatientMedicalSharingController,
  DoctorMedicalSharingController,
  DoctorSharingRateLimitGuard,
} from './medical-sharing.controller';
import { MedicalSharingService } from './medical-sharing.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';

@Module({
  imports: [AuthModule, MedicalDocumentsModule],
  controllers: [PatientMedicalSharingController, DoctorMedicalSharingController],
  providers: [
    MedicalSharingService,
    AuthGuard,
    RolesGuard,
    TokenService,
    PatientProfileRateLimitGuard,
    DoctorSharingRateLimitGuard,
    SecurityRateLimiter,
  ],
})
export class MedicalSharingModule {}
