import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientProfileModule } from './modules/patient-profile/patient-profile.module';
import { MedicalDocumentsModule } from './modules/medical-documents/medical-documents.module';
import { HealthTrackingModule } from './modules/health-tracking/health-tracking.module';
import { MedicalSharingModule } from './modules/medical-sharing/medical-sharing.module';
import { FamilyModule } from './modules/family/family.module';
import { DoctorVerificationModule } from './modules/doctor-verification/doctor-verification.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    PatientProfileModule,
    MedicalDocumentsModule,
    HealthTrackingModule,
    MedicalSharingModule,
    FamilyModule,
    DoctorVerificationModule,
    AiAssistantModule,
  ],
})
export class AppModule {}
