import { ConflictException, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';

type KnowledgeSourceInput = { title: string; sourceName: string; sourceUrl: string; license: string; version: string; content: string };
type RankedChunk = { id: string; content: string; embedding: Prisma.JsonValue; source: { id: string; title: string; sourceName: string; sourceUrl: string; version: string } };
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_CHUNKS = 2000;
const ALLOWED_HOSTS = new Set(['who.int', 'www.who.int', 'medlineplus.gov', 'www.medlineplus.gov', 'nih.gov', 'www.nih.gov', 'ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov']);

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!, b = right[i]!;
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function chunkText(text: string) {
  const normalized = text.replace(/\r/g, '').trim();
  const chunks: string[] = [];
  const size = 1200, overlap = 160;
  for (let start = 0; start < normalized.length && chunks.length < 50; start += size - overlap) {
    const end = Math.min(start + size, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
  }
  return chunks;
}

@Injectable()
export class MedicalKnowledgeService {
  private readonly client?: OpenAI;
  private readonly model: string;
  constructor(private readonly prisma: PrismaService, config: ConfigService, private readonly limiter: SecurityRateLimiter) {
    const key = config.get<string>('OPENAI_API_KEY')?.trim();
    this.model = config.get<string>('AI_ASSISTANT_EMBEDDING_MODEL', EMBEDDING_MODEL);
    if (key) this.client = new OpenAI({ apiKey: key, timeout: 20_000, maxRetries: 1 });
  }

  async ingest(adminId: string, input: KnowledgeSourceInput) {
    this.limiter.consume(`knowledge:ingest:${adminId}`, 5, 60 * 60_000);
    if (!this.client) throw new ServiceUnavailableException('Knowledge ingestion is disabled until the backend embedding provider is configured.');
    let url: URL;
    try { url = new URL(input.sourceUrl); } catch { throw new UnprocessableEntityException('Use a valid source URL.'); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new UnprocessableEntityException('Only HTTPS sources from WHO, MedlinePlus, NIH or NCBI domains are accepted.');
    const version = input.version.trim();
    if (await this.prisma.medicalKnowledgeSource.findUnique({ where: { sourceUrl_version: { sourceUrl: url.toString(), version } }, select: { id: true } }))
      throw new ConflictException('That source version has already been ingested.');
    if (input.content.length > 100_000) throw new UnprocessableEntityException('Knowledge source text exceeds 100,000 characters.');
    const chunks = chunkText(input.content);
    if (chunks.length === 0 || input.content.trim().length < 200) throw new UnprocessableEntityException('Provide at least 200 characters of reviewed source text.');
    if (chunks.length >= 50 && chunks[chunks.length - 1]!.length < 200) chunks.pop();
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const vectors: number[][] = [];
    try {
      for (let offset = 0; offset < chunks.length; offset += 32) {
        const response = await this.client.embeddings.create({ model: this.model, input: chunks.slice(offset, offset + 32) });
        for (const item of response.data.sort((a, b) => a.index - b.index)) vectors.push(item.embedding);
      }
    } catch {
      throw new ServiceUnavailableException('Embedding provider failed; the source was not stored.');
    }
    if (vectors.length !== chunks.length) throw new ServiceUnavailableException('Embedding provider returned incomplete results; the source was not stored.');
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.medicalKnowledgeSource.updateMany({ where: { sourceUrl: url.toString(), active: true }, data: { active: false } });
        const source = await tx.medicalKnowledgeSource.create({ data: { title: input.title.trim(), sourceName: input.sourceName.trim(), sourceUrl: url.toString(), license: input.license.trim(), version, embeddingModel: this.model, contentHash, importedById: adminId,
          chunks: { create: chunks.map((content, ordinal) => ({ ordinal, content, embedding: vectors[ordinal] as Prisma.InputJsonValue })) } }, select: { id: true, title: true, sourceName: true, sourceUrl: true, license: true, version: true, contentHash: true, createdAt: true, _count: { select: { chunks: true } } } });
        await tx.authAuditLog.create({ data: { userId: adminId, eventType: 'MEDICAL_KNOWLEDGE_SOURCE_INGESTED' } });
        return { source };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('That source version has already been ingested.');
      throw error;
    }
  }

  async retrieve(question: string) {
    if (!this.client) return [];
    const chunks = await this.prisma.medicalKnowledgeChunk.findMany({ where: { source: { active: true, embeddingModel: this.model } }, take: MAX_CHUNKS, orderBy: [{ sourceId: 'asc' }, { ordinal: 'asc' }], select: { id: true, content: true, embedding: true, source: { select: { id: true, title: true, sourceName: true, sourceUrl: true, version: true } } } }) as RankedChunk[];
    if (!chunks.length) return [];
    try {
      const result = await this.client.embeddings.create({ model: this.model, input: question.slice(0, 2000) });
      const queryVector = result.data[0]?.embedding;
      if (!queryVector) return [];
      return chunks.map(chunk => {
        const vector = Array.isArray(chunk.embedding) ? chunk.embedding.filter((v): v is number => typeof v === 'number') : [];
        return { chunk, score: cosineSimilarity(queryVector, vector) };
      }).filter(item => item.score >= 0.28).sort((a, b) => b.score - a.score).slice(0, 4)
        .map(({ chunk, score }) => ({ content: chunk.content, score: Number(score.toFixed(3)), source: chunk.source }));
    } catch {
      throw new ServiceUnavailableException('Medical knowledge retrieval is temporarily unavailable.');
    }
  }

  async status() {
    const [sources, chunks] = await this.prisma.$transaction([
      this.prisma.medicalKnowledgeSource.count({ where: { active: true } }),
      this.prisma.medicalKnowledgeChunk.count({ where: { source: { active: true } } }),
    ]);
    return { embeddingProviderConfigured: Boolean(this.client), activeSources: sources, indexedChunks: chunks, model: this.client ? this.model : null };
  }
}
