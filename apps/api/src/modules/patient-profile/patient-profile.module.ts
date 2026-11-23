import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokenService } from '../auth/token.service';
import { PatientProfileController } from './patient-profile.controller';
import { PatientProfileService } from './patient-profile.service';
import { PatientProfileRateLimitGuard } from './patient-profile-rate-limit.guard';

@Module({
  imports: [AuthModule],
  controllers: [PatientProfileController],
  providers: [
    PatientProfileService,
    PatientProfileRateLimitGuard,
    AuthGuard,
    RolesGuard,
    TokenService,
  ],
})
export class PatientProfileModule {}
