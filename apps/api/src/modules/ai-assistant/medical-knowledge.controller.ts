import { Body, Controller, Get, Header, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard, AuthenticatedRequest } from '../auth/guards/auth.guard';
import { RequireRoles, RolesGuard } from '../auth/guards/roles.guard';
import { MedicalKnowledgeService } from './medical-knowledge.service';

class IngestKnowledgeSourceDto {
  @IsString() @MinLength(3) @MaxLength(240) title!: string;
  @IsString() @MinLength(2) @MaxLength(160) sourceName!: string;
  @IsString() @MinLength(10) @MaxLength(1000) sourceUrl!: string;
  @IsString() @MinLength(3) @MaxLength(500) license!: string;
  @IsString() @MinLength(1) @MaxLength(80) version!: string;
  @IsString() @MinLength(200) @MaxLength(100000) content!: string;
}

@Controller('admin/medical-knowledge')
@UseGuards(AuthGuard, RolesGuard)
@RequireRoles('ADMIN')
export class MedicalKnowledgeController {
  constructor(private readonly knowledge: MedicalKnowledgeService) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  status() { return this.knowledge.status(); }

  @Post('sources')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  ingest(@Body() body: IngestKnowledgeSourceDto, @Req() req: AuthenticatedRequest) {
    return this.knowledge.ingest(req.auth!.userId, body);
  }
}
