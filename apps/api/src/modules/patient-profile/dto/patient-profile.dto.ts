import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  BloodGroup,
  DiabetesStatus,
  HypertensionStatus,
  PatientGender,
} from '../../../generated/prisma';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdatePatientProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  fullName?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender | null;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  addressLine1?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  addressLine2?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  state?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[1-9]\d{5}$/)
  postalCode?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(?:\+91)?[6-9]\d{9}$/)
  emergencyContactPhone?: string | null;
}

export class UpdatePatientHealthInformationDto {
  @IsOptional()
  @IsEnum(DiabetesStatus)
  diabetesStatus?: DiabetesStatus;

  @IsOptional()
  @IsEnum(HypertensionStatus)
  hypertensionStatus?: HypertensionStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  allergies?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  existingMedicalConditions?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  currentMedications?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  additionalNotes?: string;
}
