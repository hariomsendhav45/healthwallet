import { Body, Controller, Get, Header, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import { PatientProfileRateLimitGuard } from '../patient-profile/patient-profile-rate-limit.guard';
import { AiAssistantService } from './ai-assistant.service';

class AssistantQuestionDto {
  @IsString() @MinLength(1) @MaxLength(2000) question!: string;
  @IsIn(['en', 'hi']) language!: 'en' | 'hi';
}

@Controller('patient/ai-assistant')
@UseGuards(AuthGuard, RolesGuard, PatientProfileRateLimitGuard)
@RequireRoles('PATIENT')
export class AiAssistantController {
  constructor(private readonly assistant: AiAssistantService) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  status(@Req() req: AuthenticatedRequest) { return this.assistant.status(req.auth!.userId); }

  @Post('consent')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  consent(@Req() req: AuthenticatedRequest) { return this.assistant.grantConsent(req.auth!.userId); }

  @Post('withdraw')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  withdraw(@Req() req: AuthenticatedRequest) { return this.assistant.withdrawConsent(req.auth!.userId); }

  @Post('query')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  query(@Body() body: AssistantQuestionDto, @Req() req: AuthenticatedRequest) {
    return this.assistant.query(req.auth!.userId, body.question, body.language);
  }
}
