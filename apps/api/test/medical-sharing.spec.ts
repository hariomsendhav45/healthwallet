import { createHash } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../src/database/prisma.service';
import { AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';
import {
  CreateMedicalShareSessionDto,
  ScanMedicalShareDto,
} from '../src/modules/medical-sharing/dto/medical-sharing.dto';
import { MedicalSharingService } from '../src/modules/medical-sharing/medical-sharing.service';

const patient = '11111111-1111-4111-8111-111111111111';
const doctor = '22222222-2222-4222-8222-222222222222';
const profile = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const grantId = '55555555-5555-4555-8555-555555555555';
const req = { ip: '127.0.0.1' } as AuthenticatedRequest;
const config = { get: (_key: string, fallback: string) => fallback } as never;
const makeService = (prisma: object) => new MedicalSharingService(prisma as PrismaService, config);

describe('Medical sharing DTO validation', () => {
  it('requires a selected permission, bounded duration and opaque random token shape', async () => {
    const valid = plainToInstance(CreateMedicalShareSessionDto, {
      permissionTypes: ['BLOOD_PRESSURE_READINGS'],
      durationMinutes: 15,
    });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(CreateMedicalShareSessionDto, {
      permissionTypes: [],
      durationMinutes: 120,
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
    expect(
      await validate(plainToInstance(ScanMedicalShareDto, { token: 'patient=Jane;bp=120/80' })),
    ).not.toHaveLength(0);
  });
});

describe('MedicalSharingService', () => {
  it('persists only a cryptographic token hash and returns the raw token once', async () => {
    const created = {
      id: sessionId,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 900_000),
      createdAt: new Date(),
      revokedAt: null,
      maxUses: 5,
      useCount: 0,
      permissions: [{ permissionType: 'BLOOD_PRESSURE_READINGS' }],
      documents: [],
    };
    const tx = {
      medicalShareSession: { create: jest.fn().mockResolvedValue(created) },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: profile }) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const result = await makeService(prisma).createSession(
      patient,
      { permissionTypes: ['BLOOD_PRESSURE_READINGS'], durationMinutes: 15 },
      req,
    );
    const data = tx.medicalShareSession.create.mock.calls[0][0].data;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.tokenHash).toBe(createHash('sha256').update(result.token).digest('hex'));
    expect(data.tokenHash).not.toBe(result.token);
    expect(result.session).not.toHaveProperty('tokenHash');
  });

  it('refuses document permission without selecting specific patient-owned reports', async () => {
    const prisma = { patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: profile }) } };
    await expect(
      makeService(prisma).createSession(
        patient,
        { permissionTypes: ['MEDICAL_DOCUMENTS'], durationMinutes: 5 },
        req,
      ),
    ).rejects.toThrow('specific reports');
  });

  it('denies a doctor whose verification status is not verified before looking up a QR token', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'DOCTOR',
          phoneVerified: true,
          doctorVerificationStatus: 'PENDING',
          accountStatus: 'ACTIVE',
        }),
      },
      medicalShareSession: { findUnique: jest.fn() },
    };
    await expect(makeService(prisma).scan(doctor, 'A'.repeat(43), req)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.medicalShareSession.findUnique).not.toHaveBeenCalled();
  });

  it.each(['UNDER_REVIEW', 'REJECTED', 'SUSPENDED'])(
    'blocks %s doctors from creating a patient access request',
    async (status) => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'DOCTOR', phoneVerified: true, doctorVerificationStatus: status, accountStatus: 'ACTIVE', isDevelopmentTestAccount: false }) },
        medicalShareSession: { findUnique: jest.fn() },
      };
      await expect(makeService(prisma).scan(doctor, 'A'.repeat(43), req)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.medicalShareSession.findUnique).not.toHaveBeenCalled();
    },
  );

  it('denies synthetic development doctor accounts even if an old session claims approval', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'DOCTOR', phoneVerified: true, doctorVerificationStatus: 'APPROVED', accountStatus: 'ACTIVE', isDevelopmentTestAccount: true }) },
      medicalShareSession: { findUnique: jest.fn() },
    };
    await expect(makeService(prisma).scan(doctor, 'A'.repeat(43), req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.medicalShareSession.findUnique).not.toHaveBeenCalled();
  });

  it('creates a pending request after a valid scan but never grants access on scan alone', async () => {
    const scanned = {
      id: sessionId,
      patientProfileId: profile,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      maxUses: 5,
      useCount: 0,
    };
    const requestRow = {
      id: 'request-1',
      status: 'PENDING',
      requestedAt: new Date(),
      expiresAt: scanned.expiresAt,
    };
    const tx = {
      doctorAccessRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(requestRow),
      },
      medicalShareSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'DOCTOR',
          phoneVerified: true,
          doctorVerificationStatus: 'APPROVED',
          accountStatus: 'ACTIVE',
        }),
      },
      medicalShareSession: { findUnique: jest.fn().mockResolvedValue(scanned) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
      medicalRecordAccessGrant: { create: jest.fn() },
    };
    const rawToken = 'A'.repeat(43);
    const result = await makeService(prisma).scan(doctor, rawToken, req);
    expect(prisma.medicalShareSession.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
      select: expect.any(Object),
    });
    expect(result.request.status).toBe('PENDING');
    expect(tx.medicalShareSession.updateMany).toHaveBeenCalled();
    expect(prisma.medicalRecordAccessGrant.create).not.toHaveBeenCalled();
  });

  it('does not disclose whether an invalid QR token belongs to a patient', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'DOCTOR',
          phoneVerified: true,
          doctorVerificationStatus: 'APPROVED',
          accountStatus: 'ACTIVE',
        }),
      },
      medicalShareSession: { findUnique: jest.fn().mockResolvedValue(null) },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await expect(makeService(prisma).scan(doctor, 'B'.repeat(43), req)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a grant only when the patient approves the pending request', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const tx = {
      doctorAccessRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'request-1',
          status: 'PENDING',
          expiresAt,
          shareSessionId: sessionId,
          doctorUserId: doctor,
          shareSession: { status: 'ACTIVE', expiresAt },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalRecordAccessGrant: { create: jest.fn().mockResolvedValue({ id: grantId }) },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: profile }) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const result = await makeService(prisma).reviewRequest(patient, 'request-1', 'approve', req);
    expect(result.status).toBe('APPROVED');
    expect(tx.medicalRecordAccessGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patientProfileId: profile,
        doctorUserId: doctor,
        shareSessionId: sessionId,
        grantedByUserId: patient,
        expiresAt,
      }),
    });
  });

  it('rejects consent without creating a grant', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const tx = {
      doctorAccessRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'request-1',
          status: 'PENDING',
          expiresAt,
          shareSessionId: sessionId,
          doctorUserId: doctor,
          shareSession: { status: 'ACTIVE', expiresAt },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalRecordAccessGrant: { create: jest.fn() },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: profile }) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    await makeService(prisma).reviewRequest(patient, 'request-1', 'reject', req);
    expect(tx.medicalRecordAccessGrant.create).not.toHaveBeenCalled();
  });

  it('queries only the category selected in the grant', async () => {
    const reading = {
      id: 'bp-1',
      systolic: 120,
      diastolic: 80,
      heartRate: null,
      measuredAt: new Date(),
      notes: null,
    };
    const grant = {
      id: grantId,
      patientProfileId: profile,
      shareSessionId: sessionId,
      expiresAt: new Date(Date.now() + 60_000),
      grantedAt: new Date(),
      shareSession: { permissions: [{ permissionType: 'BLOOD_PRESSURE_READINGS' }], documents: [] },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'DOCTOR',
          phoneVerified: true,
          doctorVerificationStatus: 'APPROVED',
          accountStatus: 'ACTIVE',
        }),
      },
      medicalRecordAccessGrant: { findFirst: jest.fn().mockResolvedValue(grant) },
      patientProfile: {
        findUnique: jest.fn().mockResolvedValue({ bloodPressureReadings: [reading] }),
      },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const response = await makeService(prisma).doctorPatientAccess(doctor, grantId, req);
    const select = prisma.patientProfile.findUnique.mock.calls[0][0].select;
    expect(select.bloodPressureReadings).toBeDefined();
    expect(select.bloodGlucoseReadings).toBeUndefined();
    expect(select.medicalDocuments).toBeUndefined();
    expect(select.healthInformation).toBeUndefined();
    expect(response.records).toEqual({ bloodPressureReadings: [reading] });
  });

  it('denies revoked grants and marks expired grants inactive before denying access', async () => {
    const revoked = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'DOCTOR',
          phoneVerified: true,
          doctorVerificationStatus: 'APPROVED',
          accountStatus: 'ACTIVE',
        }),
      },
      medicalRecordAccessGrant: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await expect(
      makeService(revoked).doctorPatientAccess(doctor, grantId, req),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revoked.medicalRecordAccessGrant.update).not.toHaveBeenCalled();
    const expired = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'DOCTOR',
          phoneVerified: true,
          doctorVerificationStatus: 'APPROVED',
          accountStatus: 'ACTIVE',
        }),
      },
      medicalRecordAccessGrant: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: grantId,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() - 1),
            patientProfileId: profile,
            shareSessionId: sessionId,
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      medicalSharingAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await expect(
      makeService(expired).doctorPatientAccess(doctor, grantId, req),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(expired.medicalRecordAccessGrant.update).toHaveBeenCalledWith({
      where: { id: grantId },
      data: { status: 'EXPIRED' },
    });
  });

  it('does not let a patient revoke another patient’s session by guessing its UUID', async () => {
    const tx = { medicalShareSession: { findFirst: jest.fn().mockResolvedValue(null) } };
    const prisma = {
      patientProfile: { findUnique: jest.fn().mockResolvedValue({ id: profile }) },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    await expect(makeService(prisma).revokeSession(patient, sessionId, req)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
