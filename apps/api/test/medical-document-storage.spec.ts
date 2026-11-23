import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalPrivateStorageProvider } from '../src/modules/medical-documents/storage/local-storage.provider';
import { assertSafeStorageKey } from '../src/modules/medical-documents/storage/storage-provider.interface';
import { S3MedicalDocumentStorageProvider } from '../src/modules/medical-documents/storage/s3-storage.provider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

describe('private local medical document storage', () => {
  let directory: string;
  let storage: LocalPrivateStorageProvider;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'healthvault-medical-docs-'));
    storage = new LocalPrivateStorageProvider({ get: () => directory } as never);
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('uploads, verifies, retrieves and deletes a private test object', async () => {
    const body = Buffer.from('%PDF-1.7\n%%EOF');
    const key = '00000000-0000-4000-8000-000000000001.pdf';
    const checksum = createHash('sha256').update(body).digest('hex');
    await storage.put(key, body);
    expect(await storage.head(key)).toMatchObject({ contentLength: body.length, checksum });
    expect(await storage.get(key)).toEqual(body);
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    await expect(storage.get(key)).rejects.toThrow('Stored document is unavailable.');
  });

  it('rejects traversal and non-opaque object keys', async () => {
    expect(() => assertSafeStorageKey('../patient/report.pdf')).toThrow('Invalid internal document key.');
    await expect(storage.get('../patient/report.pdf')).rejects.toThrow('Stored document is unavailable.');
  });
});

describe('S3-compatible storage request construction', () => {
  it('uses a private encrypted object put without a public ACL', async () => {
    const provider = new S3MedicalDocumentStorageProvider({
      get: (key: string, fallback?: string) =>
        key === 'MEDICAL_DOCUMENT_S3_BUCKET' ? 'private-test-bucket' : fallback,
      getOrThrow: () => 'private-test-bucket',
    } as never);
    const client = (provider as unknown as { client: S3Client }).client;
    const send = jest.spyOn(client, 'send').mockResolvedValue({} as never);
    const body = Buffer.from('%PDF-1.7\n%%EOF');
    const checksum = createHash('sha256').update(body).digest('hex');
    await provider.put(
      '00000000-0000-4000-8000-000000000001.pdf',
      body,
      'application/pdf',
      checksum,
    );
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'private-test-bucket',
      ServerSideEncryption: 'AES256',
      ContentType: 'application/pdf',
      Metadata: { sha256: checksum },
    });
    expect((command as PutObjectCommand).input).not.toHaveProperty('ACL');
  });
});
