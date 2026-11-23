import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';
import { SecurityRateLimiter } from '../src/modules/auth/security-rate-limiter.service';
import { MedicalKnowledgeService } from '../src/modules/ai-assistant/medical-knowledge.service';

const mockEmbedding = jest.fn();
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ embeddings: { create: (...args: unknown[]) => mockEmbedding(...args) } })) }));

describe('MedicalKnowledgeService retrieval', () => {
  const findMany = jest.fn();
  const prisma = { medicalKnowledgeChunk: { findMany } } as unknown as PrismaService;
  const config = { get: (key: string) => key === 'OPENAI_API_KEY' ? 'synthetic-test-key' : undefined } as ConfigService;
  const limiter = { consume: jest.fn() } as unknown as SecurityRateLimiter;
  let service: MedicalKnowledgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MedicalKnowledgeService(prisma, config, limiter);
    mockEmbedding.mockResolvedValue({ data: [{ embedding: [1, 0] }] });
  });

  it('retrieves relevant curated chunks and preserves the source reference', async () => {
    findMany.mockResolvedValue([
      { id: 'relevant', content: 'Synthetic reviewed explanation about blood pressure.', embedding: [1, 0], source: { id: 'source-1', title: 'Synthetic guide', sourceName: 'MedlinePlus', sourceUrl: 'https://medlineplus.gov/example', version: '2026-01' } },
      { id: 'irrelevant', content: 'Unrelated synthetic kidney information.', embedding: [-1, 0], source: { id: 'source-2', title: 'Another guide', sourceName: 'NIH', sourceUrl: 'https://nih.gov/example', version: '2026-01' } },
    ]);
    const matches = await service.retrieve('blood pressure');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(expect.objectContaining({ content: expect.stringContaining('blood pressure'), source: expect.objectContaining({ sourceName: 'MedlinePlus', version: '2026-01' }) }));
  });

  it('does not retrieve arbitrary external source URLs during ingestion', async () => {
    await expect(service.ingest('admin-1', { title: 'Synthetic', sourceName: 'Unknown', sourceUrl: 'https://example.com/medical', license: 'test license', version: '1', content: 'x'.repeat(250) }))
      .rejects.toThrow('Only HTTPS sources from WHO, MedlinePlus, NIH or NCBI domains are accepted.');
  });
});
