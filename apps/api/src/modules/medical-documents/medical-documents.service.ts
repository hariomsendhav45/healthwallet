import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthEventType, Prisma } from '../../generated/prisma';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';
import {
  CreateMedicalDocumentDto,
  ListMedicalDocumentsDto,
  UpdateMedicalDocumentDto,
} from './dto/medical-document.dto';
import { MEDICAL_DOCUMENT_SCANNER, MedicalDocumentScanner } from './file-scanner.interface';
import { DOCUMENT_STORAGE, MedicalDocumentStorage } from './storage/storage-provider.interface';
import { MEDICAL_OCR_PROVIDER, MedicalOcrProvider, ExtractedMedicalMetadata, ExtractedMedicalValue } from './ocr/ocr-provider';

const accepted = {
  '.pdf': {
    mime: 'application/pdf',
    signature: (b: Buffer) =>
      b.subarray(0, 5).toString() === '%PDF-' && b.includes(Buffer.from('%%EOF')),
  },
  '.jpg': {
    mime: 'image/jpeg',
    signature: (b: Buffer) =>
      b.length > 4 &&
      b[0] === 0xff &&
      b[1] === 0xd8 &&
      b[2] === 0xff &&
      b.at(-2) === 0xff &&
      b.at(-1) === 0xd9,
  },
  '.jpeg': {
    mime: 'image/jpeg',
    signature: (b: Buffer) =>
      b.length > 4 &&
      b[0] === 0xff &&
      b[1] === 0xd8 &&
      b[2] === 0xff &&
      b.at(-2) === 0xff &&
      b.at(-1) === 0xd9,
  },
  '.png': {
    mime: 'image/png',
    signature: (b: Buffer) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.includes(Buffer.from('IEND')),
  },
} as const;

const safeSelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  documentDate: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  uploadStatus: true,
  scanStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MedicalDocumentSelect;

type UploadFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

export function validateMedicalDocumentFile(file: UploadFile, maxBytes: number) {
  if (file.size <= 0) throw new BadRequestException('The selected file is empty.');
  if (file.size > maxBytes || file.buffer.byteLength > maxBytes)
    throw new BadRequestException(`Files must be no larger than ${maxBytes} bytes.`);
  const rawFileName = basename(file.originalname.replaceAll('\\', '/'));
  // eslint-disable-next-line no-control-regex
  const originalFileName = rawFileName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!originalFileName || originalFileName.length > 255)
    throw new BadRequestException('Enter a valid file name.');
  const extension = extname(originalFileName).toLowerCase() as keyof typeof accepted;
  const format = accepted[extension];
  if (!format || file.mimetype.toLowerCase() !== format.mime || !format.signature(file.buffer))
    throw new UnprocessableEntityException(
      'File type or contents are not supported. Upload a valid PDF, JPEG or PNG.',
    );
  return { originalFileName, extension, mimeType: format.mime };
}

