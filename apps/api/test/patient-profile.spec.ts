import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthGuard, AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';
import {
  UpdatePatientHealthInformationDto,
  UpdatePatientProfileDto,
} from '../src/modules/patient-profile/dto/patient-profile.dto';
import { PatientProfileController } from '../src/modules/patient-profile/patient-profile.controller';
import { PatientProfileService } from '../src/modules/patient-profile/patient-profile.service';

const request = (userId: string) =>
  ({ auth: { userId, sessionId: 'session-id', role: 'PATIENT' } }) as AuthenticatedRequest;

describe('patient profile ownership boundary', () => {
  it('does not accept native bearer credentials after the PWA session transition', async () => {
    const tokens = { verifyAccessToken: jest.fn().mockReturnValue(null) };
    const prisma = { refreshSession: { findFirst: jest.fn() } };
    const guard = new AuthGuard(tokens as never, prisma as never);
    const req = { headers: { authorization: 'Bearer native-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    await expect(guard.canActivate(context)).rejects.toThrow('Authentication required.');
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
    expect(prisma.refreshSession.findFirst).not.toHaveBeenCalled();
  });

  it('uses the authenticated principal for profile reads', async () => {
    const service = { getProfile: jest.fn().mockResolvedValue({ profile: null }) };
    const controller = new PatientProfileController(service as unknown as PatientProfileService);
    const req = request('patient-one');
    await controller.getProfile(req);
    expect(service.getProfile).toHaveBeenCalledWith('patient-one', req);
  });

  it('does not accept a caller-supplied user ID in profile DTOs', async () => {
    const dto = plainToInstance(UpdatePatientProfileDto, {
      fullName: 'Synthetic Patient',
      userId: 'patient-two',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === 'userId')).toBe(true);
  });

  it('validates date, Indian postal code, emergency mobile and enums', async () => {
    const valid = plainToInstance(UpdatePatientProfileDto, {
      dateOfBirth: '1990-02-28',
      postalCode: '560001',
      emergencyContactPhone: '9876543210',
      gender: 'PREFER_NOT_TO_SAY',
      bloodGroup: 'O_POSITIVE',
    });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(UpdatePatientProfileDto, {
      dateOfBirth: '2026-02-30',
      postalCode: '01234A',
      emergencyContactPhone: '12345',
      gender: 'UNKNOWN',
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });

  it('bounds health text and restricts status values', async () => {
    const valid = plainToInstance(UpdatePatientHealthInformationDto, {
      diabetesStatus: 'PREDIABETES',
      hypertensionStatus: 'NO',
      allergies: 'Synthetic example',
    });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(UpdatePatientHealthInformationDto, {
      diabetesStatus: 'SEVERE',
      additionalNotes: 'x'.repeat(4001),
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});

describe('PatientProfileService', () => {
  it('upserts only the authenticated account profile and audits without profile values', async () => {
    const tx = {
      patientProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          user: { phoneNumber: '+919876543210' },
          fullName: 'Synthetic Patient',
        }),
      },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PatientProfileService(prisma as never);
    const result = await service.updateProfile(
      'patient-one',
      { fullName: 'Synthetic Patient', emergencyContactPhone: '9876543210' },
      request('patient-one'),
    );
    expect(tx.patientProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'patient-one' },
        create: expect.objectContaining({
          userId: 'patient-one',
          emergencyContactPhone: '+919876543210',
        }),
      }),
    );
    expect(tx.authAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'patient-one',
        eventType: 'PATIENT_PROFILE_CREATED',
      }),
    });
    expect(JSON.stringify(tx.authAuditLog.create.mock.calls)).not.toContain('Synthetic Patient');
    expect(result.profile).not.toHaveProperty('userId');
  });

  it('creates health information through the owning account profile and audits no health text', async () => {
    const tx = {
      patientProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-one' }) },
      patientHealthInformation: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          diabetesStatus: 'UNKNOWN',
          hypertensionStatus: 'UNKNOWN',
          allergies: 'Synthetic example',
        }),
      },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new PatientProfileService(prisma as never);
    await service.updateHealthInformation(
      'patient-one',
      { allergies: 'Synthetic example' },
      request('patient-one'),
    );
    expect(tx.patientProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'patient-one' },
        create: { userId: 'patient-one' },
      }),
    );
    expect(tx.patientHealthInformation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientProfileId: 'profile-one' },
        create: expect.objectContaining({
          patientProfileId: 'profile-one',
          allergies: 'Synthetic example',
        }),
      }),
    );
    expect(tx.authAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'patient-one',
        eventType: 'PATIENT_HEALTH_INFORMATION_CREATED',
      }),
    });
    expect(JSON.stringify(tx.authAuditLog.create.mock.calls)).not.toContain('Synthetic example');
  });

  it('rejects a future DOB before any database write', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new PatientProfileService(prisma as never);
    await expect(
      service.updateProfile('patient-one', { dateOfBirth: '2999-01-01' }, request('patient-one')),
    ).rejects.toThrow('Enter a valid date of birth.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
