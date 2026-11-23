import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MedicalSharePermissionType } from '../../../generated/prisma';
import { Transform } from 'class-transformer';

export class CreateMedicalShareSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsEnum(MedicalSharePermissionType, { each: true })
  permissionTypes!: MedicalSharePermissionType[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  medicalDocumentIds?: string[];

  @IsIn([5, 15, 30, 60])
  durationMinutes!: number;
}

export class ScanMedicalShareDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateDoctorProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  fullName?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  professionalRegistrationNo?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  registrationAuthority?: string | null;

  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254)
  email?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160)
  qualification?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160)
  specialization?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(180)
  clinicName?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  clinicAddress?: string | null;
}
