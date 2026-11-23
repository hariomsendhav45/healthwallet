export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

export interface StoredObjectMetadata {
  contentType: string;
  contentLength: number;
  checksum: string;
}

export interface MedicalDocumentStorage {
  put(key: string, body: Buffer, contentType: string, checksum: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<StoredObjectMetadata | null>;
}

export function assertSafeStorageKey(key: string): void {
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$/i.test(key)) {
    throw new Error('Invalid internal document key.');
  }
}
