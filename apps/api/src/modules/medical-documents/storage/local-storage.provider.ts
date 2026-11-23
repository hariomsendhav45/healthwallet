import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  assertSafeStorageKey,
  MedicalDocumentStorage,
  StoredObjectMetadata,
} from './storage-provider.interface';

/** Development/test only. Objects live outside all web-served directories. */
@Injectable()
export class LocalPrivateStorageProvider implements MedicalDocumentStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('MEDICAL_DOCUMENT_LOCAL_DIR');
    const defaultDirectory =
      process.platform === 'win32'
        ? join(process.env.LOCALAPPDATA ?? homedir(), 'HealthVault', 'private-medical-documents')
        : join(homedir(), '.healthvault', 'private-medical-documents');
    const base = configured ?? defaultDirectory;
    this.root = resolve(isAbsolute(base) ? base : join(process.cwd(), base));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.filePath(key);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, body, { flag: 'wx', mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.filePath(key));
    } catch {
      throw new Error('Stored document is unavailable.');
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const body = await readFile(this.filePath(key));
      const info = await stat(this.filePath(key));
      return {
        contentLength: info.size,
        contentType: '',
        checksum: createHash('sha256').update(body).digest('hex'),
      };
    } catch {
      return null;
    }
  }

  private filePath(key: string): string {
    assertSafeStorageKey(key);
    const file = resolve(this.root, key);
    if (dirname(file) !== this.root) throw new Error('Invalid internal document key.');
    return file;
  }
}
