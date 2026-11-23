import { Controller, Get, Post, Put, Body, Param, Query, Req, Res, Header, UseGuards, UseInterceptors, StreamableFile, Injectable, ExecutionContext, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import { MedicalDocumentFileInterceptor } from '../medical-documents/upload-file.interceptor';
import { DoctorReviewDto } from './doctor-verification.dto';
import { DoctorVerificationService } from './doctor-verification.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';

@Injectable()
export class DoctorVerificationRateLimitGuard {
  constructor(private readonly limiter: SecurityRateLimiter) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.limiter.consume(`doctor-verification:user:${req.auth?.userId ?? 'anonymous'}`, 20, 15 * 60_000);
    this.limiter.consume(`doctor-verification:ip:${req.ip ?? 'unknown'}`, 60, 15 * 60_000);
    return true;
  }
}

@ApiTags('doctor verification') @ApiCookieAuth('hv_access') @Controller()
export class DoctorVerificationController {
  constructor(private readonly verification: DoctorVerificationService) {}

  @Get('doctor/verification-status') @UseGuards(AuthGuard) @Header('Cache-Control', 'private, no-store, max-age=0')
  status(@Req() req: AuthenticatedRequest) { return this.verification.status(req.auth!.userId); }

  @Get('doctor/dashboard') @UseGuards(AuthGuard) @Header('Cache-Control', 'private, no-store, max-age=0')
  dashboard(@Req() req: AuthenticatedRequest) { return this.verification.dashboard(req.auth!.userId); }

  @Post('doctor/verification/submit') @UseGuards(AuthGuard, DoctorVerificationRateLimitGuard) @Header('Cache-Control', 'private, no-store, max-age=0')
  submit(@Req() req: AuthenticatedRequest) { return this.verification.submit(req.auth!.userId); }

  @Post('doctor/verification/documents') @UseGuards(AuthGuard, DoctorVerificationRateLimitGuard) @UseInterceptors(MedicalDocumentFileInterceptor) @Header('Cache-Control', 'private, no-store, max-age=0')
  upload(@Req() req: AuthenticatedRequest) { return this.verification.upload(req.auth!.userId, (req as AuthenticatedRequest & { file?: Express.Multer.File }).file); }

  @Get('admin/doctors') @UseGuards(AuthGuard, RolesGuard, DoctorVerificationRateLimitGuard) @RequireRoles('ADMIN') @Header('Cache-Control', 'private, no-store, max-age=0')
  list(@Query('status') status?: string) {
    if (status && !['PENDING','UNDER_REVIEW','APPROVED','REJECTED','SUSPENDED'].includes(status)) throw new BadRequestException('Unsupported application status.');
    return this.verification.adminList(status);
  }

  @Get('admin/doctors/:id') @UseGuards(AuthGuard, RolesGuard, DoctorVerificationRateLimitGuard) @RequireRoles('ADMIN') @Header('Cache-Control', 'private, no-store, max-age=0')
  detail(@Param('id', new ParseUUIDPipe()) id: string) { return this.verification.adminDetail(id); }

  @Put('admin/doctors/:id/review') @UseGuards(AuthGuard, RolesGuard, DoctorVerificationRateLimitGuard) @RequireRoles('ADMIN') @Header('Cache-Control', 'private, no-store, max-age=0')
  review(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DoctorReviewDto, @Req() req: AuthenticatedRequest) { return this.verification.review(req.auth!.userId, id, dto); }

  @Get('admin/doctors/:id/documents/:documentId/content') @UseGuards(AuthGuard, RolesGuard, DoctorVerificationRateLimitGuard) @RequireRoles('ADMIN') @Header('Cache-Control', 'private, no-store, max-age=0') @Header('X-Content-Type-Options', 'nosniff') @Header('Pragma', 'no-cache')
  async document(@Param('id', new ParseUUIDPipe()) id: string, @Param('documentId', new ParseUUIDPipe()) documentId: string, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const file = await this.verification.document(req.auth!.userId, id, documentId);
    res.setHeader('Content-Type', file.mimeType); res.setHeader('Content-Disposition', 'attachment'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.body, { type: file.mimeType });
  }
}
