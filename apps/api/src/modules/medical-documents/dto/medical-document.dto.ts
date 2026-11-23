import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MedicalDocumentCategory } from '../../../generated/prisma';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class CreateMedicalDocumentDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsEnum(MedicalDocumentCategory)
  category!: MedicalDocumentCategory;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateMedicalDocumentDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsEnum(MedicalDocumentCategory)
  category?: MedicalDocumentCategory;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsDateString()
  documentDate?: string | null;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class ListMedicalDocumentsDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsEnum(MedicalDocumentCategory) category?: MedicalDocumentCategory;
  @IsOptional() @IsIn(['application/pdf', 'image/jpeg', 'image/png']) mimeType?: string;
  @IsOptional() @IsDateString() documentDateFrom?: string;
  @IsOptional() @IsDateString() documentDateTo?: string;
  @IsOptional() @IsDateString() uploadedAfter?: string;
  @IsOptional() @IsDateString() uploadedBefore?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
