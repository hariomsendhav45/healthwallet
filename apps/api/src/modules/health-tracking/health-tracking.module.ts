import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokenService } from '../auth/token.service';
import { HealthTrackingController } from './health-tracking.controller';
import { HealthTrackingService } from './health-tracking.service';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';

@Module({
  imports: [AuthModule],
  controllers: [HealthTrackingController],
  providers: [HealthTrackingService, PatientProfileRateLimitGuard, AuthGuard, RolesGuard, TokenService],
})
export class HealthTrackingModule {}
