import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MedicalSharePermissionType, PatientGender } from '../../../generated/prisma';

export enum FamilyRelationshipDto {
  PARENT = 'PARENT',
  SPOUSE = 'SPOUSE',
  CHILD = 'CHILD',
  SIBLING = 'SIBLING',
  OTHER = 'OTHER',
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFamilyMemberDto {
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @IsEnum(FamilyRelationshipDto)
  relationship!: FamilyRelationshipDto;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{7,14}$/)
  contactNumber?: string | null;

  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender | null;
}

export class UpdateFamilyMemberDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsEnum(FamilyRelationshipDto)
  relationship?: FamilyRelationshipDto;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{7,14}$/)
  contactNumber?: string | null;

  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender | null;
}

export class FamilyInvitationTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class CreateFamilyConsentDto {
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

  @IsInt()
  @IsIn([1, 7, 30])
  durationDays!: number;
}
