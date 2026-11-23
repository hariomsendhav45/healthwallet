import { BadRequestException, Body, Controller, Delete, Get, Header, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import { PatientIntelligenceService } from './patient-intelligence.service';
import { AiAssistantService } from './ai-assistant.service';
import { PrismaService } from '../../database/prisma.service';
import { PredictiveAnalyticsService } from './predictive-analytics.service';

class CompareReportsDto {
  @IsUUID() firstDocumentId!: string;
  @IsUUID() secondDocumentId!: string;
}

@Controller('patient/health-intelligence')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class PatientIntelligenceController {
  constructor(private readonly intelligence: PatientIntelligenceService, private readonly analytics: PredictiveAnalyticsService) {}

  @Get('overview')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  overview(@Req() req: AuthenticatedRequest) { return this.intelligence.overview(req.auth!.userId); }

  @Post('compare')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  compare(@Body() body: CompareReportsDto, @Req() req: AuthenticatedRequest) { return this.intelligence.compare(req.auth!.userId, body.firstDocumentId, body.secondDocumentId); }

  @Get('risk-trends')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  riskTrends(@Req() req: AuthenticatedRequest) { return this.analytics.riskTrends(req.auth!.userId); }
}

class CreateReminderDto {
  @IsString() @MinLength(1) @MaxLength(140)
  title!: string;
  @IsIn(['APPOINTMENT', 'PATIENT_FOLLOW_UP', 'REPORT_REVIEW', 'MEASUREMENT'])
  type!: 'APPOINTMENT' | 'PATIENT_FOLLOW_UP' | 'REPORT_REVIEW' | 'MEASUREMENT';
  @IsISO8601()
  dueAt!: string;
}
class UpdateReminderDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(140)
  title?: string;
  @IsOptional() @IsISO8601()
  dueAt?: string;
  @IsOptional() @IsBoolean()
  completed?: boolean;
  @IsOptional() @IsBoolean()
  disabled?: boolean;
}
class FeedbackDto {
  @IsUUID() responseId!: string;
  @IsIn(['HELPFUL', 'NOT_HELPFUL']) rating!: 'HELPFUL' | 'NOT_HELPFUL';
  @IsIn(['INCORRECT_INFORMATION', 'MISSING_CONTEXT', 'REPORT_INTERPRETATION', 'LANGUAGE_QUALITY', 'OTHER']) category?: 'INCORRECT_INFORMATION' | 'MISSING_CONTEXT' | 'REPORT_INTERPRETATION' | 'LANGUAGE_QUALITY' | 'OTHER';
}

@Controller('patient/reminders')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class PatientRemindersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async list(@Req() req: AuthenticatedRequest) {
    const reminders = await this.prisma.patientReminder.findMany({ where: { userId: req.auth!.userId, disabledAt: null, completedAt: null }, orderBy: { dueAt: 'asc' }, take: 100 });
    return { reminders };
  }

  @Post()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async create(@Body() body: CreateReminderDto, @Req() req: AuthenticatedRequest) {
    const dueAt = new Date(body.dueAt);
    if (!Number.isFinite(dueAt.getTime())) throw new BadRequestException('Enter a valid reminder date.');
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Reminder title is required.');
    const reminder = await this.prisma.patientReminder.create({ data: { userId: req.auth!.userId, title, type: body.type, dueAt } });
    return { reminder };
  }

  @Patch(':id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateReminderDto, @Req() req: AuthenticatedRequest) {
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) { const title = body.title.trim(); if (!title) throw new BadRequestException('Reminder title is required.'); data.title = title; }
    if (body.dueAt !== undefined) { const dueAt = new Date(body.dueAt); if (!Number.isFinite(dueAt.getTime())) throw new BadRequestException('Enter a valid reminder date.'); data.dueAt = dueAt; }
    if (Object.keys(data).length === 0) throw new BadRequestException('Provide a reminder change.');
    if (body.completed !== undefined) data.completedAt = body.completed ? new Date() : null;
    if (body.disabled !== undefined) data.disabledAt = body.disabled ? new Date() : null;
    const changed = await this.prisma.patientReminder.updateMany({ where: { id, userId: req.auth!.userId }, data });
    if (!changed.count) throw new NotFoundException('Reminder not found.');
    return { reminder: await this.prisma.patientReminder.findFirst({ where: { id, userId: req.auth!.userId } }) };
  }

  @Delete(':id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    const removed = await this.prisma.patientReminder.deleteMany({ where: { id, userId: req.auth!.userId } });
    if (!removed.count) throw new NotFoundException('Reminder not found.');
    return { deleted: true };
  }
}

@Controller('patient/ai-assistant')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class AiFeedbackController {
  constructor(private readonly assistant: AiAssistantService) {}

  @Post('feedback')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async submit(@Body() body: FeedbackDto, @Req() req: AuthenticatedRequest) {
    return this.assistant.submitFeedback(req.auth!.userId, body.responseId, body.rating, body.category);
  }
}
