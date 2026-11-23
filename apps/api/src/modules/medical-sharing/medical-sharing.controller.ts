import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { MedicalDocumentsService } from '../medical-documents/medical-documents.service';
import {
  CreateMedicalShareSessionDto,
  ScanMedicalShareDto,
  UpdateDoctorProfileDto,
} from './dto/medical-sharing.dto';
import { MedicalSharingService } from './medical-sharing.service';

@ApiTags('patient medical sharing')
@ApiCookieAuth('hv_access')
@Controller('patient/sharing')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class PatientMedicalSharingController {
  constructor(private readonly sharing: MedicalSharingService) {}

  @Post('sessions')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({
    summary:
      'Create a short-lived patient-controlled sharing session; raw QR token is returned once',
  })
  createSession(@Body() dto: CreateMedicalShareSessionDto, @Req() request: AuthenticatedRequest) {
    return this.sharing.createSession(request.auth!.userId, dto, request);
  }

  @Get('sessions')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  listSessions(@Req() request: AuthenticatedRequest) {
    return this.sharing.listSessions(request.auth!.userId);
  }

  @Get('sessions/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  getSession(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.sharing.getSession(request.auth!.userId, id);
  }

  @Post('sessions/:id/revoke')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sharing.revokeSession(request.auth!.userId, id, request);
  }

  @Get('requests')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  requests(@Req() request: AuthenticatedRequest) {
    return this.sharing.patientRequests(request.auth!.userId);
  }

  @Post('requests/:id/approve')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  approve(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.sharing.reviewRequest(request.auth!.userId, id, 'approve', request);
  }

  @Post('requests/:id/reject')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  reject(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.sharing.reviewRequest(request.auth!.userId, id, 'reject', request);
  }

  @Get('history')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  history(@Req() request: AuthenticatedRequest) {
    return this.sharing.history(request.auth!.userId);
  }
}

@Injectable()
export class DoctorSharingRateLimitGuard {
  constructor(private readonly limiter: SecurityRateLimiter) {}
  canActivate(context: import('@nestjs/common').ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.limiter.consume(
      `medical-share:doctor:${request.auth?.userId ?? 'anonymous'}`,
      60,
      5 * 60_000,
    );
    this.limiter.consume(`medical-share:ip:${request.ip ?? 'unknown'}`, 120, 5 * 60_000);
    return true;
  }
}

@ApiTags('doctor medical sharing')
@ApiCookieAuth('hv_access')
@Controller('doctor')
export class DoctorMedicalSharingController {
  constructor(
    private readonly sharing: MedicalSharingService,
    private readonly documents: MedicalDocumentsService,
  ) {}

  @Put('profile')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({
    summary:
      'Save self-reported doctor display and registration details; this does not verify credentials',
  })
  async updateProfile(@Body() dto: UpdateDoctorProfileDto, @Req() request: AuthenticatedRequest) {
    if (request.auth!.role !== 'DOCTOR') throw new ForbiddenException('Doctor account required.');
    return this.sharing.updateDoctorProfile(request.auth!.userId, dto);
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.sharing.getDoctorProfile(request.auth!.userId);
  }

  @Post('sharing/scan')
  @UseGuards(AuthGuard, RolesGuard, DoctorSharingRateLimitGuard)
  @RequireRoles('DOCTOR')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({
    summary: 'Validate an opaque QR reference and create a consent request; does not grant access',
  })
  scan(@Body() dto: ScanMedicalShareDto, @Req() request: AuthenticatedRequest) {
    return this.sharing.scan(request.auth!.userId, dto.token, request);
  }

  @Get('sharing/requests')
  @UseGuards(AuthGuard, RolesGuard, DoctorSharingRateLimitGuard)
  @RequireRoles('DOCTOR')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  requests(@Req() request: AuthenticatedRequest) {
    return this.sharing.doctorRequests(request.auth!.userId);
  }

  @Get('patient-access')
  @UseGuards(AuthGuard, RolesGuard, DoctorSharingRateLimitGuard)
  @RequireRoles('DOCTOR')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  grants(@Req() request: AuthenticatedRequest) {
    return this.sharing.doctorGrants(request.auth!.userId);
  }

  @Get('patient-access/:id')
  @UseGuards(AuthGuard, RolesGuard, DoctorSharingRateLimitGuard)
  @RequireRoles('DOCTOR')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  access(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.sharing.doctorPatientAccess(request.auth!.userId, id, request);
  }

  @Get('patient-access/:id/documents/:documentId/content')
  @UseGuards(AuthGuard, RolesGuard, DoctorSharingRateLimitGuard)
  @RequireRoles('DOCTOR')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Pragma', 'no-cache')
  async sharedDocument(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const scope = await this.sharing.authorizeSharedDocument(
      request.auth!.userId,
      id,
      documentId,
      request,
    );
    const { body, document } = await this.documents.sharedContent(
      scope.patientProfileId,
      documentId,
    );
    await this.sharing.recordSharedDocumentDownload(request.auth!.userId, scope, request);
    const filename = document.originalFileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(body, { type: document.mimeType });
  }

  @Post('patient-access/:id/revoke')
  @UseGuards(AuthGuard, RolesGuard, DoctorSharingRateLimitGuard)
  @RequireRoles('DOCTOR')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  revoke(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.sharing.revokeGrantByDoctor(request.auth!.userId, id, request);
  }
}
