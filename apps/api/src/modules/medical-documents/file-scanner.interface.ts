export const MEDICAL_DOCUMENT_SCANNER = Symbol('MEDICAL_DOCUMENT_SCANNER');

export interface MedicalDocumentScanner {
  scan(body: Buffer): Promise<'CLEAN' | 'NOT_SCANNED'>;
}
