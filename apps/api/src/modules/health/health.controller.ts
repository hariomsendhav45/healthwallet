import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { DOCUMENT_STORAGE, MedicalDocumentStorage } from '../medical-documents/storage/storage-provider.interface';
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: MedicalDocumentStorage,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API, database and private storage readiness' })
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.storage.head(`${randomUUID()}.pdf`);
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok', service: 'healthvault-api', timestamp: new Date().toISOString() };
  }
}
