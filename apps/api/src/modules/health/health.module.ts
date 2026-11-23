import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MedicalDocumentsModule } from '../medical-documents/medical-documents.module';
@Module({ imports: [MedicalDocumentsModule], controllers: [HealthController] })
export class HealthModule {}
