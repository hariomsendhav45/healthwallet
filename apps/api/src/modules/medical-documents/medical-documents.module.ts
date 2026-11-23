import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClamAvFileScanner } from './clamav-file-scanner';
import { DevelopmentNoopFileScanner } from './development-file-scanner';
import { MEDICAL_DOCUMENT_SCANNER } from './file-scanner.interface';
import { MedicalDocumentsController } from './medical-documents.controller';
import { MedicalDocumentsService } from './medical-documents.service';
import { DOCUMENT_STORAGE } from './storage/storage-provider.interface';
import { LocalPrivateStorageProvider } from './storage/local-storage.provider';
import { S3MedicalDocumentStorageProvider } from './storage/s3-storage.provider';
import { MedicalDocumentUploadRateLimitGuard } from './upload-rate-limit.guard';
import { MedicalDocumentFileInterceptor } from './upload-file.interceptor';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { TokenService } from '../auth/token.service';
import { MEDICAL_OCR_PROVIDER } from './ocr/ocr-provider';
import { TesseractMedicalOcrProvider } from './ocr/tesseract-ocr.provider';

@Module({
  imports: [AuthModule],
  controllers: [MedicalDocumentsController],
  providers: [
    AuthGuard,
    RolesGuard,
    TokenService,
    SecurityRateLimiter,
    MedicalDocumentUploadRateLimitGuard,
    MedicalDocumentFileInterceptor,
    MedicalDocumentsService,
    TesseractMedicalOcrProvider,
    { provide: MEDICAL_OCR_PROVIDER, useExisting: TesseractMedicalOcrProvider },
    {
      provide: DOCUMENT_STORAGE,
      useFactory: (config: ConfigService) => {
        const mode = config.get<string>(
          'DOCUMENT_STORAGE_PROVIDER',
          process.env.NODE_ENV === 'production' ? 's3' : 'local',
        );
        if (mode === 's3') return new S3MedicalDocumentStorageProvider(config);
        if (
          mode === 'local' &&
          ['development', 'test'].includes(
            config.get<string>('NODE_ENV', process.env.NODE_ENV ?? 'development')!,
          )
        )
          return new LocalPrivateStorageProvider(config);
        throw new Error('Configure a private S3-compatible document storage provider.');
      },
      inject: [ConfigService],
    },
    {
      provide: MEDICAL_DOCUMENT_SCANNER,
      useFactory: (config: ConfigService) => {
        const mode = config.get<string>(
          'MEDICAL_DOCUMENT_SCANNER',
          process.env.NODE_ENV === 'production' ? 'clamav' : 'development-noop',
        );
        if (mode === 'clamav') return new ClamAvFileScanner(config);
        if (
          mode === 'development-noop' &&
          ['development', 'test'].includes(
            config.get<string>('NODE_ENV', process.env.NODE_ENV ?? 'development')!,
          )
        )
          return new DevelopmentNoopFileScanner();
        throw new Error(
          'Configure ClamAV scanning before enabling production medical document uploads.',
        );
      },
      inject: [ConfigService],
    },
  ],
  exports: [MedicalDocumentsService, DOCUMENT_STORAGE, MEDICAL_DOCUMENT_SCANNER, MedicalDocumentFileInterceptor],
})
export class MedicalDocumentsModule {}
