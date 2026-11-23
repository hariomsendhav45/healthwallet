import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class DoctorReviewDto {
  @Transform(trim) @IsString() @IsIn(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  status!: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}
