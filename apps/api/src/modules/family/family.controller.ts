import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import type { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import { MedicalDocumentsService } from '../medical-documents/medical-documents.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import {
  CreateFamilyConsentDto,
  CreateFamilyMemberDto,
  FamilyInvitationTokenDto,
  UpdateFamilyMemberDto,
} from './dto/family.dto';
import { FamilyService } from './family.service';

@Injectable()
export class NoStoreResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    return next.handle();
  }
}

@Injectable()
export class FamilyInvitationRateLimitGuard {
  constructor(private readonly limiter: SecurityRateLimiter) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.limiter.consume(`family-invite:user:${request.auth?.userId ?? 'anonymous'}`, 5, 60 * 60_000);
    this.limiter.consume(`family-invite:ip:${request.ip ?? 'unknown'}`, 20, 60 * 60_000);
    return true;
  }
}

@Injectable()
export class FamilyInvitationClaimRateLimitGuard {
  constructor(private readonly limiter: SecurityRateLimiter) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.limiter.consume(`family-claim:user:${request.auth?.userId ?? 'anonymous'}`, 20, 60 * 60_000);
    this.limiter.consume(`family-claim:ip:${request.ip ?? 'unknown'}`, 60, 60 * 60_000);
    return true;
  }
}

@ApiTags('patient family management')
@ApiCookieAuth('hv_access')
@Controller('patient/family')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
@UseInterceptors(NoStoreResponseInterceptor)
export class FamilyController {
  constructor(
    private readonly family: FamilyService,
    private readonly documents: MedicalDocumentsService,
  ) {}

  @Get('members')
  @ApiOperation({ summary: 'List relationship records owned by the authenticated patient' })
  list(@Req() request: AuthenticatedRequest) {
    return this.family.listMembers(request.auth!.userId);
  }

  @Post('members')
  @ApiOperation({ summary: 'Create a family relationship record without granting record access' })
  create(@Body() dto: CreateFamilyMemberDto, @Req() request: AuthenticatedRequest) {
    return this.family.createMember(request.auth!.userId, dto, request);
  }

  @Get('members/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.family.getMember(request.auth!.userId, id, request);
  }

  @Put('members/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFamilyMemberDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.family.updateMember(request.auth!.userId, id, dto, request);
  }

  @Delete('members/:id')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.family.removeMember(request.auth!.userId, id, request);
  }

  @Post('members/:id/invitations')
  @UseGuards(FamilyInvitationRateLimitGuard)
  @ApiOperation({
    summary: 'Create or resend a one-time invitation; raw token is returned only once for a copy link',
  })
  invite(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.family.createInvitation(request.auth!.userId, id, request);
  }

  @Get('invitations')
  invitations(@Req() request: AuthenticatedRequest) {
    return this.family.listInvitations(request.auth!.userId);
  }

  @Post('invitations/accept')
  @UseGuards(FamilyInvitationClaimRateLimitGuard)
  @ApiOperation({ summary: 'Accept an invitation with the invited verified phone account' })
  accept(@Body() dto: FamilyInvitationTokenDto, @Req() request: AuthenticatedRequest) {
    return this.family.acceptInvitation(request.auth!.userId, dto.token, request);
  }

  @Post('invitations/reject')
  @UseGuards(FamilyInvitationClaimRateLimitGuard)
  reject(@Body() dto: FamilyInvitationTokenDto, @Req() request: AuthenticatedRequest) {
    return this.family.rejectInvitation(request.auth!.userId, dto.token, request);
  }

  @Post('members/:id/consent')
  @ApiOperation({ summary: 'The accepted member explicitly grants limited access to their own records' })
  consent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateFamilyConsentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.family.grantConsent(request.auth!.userId, id, dto, request);
  }

  @Post('members/:id/consent/revoke')
  revokeConsent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.family.revokeConsent(request.auth!.userId, id, request);
  }

  @Get('members/:id/records')
  records(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.family.familyRecords(request.auth!.userId, id, request);
  }

  @Get('members/:id/documents/:documentId/content')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Stream one document explicitly selected by the actual patient' })
  async documentContent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.family.familyDocument(request.auth!.userId, id, documentId, request);
    const { body, document } = await this.documents.sharedContent(result.patientProfileId, documentId);
    if (document.id !== result.document.id) throw new ForbiddenException('Family document is unavailable.');
    const fallbackName = document.originalFileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(document.originalFileName).replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`);
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(body, { type: document.mimeType });
  }
}

