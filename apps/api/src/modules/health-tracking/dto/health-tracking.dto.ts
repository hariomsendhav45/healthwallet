import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { GlucoseMeasurementType, GlucoseUnit } from '../../../generated/prisma';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const sortOrders = { ASC: 'ASC', DESC: 'DESC' } as const;

export class CreateBloodPressureReadingDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  systolic!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  diastolic!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  heartRate?: number | null;

  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/, { message: 'Measurement date and time must include a time and timezone.' })
  measuredAt!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateBloodPressureReadingDto extends PartialType(CreateBloodPressureReadingDto) {}

export class CreateBloodGlucoseReadingDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(2000)
  glucoseValue!: number;

  @IsEnum(GlucoseUnit)
  glucoseUnit!: GlucoseUnit;

  @IsEnum(GlucoseMeasurementType)
  measurementType!: GlucoseMeasurementType;

  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/, { message: 'Measurement date and time must include a time and timezone.' })
  measuredAt!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateBloodGlucoseReadingDto extends PartialType(CreateBloodGlucoseReadingDto) {}

export class ListHealthReadingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endDate?: string;

  @IsOptional()
  @IsEnum(sortOrders)
  sort: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsEnum(GlucoseUnit)
  glucoseUnit?: GlucoseUnit;

  @IsOptional()
  @IsEnum(GlucoseMeasurementType)
  measurementType?: GlucoseMeasurementType;
}

export class HealthSummaryQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endDate?: string;
}
