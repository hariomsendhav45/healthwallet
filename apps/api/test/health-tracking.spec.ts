import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';
import {
  CreateBloodGlucoseReadingDto,
  CreateBloodPressureReadingDto,
  ListHealthReadingsDto,
} from '../src/modules/health-tracking/dto/health-tracking.dto';
import { HealthTrackingService } from '../src/modules/health-tracking/health-tracking.service';

const req = { ip: '127.0.0.1', auth: { userId: 'patient-one' } } as AuthenticatedRequest;
const config = { get: (_key: string, fallback: string) => fallback };

describe('health tracking DTO validation', () => {
  it('accepts BP and heart-rate input with a timestamp and bounded notes', async () => {
    const dto = plainToInstance(CreateBloodPressureReadingDto, {
      systolic: '185', diastolic: '105', heartRate: '72', measuredAt: '2026-11-06T12:30:00.000Z', notes: 'Synthetic reading',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid pressure relationships, missing timezones, and oversized notes', async () => {
    const dto = plainToInstance(CreateBloodPressureReadingDto, {
      systolic: 80, diastolic: 80, measuredAt: '2026-11-06', notes: 'x'.repeat(1001),
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('requires a supported glucose unit and measurement type', async () => {
    const dto = plainToInstance(CreateBloodGlucoseReadingDto, {
      glucoseValue: '95.5', glucoseUnit: 'UNITS', measurementType: 'UNKNOWN', measuredAt: '2026-11-06T12:30:00.000Z',
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('bounds pagination and applies default paging', async () => {
    const valid = plainToInstance(ListHealthReadingsDto, { page: '2', pageSize: '50', sort: 'ASC' });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.page).toBe(2);
    expect(valid.pageSize).toBe(50);
    const invalid = plainToInstance(ListHealthReadingsDto, { pageSize: 101 });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});

describe('HealthTrackingService patient ownership and data handling', () => {
  it('stores unusual but valid BP values and audits only event metadata', async () => {
    const reading = { id: 'reading-1', systolic: 185, diastolic: 105, heartRate: 72 };
    const tx = {
      patientProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-one' }) },
      bloodPressureReading: { create: jest.fn().mockResolvedValue(reading) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new HealthTrackingService(prisma as never, config as never);
    const result = await service.createBloodPressure('patient-one', {
      systolic: 185, diastolic: 105, heartRate: 72, measuredAt: '2026-11-06T12:30:00.000Z', notes: 'Synthetic detail',
    }, req);
    expect(result.reading).toEqual(reading);
    expect(tx.bloodPressureReading.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ patientProfileId: 'profile-one', systolic: 185, diastolic: 105 }),
    }));
    expect(tx.authAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'patient-one', eventType: 'PATIENT_BP_READING_CREATED', ipAddress: '127.0.0.1' }) });
    expect(JSON.stringify(tx.authAuditLog.create.mock.calls)).not.toContain('Synthetic detail');
  });

  it('rejects future measurement dates before any database write', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new HealthTrackingService(prisma as never, config as never);
    await expect(service.createBloodPressure('patient-one', {
      systolic: 120, diastolic: 80, measuredAt: '2999-01-01T00:00:00.000Z',
    }, req)).rejects.toThrow('Measurement date cannot be more than five minutes in the future.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('scopes BP list pagination and date filters to the authenticated patient', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      bloodPressureReading: { findMany, count },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new HealthTrackingService(prisma as never, config as never);
    await service.listBloodPressure('patient-one', plainToInstance(ListHealthReadingsDto, {
      page: 2, pageSize: 10, startDate: '2026-11-01', endDate: '2026-11-06', sort: 'ASC',
    }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ patientProfile: { userId: 'patient-one' }, deletedAt: null }),
      skip: 10, take: 10, orderBy: { measuredAt: 'asc' },
    }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.measuredAt.gte).toEqual(new Date('2026-11-01'));
    expect(where.measuredAt.lt).toEqual(new Date('2026-11-07'));
  });

  it('does not update a reading that belongs to another patient', async () => {
    const update = jest.fn();
    const tx = { bloodPressureReading: { findFirst: jest.fn().mockResolvedValue(null), update }, authAuditLog: { create: jest.fn() } };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new HealthTrackingService(prisma as never, config as never);
    await expect(service.updateBloodPressure('patient-one', 'foreign-id', { systolic: 121 }, req)).rejects.toThrow('Reading not found.');
    expect(tx.bloodPressureReading.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-id', deletedAt: null, patientProfile: { userId: 'patient-one' } } }));
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves the selected glucose unit, value, and measurement type', async () => {
    const tx = {
      patientProfile: { upsert: jest.fn().mockResolvedValue({ id: 'profile-one' }) },
      bloodGlucoseReading: { create: jest.fn().mockResolvedValue({ id: 'glucose-1', glucoseValue: 5.2, glucoseUnit: 'MMOL_L', measurementType: 'FASTING' }) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new HealthTrackingService(prisma as never, config as never);
    const result = await service.createBloodGlucose('patient-one', {
      glucoseValue: 5.2, glucoseUnit: 'MMOL_L', measurementType: 'FASTING', measuredAt: '2026-11-06T12:30:00.000Z',
    }, req);
    expect(tx.bloodGlucoseReading.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ glucoseValue: 5.2, glucoseUnit: 'MMOL_L', measurementType: 'FASTING' }) }));
    expect(result.reading).toMatchObject({ glucoseValue: 5.2, glucoseUnit: 'MMOL_L', measurementType: 'FASTING' });
  });
});