@Injectable()
export class MedicalDocumentsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: MedicalDocumentStorage,
    @Inject(MEDICAL_DOCUMENT_SCANNER) private readonly scanner: MedicalDocumentScanner,
    @Inject(MEDICAL_OCR_PROVIDER) private readonly ocr: MedicalOcrProvider,
  ) {
    this.maxBytes = Number(config.get<string>('MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES', '15728640'));
  }

  async upload(
    userId: string,
    dto: CreateMedicalDocumentDto,
    file: UploadFile | undefined,
    request: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('Choose a PDF, JPEG or PNG file.');
    let validated: ReturnType<typeof validateMedicalDocumentFile>;
    try {
      validated = validateMedicalDocumentFile(file, this.maxBytes);
    } catch (error) {
      await this.audit(userId, 'MEDICAL_DOCUMENT_UPLOAD_REJECTED', request);
      throw error;
    }
    const { originalFileName, extension, mimeType } = validated;

    const profile = await this.prisma.$transaction(async (tx) => {
      const value = await tx.patientProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: 'MEDICAL_DOCUMENT_UPLOAD_INITIATED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      });
      return value;
    });
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const key = `${randomUUID()}${extension}`;
    let stored = false;
    try {
      const scanStatus = await this.scanner.scan(file.buffer);
      await this.storage.put(key, file.buffer, mimeType, checksum);
      stored = true;
      const metadata = await this.storage.head(key);
      if (!metadata || metadata.contentLength !== file.size || metadata.checksum !== checksum) {
        throw new ServiceUnavailableException('Uploaded file verification failed. Please retry.');
      }
      const safeTitle = (dto.title?.trim() || basename(originalFileName, extension)).slice(0, 180);
      const document = await this.prisma.$transaction(async (tx) => {
        const created = await tx.medicalDocument.create({
          data: {
            patientProfileId: profile.id,
            uploadedByUserId: userId,
            title: safeTitle || 'Medical report',
            description: dto.description?.trim() || null,
            category: dto.category,
            documentDate: dto.documentDate ? new Date(dto.documentDate) : null,
            originalFileName,
            storageKey: key,
            mimeType,
            fileSize: file.size,
            fileChecksum: checksum,
            uploadStatus: 'AVAILABLE',
            scanStatus,
          },
          select: safeSelect,
        });
        await tx.authAuditLog.create({
          data: {
            userId,
            eventType: 'MEDICAL_DOCUMENT_UPLOAD_COMPLETED',
            ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
          },
        });
        return created;
      });
      return { document };
    } catch (error) {
      if (stored) await this.storage.delete(key).catch(() => undefined);
      await this.audit(userId, 'MEDICAL_DOCUMENT_UPLOAD_REJECTED', request).catch(() => undefined);
      throw error;
    }
  }

  async list(userId: string, query: ListMedicalDocumentsDto) {
    const documentDate: Prisma.DateTimeNullableFilter | undefined =
      query.documentDateFrom || query.documentDateTo
        ? {
            ...(query.documentDateFrom ? { gte: new Date(query.documentDateFrom) } : {}),
            ...(query.documentDateTo ? { lte: new Date(query.documentDateTo) } : {}),
          }
        : undefined;
    const createdAt: Prisma.DateTimeFilter | undefined =
      query.uploadedAfter || query.uploadedBefore
        ? {
            ...(query.uploadedAfter ? { gte: new Date(query.uploadedAfter) } : {}),
            ...(query.uploadedBefore
              ? { lte: new Date(`${query.uploadedBefore}T23:59:59.999Z`) }
              : {}),
          }
        : undefined;
    const where: Prisma.MedicalDocumentWhereInput = {
      uploadedByUserId: userId,
      patientProfile: { userId },
      deletedAt: null,
      uploadStatus: 'AVAILABLE',
      ...(query.category ? { category: query.category } : {}),
      ...(query.mimeType ? { mimeType: query.mimeType } : {}),
      ...(documentDate ? { documentDate } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { originalFileName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where,
        select: safeSelect,
        orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);
    return {
      documents: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(userId: string, id: string, request: AuthenticatedRequest) {
    const document = await this.findOwned(userId, id, request);
    await this.audit(userId, 'MEDICAL_DOCUMENT_VIEWED', request);
    return { document };
  }

  async ocrStatus(userId: string, id: string, request: AuthenticatedRequest) {
    const document = await this.findOwned(userId, id, request);
    await this.audit(userId, 'MEDICAL_DOCUMENT_VIEWED', request);
    const record = await this.prisma.medicalDocumentOcrResult.findFirst({ where: { documentId: id, patientProfileId: document.patientProfileId }, select: { status: true, extractedText: true, extractedFields: true, extractedMetadata: true, reviewedText: true, reviewedFields: true, reviewedMetadata: true, reviewedAt: true, processedAt: true, attemptCount: true } });
    return {
      ocr: {
        status: record?.status ?? (this.ocr.configured ? 'PENDING' : 'DISABLED'),
        extractedText: record?.extractedText ?? null,
        extractedFields: record?.extractedFields ?? [],
        extractedMetadata: record?.extractedMetadata ?? null,
        reviewedText: record?.reviewedText ?? null,
        reviewedFields: record?.reviewedAt ? record.reviewedFields ?? record.extractedFields ?? [] : null,
        reviewedMetadata: record?.reviewedMetadata ?? null,
        reviewedAt: record?.reviewedAt ?? null,
        processedAt: record?.processedAt ?? null,
        retryAvailable: this.ocr.configured && (record?.attemptCount ?? 0) < 3,
        message: this.ocr.configured ? (record?.reviewedAt ? 'Patient-reviewed extraction.' : 'Extracted values are unverified; review them before using them as patient context.') : 'OCR provider is not configured. No text has been extracted.',
      },
    };
  }

  async retryOcr(userId: string, id: string, request: AuthenticatedRequest) {
    const document = await this.findOwned(userId, id, request, true);
    if (!this.ocr.configured) throw new ServiceUnavailableException('OCR is not configured. No retry was started.');
    await this.prisma.medicalDocumentOcrResult.upsert({ where: { documentId: id }, create: { documentId: id, patientProfileId: document.patientProfileId, status: 'PENDING', attemptCount: 0, updatedAt: new Date() }, update: {} });
    const claim = await this.prisma.medicalDocumentOcrResult.updateMany({ where: { documentId: id, patientProfileId: document.patientProfileId, status: { not: 'PROCESSING' }, attemptCount: { lt: 3 } }, data: { status: 'PROCESSING', attemptCount: { increment: 1 }, failureCode: null, updatedAt: new Date() } });
    if (!claim.count) {
      const state = await this.prisma.medicalDocumentOcrResult.findUnique({ where: { documentId: id }, select: { attemptCount: true, status: true } });
      if (state?.status === 'PROCESSING') throw new ServiceUnavailableException('OCR is already processing this report.');
      throw new ServiceUnavailableException('OCR retry limit reached.');
    }
    try {
      const stored = await this.storage.get(document.storageKey);
      if (stored.length !== document.fileSize || createHash('sha256').update(stored).digest('hex') !== document.fileChecksum) throw new ServiceUnavailableException('Stored document verification failed.');
      const result = await this.ocr.extract(stored, document.mimeType);
      const now = new Date();
      await this.prisma.medicalDocumentOcrResult.update({ where: { documentId: id }, data: { status: 'COMPLETED', extractedText: result.text, extractedFields: result.values as unknown as Prisma.InputJsonValue, extractedMetadata: result.metadata as unknown as Prisma.InputJsonValue, reviewedText: null, reviewedFields: Prisma.JsonNull, reviewedMetadata: Prisma.JsonNull, reviewedAt: null, reviewedByUserId: null, processedAt: now, failureCode: null, updatedAt: now } });
      await this.audit(userId, 'MEDICAL_DOCUMENT_VIEWED', request);
      return { ocr: { status: 'COMPLETED', pageCount: result.pageCount, engine: result.engine, extractedFields: result.values, extractedMetadata: result.metadata, reviewedAt: null, message: 'Extraction complete. Values are unverified; review them before use.' } };
    } catch (error) {
      await this.prisma.medicalDocumentOcrResult.update({ where: { documentId: id }, data: { status: 'FAILED', failureCode: 'EXTRACTION_FAILED', updatedAt: new Date() } }).catch(() => undefined);
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException || error instanceof UnprocessableEntityException) throw error;
      throw new ServiceUnavailableException('OCR failed. The original document is unchanged.');
    }
  }

  async reviewOcr(userId: string, id: string, reviewedText: string, reviewedFields: ExtractedMedicalValue[], reviewedMetadata: ExtractedMedicalMetadata, request: AuthenticatedRequest) {
    const document = await this.findOwned(userId, id, request);
    const existing = await this.prisma.medicalDocumentOcrResult.findFirst({ where: { documentId: id, patientProfileId: document.patientProfileId, status: 'COMPLETED' }, select: { documentId: true } });
    if (!existing) throw new NotFoundException('Completed OCR extraction not found.');
    const now = new Date();
    const reviewed = await this.prisma.medicalDocumentOcrResult.update({ where: { documentId: id }, data: { reviewedText, reviewedFields: reviewedFields as unknown as Prisma.InputJsonValue, reviewedMetadata: reviewedMetadata as unknown as Prisma.InputJsonValue, reviewedAt: now, reviewedByUserId: userId, updatedAt: now }, select: { reviewedText: true, reviewedFields: true, reviewedMetadata: true, reviewedAt: true } });
    await this.audit(userId, 'MEDICAL_DOCUMENT_METADATA_UPDATED', request);
    return { ocr: reviewed };
  }

  async content(userId: string, id: string, request: AuthenticatedRequest) {
    const document = await this.findOwned(userId, id, request, true);
    await this.audit(userId, 'MEDICAL_DOCUMENT_VIEWED', request);
    const metadata = await this.storage.head(document.storageKey);
    if (
      !metadata ||
      metadata.contentLength !== document.fileSize ||
      metadata.checksum !== document.fileChecksum ||
      metadata.contentLength > this.maxBytes
    ) {
      throw new ServiceUnavailableException('Stored document verification failed.');
    }
    const body = await this.storage.get(document.storageKey);
    if (
      body.byteLength !== document.fileSize ||
      createHash('sha256').update(body).digest('hex') !== document.fileChecksum
    )
      throw new ServiceUnavailableException('Stored document verification failed.');
    return { body, document };
  }

  async sharedContent(patientProfileId: string, id: string) {
    const document = await this.prisma.medicalDocument.findFirst({
      where: { id, patientProfileId, deletedAt: null, uploadStatus: 'AVAILABLE' },
      select: { ...safeSelect, storageKey: true, fileChecksum: true, patientProfileId: true },
    });
    if (!document) throw new NotFoundException('Shared document not found.');
    const metadata = await this.storage.head(document.storageKey);
    if (
      !metadata ||
      metadata.contentLength !== document.fileSize ||
      metadata.checksum !== document.fileChecksum ||
      metadata.contentLength > this.maxBytes
    )
      throw new ServiceUnavailableException('Stored document verification failed.');
    const body = await this.storage.get(document.storageKey);
    if (
      body.byteLength !== document.fileSize ||
      createHash('sha256').update(body).digest('hex') !== document.fileChecksum
    )
      throw new ServiceUnavailableException('Stored document verification failed.');
    return { body, document };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateMedicalDocumentDto,
    request: AuthenticatedRequest,
  ) {
    await this.findOwned(userId, id, request);
    const data: Prisma.MedicalDocumentUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.documentDate !== undefined
        ? { documentDate: dto.documentDate ? new Date(dto.documentDate) : null }
        : {}),
    };
    if (!Object.keys(data).length)
      throw new BadRequestException('Provide at least one metadata field to update.');
    const document = await this.prisma.medicalDocument.update({
      where: { id, uploadedByUserId: userId, deletedAt: null, uploadStatus: 'AVAILABLE' },
      data,
      select: safeSelect,
    });
    await this.audit(userId, 'MEDICAL_DOCUMENT_METADATA_UPDATED', request);
    return { document };
  }

  async remove(userId: string, id: string, request: AuthenticatedRequest) {
    const document = await this.findOwned(userId, id, request, true, true);
    await this.prisma.medicalDocument.update({
      where: { id, uploadedByUserId: userId },
      data: { uploadStatus: 'DELETING' },
    });
    try {
      await this.storage.delete(document.storageKey);
    } catch {
      throw new ServiceUnavailableException(
        'Document deletion is pending. Retry the delete request.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.medicalDocument.update({
        where: { id, uploadedByUserId: userId },
        data: { deletedAt: new Date(), uploadStatus: 'DELETED' },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId,
          eventType: 'MEDICAL_DOCUMENT_DELETED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      }),
    ]);
    return { deleted: true };
  }

  private async findOwned(
    userId: string,
    id: string,
    request: AuthenticatedRequest,
    allowDeleting = false,
    includeDeleting = false,
  ) {
    const document = await this.prisma.medicalDocument.findFirst({
      where: {
        id,
        uploadedByUserId: userId,
        patientProfile: { userId },
        deletedAt: null,
        uploadStatus: allowDeleting ? { in: ['AVAILABLE', 'DELETING'] } : 'AVAILABLE',
      },
      select: { ...safeSelect, storageKey: true, fileChecksum: true, patientProfileId: true },
    });
    if (!document || (document.uploadStatus === 'DELETING' && !includeDeleting)) {
      await this.audit(userId, 'MEDICAL_DOCUMENT_UNAUTHORIZED_ACCESS', request).catch(
        () => undefined,
      );
      throw new NotFoundException('Medical document not found.');
    }
    return document;
  }

  private async audit(userId: string, eventType: AuthEventType, request: AuthenticatedRequest) {
    await this.prisma.authAuditLog.create({
      data: { userId, eventType, ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}) },
    });
  }
}
