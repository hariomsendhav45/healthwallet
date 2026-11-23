import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthEventType, Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';
import {
  CreateBloodGlucoseReadingDto,
  CreateBloodPressureReadingDto,
  HealthSummaryQueryDto,
  ListHealthReadingsDto,
  UpdateBloodGlucoseReadingDto,
  UpdateBloodPressureReadingDto,
} from './dto/health-tracking.dto';

const bpSelect = {
  id: true,
  systolic: true,
  diastolic: true,
  heartRate: true,
  measuredAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BloodPressureReadingSelect;

const glucoseSelect = {
  id: true,
  glucoseValue: true,
  glucoseUnit: true,
  measurementType: true,
  measuredAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BloodGlucoseReadingSelect;

type DateRange = { gte?: Date; lt?: Date };

@Injectable()
export class HealthTrackingService {
  private readonly bpLimits: { systolicMin: number; systolicMax: number; diastolicMin: number; diastolicMax: number; heartRateMin: number; heartRateMax: number };
  private readonly glucoseLimits: { mgDlMin: number; mgDlMax: number; mmolLMin: number; mmolLMax: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.bpLimits = {
      systolicMin: this.setting('BP_SYSTOLIC_MIN', 40),
      systolicMax: this.setting('BP_SYSTOLIC_MAX', 300),
      diastolicMin: this.setting('BP_DIASTOLIC_MIN', 20),
      diastolicMax: this.setting('BP_DIASTOLIC_MAX', 200),
      heartRateMin: this.setting('BP_HEART_RATE_MIN', 20),
      heartRateMax: this.setting('BP_HEART_RATE_MAX', 250),
    };
    this.glucoseLimits = {
      mgDlMin: this.setting('GLUCOSE_MG_DL_MIN', 1),
      mgDlMax: this.setting('GLUCOSE_MG_DL_MAX', 2000),
      mmolLMin: this.setting('GLUCOSE_MMOL_L_MIN', 0.1),
      mmolLMax: this.setting('GLUCOSE_MMOL_L_MAX', 111.1),
    };
    if (
      this.bpLimits.systolicMin > this.bpLimits.systolicMax ||
      this.bpLimits.diastolicMin > this.bpLimits.diastolicMax ||
      this.bpLimits.heartRateMin > this.bpLimits.heartRateMax ||
      this.glucoseLimits.mgDlMin > this.glucoseLimits.mgDlMax ||
      this.glucoseLimits.mgDlMax > 2000 ||
      this.glucoseLimits.mmolLMin > this.glucoseLimits.mmolLMax ||
      this.glucoseLimits.mmolLMax > 2000
    ) throw new Error('Health tracking input limits are inconsistent with each other or the database bounds.');
  }

  private setting(name: string, fallback: number): number {
    const value = Number(this.config.get<string>(name, String(fallback)));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name} configuration.`);
    return value;
  }

  private dateRange(query: Pick<HealthSummaryQueryDto, 'startDate' | 'endDate'>): DateRange {
    const start = query.startDate ? this.parseDate(query.startDate) : undefined;
    const end = query.endDate ? this.parseDate(query.endDate) : undefined;
    if (start && end && start > end) throw new BadRequestException('Start date must be before end date.');
    const range: DateRange = {};
    if (start) range.gte = start;
    if (end) {
      // Date-only filters include the full selected end date; ISO timestamps remain exact.
      const exclusiveEnd = /^\d{4}-\d{2}-\d{2}$/.test(query.endDate!)
        ? new Date(end.getTime() + 24 * 60 * 60 * 1000)
        : end;
      range.lt = exclusiveEnd;
    }
    return range;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException('Enter a valid measurement date and time.');
    if (date.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException('Measurement date cannot be more than five minutes in the future.');
    return date;
  }

  private validateBp(value: { systolic: number; diastolic: number; heartRate?: number | null; measuredAt: string }) {
    const measuredAt = this.parseDate(value.measuredAt);
    const limits = this.bpLimits;
    if (value.systolic < limits.systolicMin || value.systolic > limits.systolicMax)
      throw new BadRequestException(`Systolic input must be between ${limits.systolicMin} and ${limits.systolicMax} mmHg.`);
    if (value.diastolic < limits.diastolicMin || value.diastolic > limits.diastolicMax)
      throw new BadRequestException(`Diastolic input must be between ${limits.diastolicMin} and ${limits.diastolicMax} mmHg.`);
    if (value.diastolic >= value.systolic)
      throw new BadRequestException('Diastolic pressure must be lower than systolic pressure.');
    if (value.heartRate != null && (value.heartRate < limits.heartRateMin || value.heartRate > limits.heartRateMax))
      throw new BadRequestException(`Heart rate input must be between ${limits.heartRateMin} and ${limits.heartRateMax} bpm.`);
    return measuredAt;
  }

  private validateGlucose(value: Pick<CreateBloodGlucoseReadingDto, 'glucoseValue' | 'glucoseUnit' | 'measurementType' | 'measuredAt'>) {
    const measuredAt = this.parseDate(value.measuredAt);
    const isMg = value.glucoseUnit === 'MG_DL';
    const min = isMg ? this.glucoseLimits.mgDlMin : this.glucoseLimits.mmolLMin;
    const max = isMg ? this.glucoseLimits.mgDlMax : this.glucoseLimits.mmolLMax;
    if (value.glucoseValue < min || value.glucoseValue > max)
      throw new BadRequestException(`Glucose input must be between ${min} and ${max} ${isMg ? 'mg/dL' : 'mmol/L'}.`);
    return measuredAt;
  }

  private async audit(userId: string, eventType: AuthEventType, request: AuthenticatedRequest, tx: Prisma.TransactionClient) {
    await tx.authAuditLog.create({
      data: {
        userId,
        eventType,
        ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
      },
    });
  }

  async createBloodPressure(userId: string, dto: CreateBloodPressureReadingDto, request: AuthenticatedRequest) {
    const measuredAt = this.validateBp(dto);
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.patientProfile.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
      const reading = await tx.bloodPressureReading.create({
        data: { patientProfileId: profile.id, systolic: dto.systolic, diastolic: dto.diastolic, heartRate: dto.heartRate ?? null, measuredAt, notes: dto.notes?.trim() || null },
        select: bpSelect,
      });
      await this.audit(userId, 'PATIENT_BP_READING_CREATED', request, tx);
      return { reading };
    });
  }

  async listBloodPressure(userId: string, query: ListHealthReadingsDto) {
    const date = this.dateRange(query);
    const where: Prisma.BloodPressureReadingWhereInput = {
      deletedAt: null,
      patientProfile: { userId },
      ...(Object.keys(date).length ? { measuredAt: date } : {}),
    };
    const [total, readings] = await this.prisma.$transaction([
      this.prisma.bloodPressureReading.count({ where }),
      this.prisma.bloodPressureReading.findMany({
        where,
        orderBy: { measuredAt: query.sort === 'ASC' ? 'asc' : 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: bpSelect,
      }),
    ]);
    return { readings, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  async getBloodPressure(userId: string, id: string) {
    const reading = await this.prisma.bloodPressureReading.findFirst({ where: { id, deletedAt: null, patientProfile: { userId } }, select: bpSelect });
    if (!reading) throw new NotFoundException('Reading not found.');
    return { reading };
  }

  async updateBloodPressure(userId: string, id: string, dto: UpdateBloodPressureReadingDto, request: AuthenticatedRequest) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.bloodPressureReading.findFirst({ where: { id, deletedAt: null, patientProfile: { userId } } });
      if (!existing) throw new NotFoundException('Reading not found.');
      const values = { systolic: dto.systolic ?? existing.systolic, diastolic: dto.diastolic ?? existing.diastolic, heartRate: dto.heartRate === undefined ? existing.heartRate : dto.heartRate, measuredAt: dto.measuredAt ?? existing.measuredAt.toISOString() };
      const measuredAt = this.validateBp(values);
      const reading = await tx.bloodPressureReading.update({ where: { id }, data: { systolic: values.systolic, diastolic: values.diastolic, heartRate: values.heartRate, measuredAt, ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}) }, select: bpSelect });
      await this.audit(userId, 'PATIENT_BP_READING_UPDATED', request, tx);
      return { reading };
    });
  }

  async deleteBloodPressure(userId: string, id: string, request: AuthenticatedRequest) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.bloodPressureReading.updateMany({ where: { id, deletedAt: null, patientProfile: { userId } }, data: { deletedAt: new Date() } });
      if (!result.count) throw new NotFoundException('Reading not found.');
      await this.audit(userId, 'PATIENT_BP_READING_DELETED', request, tx);
      return { deleted: true };
    });
  }

  async createBloodGlucose(userId: string, dto: CreateBloodGlucoseReadingDto, request: AuthenticatedRequest) {
    const measuredAt = this.validateGlucose(dto);
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.patientProfile.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
      const reading = await tx.bloodGlucoseReading.create({
        data: { patientProfileId: profile.id, glucoseValue: dto.glucoseValue, glucoseUnit: dto.glucoseUnit, measurementType: dto.measurementType, measuredAt, notes: dto.notes?.trim() || null },
        select: glucoseSelect,
      });
      await this.audit(userId, 'PATIENT_GLUCOSE_READING_CREATED', request, tx);
      return { reading: { ...reading, glucoseValue: Number(reading.glucoseValue) } };
    });
  }

  async listBloodGlucose(userId: string, query: ListHealthReadingsDto) {
    const date = this.dateRange(query);
    const where: Prisma.BloodGlucoseReadingWhereInput = {
      deletedAt: null,
      patientProfile: { userId },
      ...(Object.keys(date).length ? { measuredAt: date } : {}),
      ...(query.glucoseUnit ? { glucoseUnit: query.glucoseUnit } : {}),
      ...(query.measurementType ? { measurementType: query.measurementType } : {}),
    };
    const [total, readings] = await this.prisma.$transaction([
      this.prisma.bloodGlucoseReading.count({ where }),
      this.prisma.bloodGlucoseReading.findMany({
        where,
        orderBy: { measuredAt: query.sort === 'ASC' ? 'asc' : 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: glucoseSelect,
      }),
    ]);
    return { readings: readings.map((reading) => ({ ...reading, glucoseValue: Number(reading.glucoseValue) })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  async getBloodGlucose(userId: string, id: string) {
    const reading = await this.prisma.bloodGlucoseReading.findFirst({ where: { id, deletedAt: null, patientProfile: { userId } }, select: glucoseSelect });
    if (!reading) throw new NotFoundException('Reading not found.');
    return { reading: { ...reading, glucoseValue: Number(reading.glucoseValue) } };
  }

  async updateBloodGlucose(userId: string, id: string, dto: UpdateBloodGlucoseReadingDto, request: AuthenticatedRequest) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.bloodGlucoseReading.findFirst({ where: { id, deletedAt: null, patientProfile: { userId } } });
      if (!existing) throw new NotFoundException('Reading not found.');
      const values = { glucoseValue: dto.glucoseValue ?? Number(existing.glucoseValue), glucoseUnit: dto.glucoseUnit ?? existing.glucoseUnit, measurementType: dto.measurementType ?? existing.measurementType, measuredAt: dto.measuredAt ?? existing.measuredAt.toISOString() };
      const measuredAt = this.validateGlucose(values);
      const reading = await tx.bloodGlucoseReading.update({ where: { id }, data: { ...values, measuredAt, ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}) }, select: glucoseSelect });
      await this.audit(userId, 'PATIENT_GLUCOSE_READING_UPDATED', request, tx);
      return { reading: { ...reading, glucoseValue: Number(reading.glucoseValue) } };
    });
  }

  async deleteBloodGlucose(userId: string, id: string, request: AuthenticatedRequest) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.bloodGlucoseReading.updateMany({ where: { id, deletedAt: null, patientProfile: { userId } }, data: { deletedAt: new Date() } });
      if (!result.count) throw new NotFoundException('Reading not found.');
      await this.audit(userId, 'PATIENT_GLUCOSE_READING_DELETED', request, tx);
      return { deleted: true };
    });
  }

  async summary(userId: string, query: HealthSummaryQueryDto) {
    const range = this.dateRange(query);
    const filtered = Object.keys(range) ? range : undefined;
    const base = { deletedAt: null, patientProfile: { userId } };
    const [totalBloodPressureReadings, latestBloodPressureReading, totalGlucoseReadings, latestGlucoseReading, bloodPressureReadingsInRange, glucoseReadingsInRange] = await Promise.all([
      this.prisma.bloodPressureReading.count({ where: base }),
      this.prisma.bloodPressureReading.findFirst({ where: base, orderBy: { measuredAt: 'desc' }, select: bpSelect }),
      this.prisma.bloodGlucoseReading.count({ where: base }),
      this.prisma.bloodGlucoseReading.findFirst({ where: base, orderBy: { measuredAt: 'desc' }, select: glucoseSelect }),
      filtered ? this.prisma.bloodPressureReading.count({ where: { ...base, measuredAt: filtered } }) : this.prisma.bloodPressureReading.count({ where: base }),
      filtered ? this.prisma.bloodGlucoseReading.count({ where: { ...base, measuredAt: filtered } }) : this.prisma.bloodGlucoseReading.count({ where: base }),
    ]);
    return {
      totalBloodPressureReadings,
      latestBloodPressureReading,
      latestBloodPressureMeasuredAt: latestBloodPressureReading?.measuredAt ?? null,
      totalGlucoseReadings,
      latestGlucoseReading: latestGlucoseReading ? { ...latestGlucoseReading, glucoseValue: Number(latestGlucoseReading.glucoseValue) } : null,
      latestGlucoseMeasuredAt: latestGlucoseReading?.measuredAt ?? null,
      bloodPressureReadingsInRange,
      glucoseReadingsInRange,
    };
  }
}
