import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const mobilePattern = '^[6-9][0-9]{9}$';

export class PhoneDto {
  @ApiProperty({ example: '+91' })
  @IsString()
  @IsIn(['+91'])
  countryCode!: string;

  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(new RegExp(mobilePattern), { message: 'Enter a valid Indian mobile number.' })
  mobileNumber!: string;
}

export class RegisterDto extends PhoneDto {
  @ApiPropertyOptional({ enum: ['PATIENT', 'DOCTOR'], default: 'PATIENT' })
  @IsOptional()
  @IsIn(['PATIENT', 'DOCTOR'])
  role?: 'PATIENT' | 'DOCTOR';
}

export class SendOtpDto extends PhoneDto {
  @ApiProperty({ enum: ['LOGIN', 'RECOVERY'] })
  @IsIn(['LOGIN', 'RECOVERY'])
  purpose!: 'LOGIN' | 'RECOVERY';
}

export class VerifyOtpDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @ApiPropertyOptional({ enum: ['WEB'], default: 'WEB' })
  @IsOptional()
  @IsIn(['WEB'])
  platform?: 'WEB';

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceName?: string;
}

export class DevPasswordLoginDto extends PhoneDto {
  @ApiProperty({ minLength: 16, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  password!: string;
}

export class RevokeSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sessionId!: string;
}
