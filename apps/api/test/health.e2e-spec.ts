import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// Supertest uses a CommonJS export= function with ts-jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { DOCUMENT_STORAGE } from '../src/modules/medical-documents/storage/storage-provider.interface';

process.env.NODE_ENV ??= 'test';
process.env.AUTH_SECRET ??= 'healthvault-test-auth-secret-32-bytes-minimum';
process.env.SMS_PROVIDER ??= 'development-mock';

describe('GET /api/health', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([]) })
      .overrideProvider(DOCUMENT_STORAGE)
      .useValue({ head: jest.fn().mockResolvedValue(null) })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('returns service status and an ISO timestamp', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({ status: 'ok', service: 'healthvault-api' }),
    );
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });

  it('rejects unauthenticated access to the account endpoint', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('rejects unauthenticated access to patient profile resources', async () => {
    await request(app.getHttpServer()).get('/api/patient/profile').expect(401);
    await request(app.getHttpServer()).get('/api/patient/health-information').expect(401);
  });

  it('requires an authenticated patient for OCR status and AI assistant endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/patient/documents/00000000-0000-4000-8000-000000000777/ocr')
      .expect(401);
    await request(app.getHttpServer()).get('/api/patient/ai-assistant/status').expect(401);
  });

  it('rejects administrator assignment on public registration', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ countryCode: '+91', mobileNumber: '9876543210', role: 'ADMIN' })
      .expect(400);
  });

  it('rejects invalid Indian mobile numbers before creating an OTP challenge', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ countryCode: '+91', mobileNumber: '1234567890' })
      .expect(400);
  });
});
