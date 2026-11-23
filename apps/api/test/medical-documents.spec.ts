import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  MedicalDocumentsService,
  validateMedicalDocumentFile,
} from '../src/modules/medical-documents/medical-documents.service';
import { AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';

const request = {
  ip: '127.0.0.1',
  auth: { userId: 'patient-one', sessionId: 'session-one', role: 'PATIENT' },
} as AuthenticatedRequest;

describe('medical document file validation', () => {
  it('accepts matching PDF, JPEG and PNG signatures', () => {
    expect(
      validateMedicalDocumentFile(
        {
          originalname: 'report.pdf',
          mimetype: 'application/pdf',
          size: 14,
          buffer: Buffer.from('%PDF-1.7\n%%EOF'),
        },
        20,
      ).mimeType,
    ).toBe('application/pdf');
    expect(
      validateMedicalDocumentFile(
        {
          originalname: 'scan.jpg',
          mimetype: 'image/jpeg',
          size: 5,
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9]),
        },
        20,
      ).mimeType,
    ).toBe('image/jpeg');
    expect(
      validateMedicalDocumentFile(
        {
          originalname: 'scan.png',
          mimetype: 'image/png',
          size: 12,
          buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 73, 69, 78, 68]),
        },
        20,
      ).mimeType,
    ).toBe('image/png');
  });

  it('rejects MIME spoofing, invalid signatures and oversized uploads', () => {
    expect(() =>
      validateMedicalDocumentFile(
        {
          originalname: 'script.pdf',
          mimetype: 'application/pdf',
          size: 12,
          buffer: Buffer.from('<script>x</script>'),
        },
        100,
      ),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      validateMedicalDocumentFile(
        {
          originalname: 'report.pdf',
          mimetype: 'image/png',
          size: 14,
          buffer: Buffer.from('%PDF-1.7\n%%EOF'),
        },
        100,
      ),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      validateMedicalDocumentFile(
        { originalname: 'large.png', mimetype: 'image/png', size: 21, buffer: Buffer.alloc(21) },
        20,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateMedicalDocumentFile(
        {
          originalname: '../run.exe',
          mimetype: 'application/octet-stream',
          size: 3,
          buffer: Buffer.from('MZ\0'),
        },
        100,
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('reduces Windows paths to a display name and does not use them as storage keys', () => {
    const result = validateMedicalDocumentFile(
      {
        originalname: 'C:\\Users\\patient\\report.pdf',
        mimetype: 'application/pdf',
        size: 14,
        buffer: Buffer.from('%PDF-1.7\n%%EOF'),
      },
      100,
    );
    expect(result.originalFileName).toBe('report.pdf');
  });
});

describe('medical document patient ownership', () => {
  it('reports OCR disabled for an owned document without claiming extracted text exists', async () => {
    const ownedDocument = {
      id: '00000000-0000-4000-8000-000000000777',
      uploadStatus: 'AVAILABLE',
      storageKey: '00000000-0000-4000-8000-000000000777.pdf',
    };
    const prisma = {
      medicalDocument: { findFirst: jest.fn().mockResolvedValue(ownedDocument) },
      medicalDocumentOcrResult: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      {} as never,
      {} as never,
      { configured: false } as never,
    );

    await expect(
      service.ocrStatus('patient-one', ownedDocument.id, request),
    ).resolves.toMatchObject({
      ocr: {
        status: 'DISABLED',
        extractedText: null,
        reviewedText: null,
        retryAvailable: false,
      },
    });
    expect(prisma.medicalDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uploadedByUserId: 'patient-one',
          patientProfile: { userId: 'patient-one' },
        }),
      }),
    );
  });

  it('does not expose OCR status for another patient or start a retry without a provider', async () => {
    const prisma = {
      medicalDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      medicalDocumentOcrResult: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      {} as never,
      {} as never,
      { configured: false } as never,
    );
    const id = '00000000-0000-4000-8000-000000000777';

    await expect(service.ocrStatus('patient-one', id, request)).rejects.toThrow(NotFoundException);
    await expect(service.retryOcr('patient-one', id, request)).rejects.toThrow(NotFoundException);
    prisma.medicalDocument.findFirst.mockResolvedValue({ id, uploadStatus: 'AVAILABLE' });
    await expect(service.retryOcr('patient-one', id, request)).rejects.toThrow(
      'OCR is not configured. No retry was started.',
    );
  });

  it('returns unreviewed extraction separately so the patient UI can review extracted values', async () => {
    const id = '00000000-0000-4000-8000-000000000778';
    const extractedFields = [{ testName: 'Hemoglobin', value: '12.5', unit: 'g/dL', confidence: 'REVIEW_REQUIRED' }];
    const prisma = {
      medicalDocument: { findFirst: jest.fn().mockResolvedValue({ id, patientProfileId: 'profile-one', uploadStatus: 'AVAILABLE', storageKey: `${id}.pdf` }) },
      medicalDocumentOcrResult: { findFirst: jest.fn().mockResolvedValue({ status: 'COMPLETED', extractedText: 'Hemoglobin 12.5 g/dL', extractedFields, extractedMetadata: null, reviewedText: null, reviewedFields: null, reviewedMetadata: null, reviewedAt: null, processedAt: new Date(), attemptCount: 1 }) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalDocumentsService(prisma as never, { get: () => '15728640' } as never, {} as never, {} as never, { configured: true } as never);
    const result = await service.ocrStatus('patient-one', id, request);
    expect(result.ocr.extractedFields).toEqual(extractedFields);
    expect(result.ocr.reviewedFields).toBeNull();
    expect(result.ocr.status).toBe('COMPLETED');
  });

  it('stores only a verified object key and makes a document available after checksum verification', async () => {
    const file = {
      originalname: 'Synthetic report.pdf',
      mimetype: 'application/pdf',
      size: 14,
      buffer: Buffer.from('%PDF-1.7\n%%EOF'),
    };
    const profile = { id: 'profile-one' };
    const document = {
      id: '00000000-0000-4000-8000-000000000777',
      title: 'Synthetic report',
      description: null,
      category: 'BLOOD_TEST',
      documentDate: null,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadStatus: 'AVAILABLE',
      scanStatus: 'CLEAN',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      patientProfile: { upsert: jest.fn().mockResolvedValue(profile) },
      medicalDocument: { create: jest.fn().mockResolvedValue(document) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      head: jest.fn().mockImplementation(async () => ({
        contentLength: file.size,
        contentType: file.mimetype,
        checksum,
      })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const scanner = { scan: jest.fn().mockResolvedValue('CLEAN') };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      storage as never,
      scanner as never,
      { configured: false } as never,
    );
    const result = await service.upload(
      'patient-one',
      { category: 'BLOOD_TEST' } as never,
      file,
      request,
    );
    expect(result.document).toEqual(document);
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}\.pdf$/),
      file.buffer,
      file.mimetype,
      expect.any(String),
    );
    expect(tx.medicalDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patientProfileId: profile.id,
          uploadedByUserId: 'patient-one',
          uploadStatus: 'AVAILABLE',
          scanStatus: 'CLEAN',
        }),
        select: expect.not.objectContaining({ storageKey: true }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('storageKey');
  });

  it('does not return a document belonging to another patient and audits the attempt', async () => {
    const prisma = {
      medicalDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      {} as never,
      {} as never,
      { configured: false } as never,
    );
    await expect(
      service.get('patient-one', '00000000-0000-4000-8000-000000000002', request),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.medicalDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uploadedByUserId: 'patient-one',
          patientProfile: { userId: 'patient-one' },
        }),
      }),
    );
    expect(prisma.authAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'patient-one',
          eventType: 'MEDICAL_DOCUMENT_UNAUTHORIZED_ACCESS',
        }),
      }),
    );
  });

  it('scopes paginated search and date/file filters to the authenticated patient', async () => {
    const prisma = {
      medicalDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      {} as never,
      {} as never,
      { configured: false } as never,
    );
    await service.list('patient-one', {
      q: 'CBC',
      category: 'BLOOD_TEST',
      mimeType: 'application/pdf',
      documentDateFrom: '2026-01-01',
      documentDateTo: '2026-01-31',
      uploadedAfter: '2026-02-01',
      uploadedBefore: '2026-02-20',
      page: 2,
      limit: 10,
    } as never);
    expect(prisma.medicalDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({
          uploadedByUserId: 'patient-one',
          patientProfile: { userId: 'patient-one' },
          category: 'BLOOD_TEST',
          mimeType: 'application/pdf',
          OR: expect.arrayContaining([
            expect.objectContaining({ title: expect.objectContaining({ contains: 'CBC' }) }),
          ]),
        }),
      }),
    );
  });

  it('updates only metadata for an owned document and records the change', async () => {
    const id = '00000000-0000-4000-8000-000000000777';
    const document = { id, storageKey: `${id}.pdf`, fileChecksum: 'a'.repeat(64), uploadStatus: 'AVAILABLE' };
    const updated = { id, title: 'Updated report', category: 'OTHER' };
    const prisma = {
      medicalDocument: {
        findFirst: jest.fn().mockResolvedValue(document),
        update: jest.fn().mockResolvedValue(updated),
      },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      {} as never,
      {} as never,
      { configured: false } as never,
    );
    await expect(service.update('patient-one', id, { title: 'Updated report' }, request)).resolves.toEqual({ document: updated });
    expect(prisma.medicalDocument.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id, uploadedByUserId: 'patient-one', deletedAt: null, uploadStatus: 'AVAILABLE' },
      data: { title: 'Updated report' },
    }));
    expect(prisma.authAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'MEDICAL_DOCUMENT_METADATA_UPDATED' }),
    }));
  });

  it('removes the private object before marking owned metadata deleted', async () => {
    const id = '00000000-0000-4000-8000-000000000777';
    const document = { id, storageKey: `${id}.pdf`, fileChecksum: 'a'.repeat(64), uploadStatus: 'AVAILABLE' };
    const prisma = {
      medicalDocument: {
        findFirst: jest.fn().mockResolvedValue(document),
        update: jest.fn().mockResolvedValue({}),
      },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = new MedicalDocumentsService(
      prisma as never,
      { get: () => '15728640' } as never,
      storage as never,
      {} as never,
      { configured: false } as never,
    );
    await expect(service.remove('patient-one', id, request)).resolves.toEqual({ deleted: true });
    expect(storage.delete).toHaveBeenCalledWith(document.storageKey);
    expect(prisma.medicalDocument.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id, uploadedByUserId: 'patient-one' },
      data: expect.objectContaining({ uploadStatus: 'DELETED', deletedAt: expect.any(Date) }),
    }));
  });
});
