import { Injectable } from '@nestjs/common';
import { MedicalDocumentScanner } from './file-scanner.interface';

/** Explicit development/test placeholder; performs no malware scan. */
@Injectable()
export class DevelopmentNoopFileScanner implements MedicalDocumentScanner {
  async scan(): Promise<'NOT_SCANNED'> {
    return 'NOT_SCANNED';
  }
}
