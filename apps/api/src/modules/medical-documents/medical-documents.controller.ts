import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateMedicalDocumentDto,
  ListMedicalDocumentsDto,
  UpdateMedicalDocumentDto,
} from './dto/medical-document.dto';
import { MedicalDocumentsService } from './medical-documents.service';
import { MedicalDocumentUploadRateLimitGuard } from './upload-rate-limit.guard';
import { MedicalDocumentFileInterceptor } from './upload-file.interceptor';

class OcrValueDto {
  @IsString() @MaxLength(90) testName!: string;
  @IsString() @MaxLength(80) value!: string;
  @IsOptional() @IsString() @MaxLength(24) unit!: string | null;
  @IsOptional() @IsString() @MaxLength(120) referenceRange!: string | null;
  @IsOptional() @IsString() @MaxLength(32) abnormalFlag!: string | null;
  @IsIn(['HIGH', 'REVIEW_REQUIRED']) confidence!: 'HIGH' | 'REVIEW_REQUIRED';
  @IsString() @MaxLength(500) sourceLine!: string;
}
class OcrMetadataDto {
  @IsOptional() @IsString() @MaxLength(240) patientName!: string | null;
  @IsOptional() @IsString() @MaxLength(80) reportDate!: string | null;
  @IsOptional() @IsString() @MaxLength(240) laboratoryName!: string | null;
  @IsOptional() @IsString() @MaxLength(4000) doctorComments!: string | null;
}
class OcrReviewDto {
  @IsString() @MaxLength(200000) reviewedText!: string;
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => OcrValueDto)
  reviewedFields!: OcrValueDto[];
  @ValidateNested() @Type(() => OcrMetadataDto) reviewedMetadata!: OcrMetadataDto;
}

@ApiTags('medical documents')
@ApiCookieAuth('hv_access')
@Controller('patient/documents')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('PATIENT')
export class MedicalDocumentsController {
  constructor(private readonly documents: MedicalDocumentsService) {}

  @Post('upload')
  @UseGuards(MedicalDocumentUploadRateLimitGuard)
  @UseInterceptors(MedicalDocumentFileInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['category', 'file'],
      properties: {
        title: { type: 'string', maxLength: 180 },
        category: {
          type: 'string',
          enum: [
            'BLOOD_TEST',
            'URINE_TEST',
            'RADIOLOGY',
            'X_RAY',
            'MRI',
            'CT_SCAN',
            'ULTRASOUND',
            'PRESCRIPTION',
            'DISCHARGE_SUMMARY',
            'CONSULTATION_REPORT',
            'ECG',
            'OTHER',
          ],
        },
        documentDate: { type: 'string', format: 'date' },
        description: { type: 'string', maxLength: 2000 },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Validate, scan and securely store a patient-owned medical document' })
  upload(
    @Body() dto: CreateMedicalDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.upload(request.auth!.userId, dto, file, request);
  }

  @Get()
  @ApiOperation({
    summary: 'List the authenticated patient’s documents with filters and pagination',
  })
  list(@Query() query: ListMedicalDocumentsDto, @Req() request: AuthenticatedRequest) {
    return this.documents.list(request.auth!.userId, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Return metadata for one of the authenticated patient’s documents' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.get(request.auth!.userId, id, request);
  }

  @Get(':id/content')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  @ApiOperation({ summary: 'Authorize and stream a private document preview or download' })
  async content(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('download') download: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { body, document } = await this.documents.content(request.auth!.userId, id, request);
    const fallbackName = document.originalFileName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(document.originalFileName).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const disposition = download === 'true' ? 'attachment' : 'inline';
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    );
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(body, { type: document.mimeType });
  }

  @Get(':id/ocr')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Return the authenticated patient-owned document OCR status' })
  ocrStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.ocrStatus(request.auth!.userId, id, request);
  }

  @Post(':id/ocr/retry')
  @UseGuards(MedicalDocumentUploadRateLimitGuard)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({ summary: 'Retry OCR when a supported local OCR provider is configured' })
  retryOcr(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.retryOcr(request.auth!.userId, id, request);
  }

  @Patch(':id/ocr/review')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  reviewOcr(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: OcrReviewDto, @Req() request: AuthenticatedRequest) {
    return this.documents.reviewOcr(request.auth!.userId, id, body.reviewedText, body.reviewedFields, body.reviewedMetadata, request);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update metadata for an owned medical document' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMedicalDocumentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.documents.update(request.auth!.userId, id, dto, request);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete an owned medical document and remove its private object' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.remove(request.auth!.userId, id, request);
  }
}
