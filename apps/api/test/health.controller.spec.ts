import { HealthController } from '../src/modules/health/health.controller';
import { PrismaService } from '../src/database/prisma.service';
import { MedicalDocumentStorage } from '../src/modules/medical-documents/storage/storage-provider.interface';

describe('HealthController', () => {
  it('checks database and private object storage without exposing details', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const storage = { head: jest.fn().mockResolvedValue(null) };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      storage as unknown as MedicalDocumentStorage,
    );

    await expect(controller.check()).resolves.toMatchObject({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(storage.head).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}\.pdf$/));
  });

  it('returns a generic unavailable response when a dependency fails', async () => {
    const controller = new HealthController(
      { $queryRaw: jest.fn().mockRejectedValue(new Error('private database detail')) } as unknown as PrismaService,
      { head: jest.fn() } as unknown as MedicalDocumentStorage,
    );

    await expect(controller.check()).rejects.toMatchObject({
      response: { status: 'unavailable' },
    });
  });
});
