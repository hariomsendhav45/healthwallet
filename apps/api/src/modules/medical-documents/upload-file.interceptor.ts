import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
// This package exports a CommonJS callable factory; the import-equals form preserves that shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import multer = require('multer');
import { Observable } from 'rxjs';

@Injectable()
export class MedicalDocumentFileInterceptor implements NestInterceptor {
  private readonly middleware: ReturnType<ReturnType<typeof multer>['single']>;

  constructor(config: ConfigService) {
    const fileSize = Number(config.get<string>('MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES', '15728640'));
    if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > 100 * 1024 * 1024)
      throw new Error('MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES must be between 1 byte and 100 MB.');
    this.middleware = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize, files: 1, fields: 8 },
    }).single('file');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return new Observable((subscriber) => {
      this.middleware(req, res, (error?: unknown) => {
        if (error) {
          const isTooLarge =
            error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
          subscriber.error(
            isTooLarge
              ? new PayloadTooLargeException(
                  'The selected file exceeds the configured upload limit.',
                )
              : error,
          );
          return;
        }
        next.handle().subscribe(subscriber);
      });
    });
  }
}
