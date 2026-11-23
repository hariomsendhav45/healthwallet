import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  assertSafeStorageKey,
  MedicalDocumentStorage,
  StoredObjectMetadata,
} from './storage-provider.interface';

@Injectable()
export class S3MedicalDocumentStorageProvider implements MedicalDocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('MEDICAL_DOCUMENT_S3_BUCKET');
    const endpoint = config.get<string>('MEDICAL_DOCUMENT_S3_ENDPOINT');
    const credentials = config.get<string>('MEDICAL_DOCUMENT_S3_ACCESS_KEY_ID')
      ? {
          accessKeyId: config.getOrThrow<string>('MEDICAL_DOCUMENT_S3_ACCESS_KEY_ID'),
          secretAccessKey: config.getOrThrow<string>('MEDICAL_DOCUMENT_S3_SECRET_ACCESS_KEY'),
        }
      : undefined;
    this.client = new S3Client({
      region: config.get<string>('MEDICAL_DOCUMENT_S3_REGION') ?? 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: config.get<string>('MEDICAL_DOCUMENT_S3_FORCE_PATH_STYLE', 'true') === 'true',
      ...(credentials ? { credentials } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string, checksum: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
        ServerSideEncryption: 'AES256',
        Metadata: { sha256: checksum },
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeStorageKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error('Stored document is unavailable.');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    assertSafeStorageKey(key);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? '',
        checksum: response.Metadata?.sha256 ?? '',
      };
    } catch (error) {
      if (
        error instanceof Error &&
        '$metadata' in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      )
        return null;
      throw error;
    }
  }
}
