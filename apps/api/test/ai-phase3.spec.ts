import { NotFoundException } from '@nestjs/common';
import { PatientIntelligenceService } from '../src/modules/ai-assistant/patient-intelligence.service';
import { PrismaService } from '../src/database/prisma.service';
import { SecurityRateLimiter } from '../src/modules/auth/security-rate-limiter.service';
import { AI_PROMPT_VERSION, enforceLocalSafety } from '../src/modules/ai-assistant/safety-policy';
import { AiAssistantService } from '../src/modules/ai-assistant/ai-assistant.service';
import { PatientRemindersController } from '../src/modules/ai-assistant/patient-intelligence.controller';

describe('Phase 3 medical safety', () => {
  it('returns local English urgent guidance with no record sources', () => {
    const result = enforceLocalSafety('I have severe chest pain', 'en');
    expect(result?.kind).toBe('urgent');
    expect(result?.sources).toEqual([]);
    expect(result?.answer).toContain('emergency department');
  });
  it('returns Hindi urgent guidance', () => {
    const result = enforceLocalSafety('मुझे सीने में दर्द हो रहा है', 'hi');
    expect(result?.kind).toBe('urgent');
    expect(result?.answer).toContain('आपातकालीन');
  });
  it.each(['diagnose me', 'should I change my dose?', 'दवा बंद कर दूँ?'])('refuses diagnosis and medication requests: %s', question => {
    expect(enforceLocalSafety(question, question.includes('दवा') ? 'hi' : 'en')?.kind).toBe('safety-refusal');
  });
  it('versions prompt policy and does not block ordinary questions', () => {
    expect(AI_PROMPT_VERSION).toMatch(/^patient-education-/);
    expect(enforceLocalSafety('Show my blood pressure trend', 'en')).toBeNull();
  });
});

describe('Phase 3 patient report comparison', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const firstId = '00000000-0000-4000-8000-000000000002';
  const secondId = '00000000-0000-4000-8000-000000000003';
  const prisma = { medicalDocument: { findMany: jest.fn() } } as unknown as PrismaService;
  const limiter = { consume: jest.fn() } as unknown as SecurityRateLimiter;
  const service = new PatientIntelligenceService(prisma, limiter);

  beforeEach(() => jest.clearAllMocks());
  it('limits lookup to authenticated patient-owned reports', async () => {
    (prisma.medicalDocument.findMany as jest.Mock).mockResolvedValue([]);
    await expect(service.compare(userId, firstId, secondId)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.medicalDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ uploadedByUserId: userId, id: { in: [firstId, secondId] } }) }));
  });
  it('compares identical test names and units and cites both reports', async () => {
    (prisma.medicalDocument.findMany as jest.Mock).mockResolvedValue([
      { id: firstId, title: 'First synthetic blood report', documentDate: new Date('2025-01-01'), patientProfileId: 'profile-1', ocrResult: { reviewedAt: new Date(), reviewedFields: [{ testName: 'HbA1c', value: '6.1', unit: '%', referenceRange: 'synthetic range', abnormalFlag: 'H' }, { testName: 'TSH', value: '2', unit: 'mIU/L' }] } },
      { id: secondId, title: 'Second synthetic blood report', documentDate: new Date('2025-06-01'), patientProfileId: 'profile-1', ocrResult: { reviewedAt: new Date(), reviewedFields: [{ testName: 'HbA1c', value: '6.4', unit: '%', referenceRange: 'synthetic range', abnormalFlag: 'H' }, { testName: 'TSH', value: '3', unit: 'uIU/L' }] } },
    ]);
    const result = await service.compare(userId, firstId, secondId);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0]).toMatchObject({ testName: 'HbA1c', unit: '%', first: { source: { id: firstId } }, second: { source: { id: secondId } } });
    expect(result.unmatched).toHaveLength(2);
  });
  it('rejects documents that do not belong to the same patient', async () => {
    (prisma.medicalDocument.findMany as jest.Mock).mockResolvedValue([{ id: firstId, patientProfileId: 'profile-1', ocrResult: null }, { id: secondId, patientProfileId: 'profile-2', ocrResult: null }]);
    await expect(service.compare(userId, firstId, secondId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Phase 3 AI response receipts', () => {
  it('serves urgent local guidance without provider configuration or patient-record retrieval', async () => {
    const prisma = { aiResponseReceipt: { deleteMany: jest.fn(), create: jest.fn() }, patientProfile: { findUnique: jest.fn() } } as never;
    const config = { get: jest.fn(() => undefined) } as never;
    const limiter = { consume: jest.fn() } as never;
    const provider = { answer: jest.fn(), health: jest.fn() } as never;
    const knowledge = { retrieve: jest.fn() } as never;
    const service = new AiAssistantService(prisma, config, limiter, provider, knowledge);
    const response = await service.query('00000000-0000-4000-8000-000000000001', 'I have severe chest pain', 'en');
    expect('kind' in response && response.kind).toBe('urgent');
    expect(response.sources).toEqual([]);
    expect((prisma as { aiResponseReceipt: { create: jest.Mock } }).aiResponseReceipt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: '00000000-0000-4000-8000-000000000001', responseId: response.responseId }) }));
    expect((provider as { answer: jest.Mock }).answer).not.toHaveBeenCalled();
    expect((prisma as { patientProfile: { findUnique: jest.Mock } }).patientProfile.findUnique).not.toHaveBeenCalled();
  });

  it('stores only enum feedback against a response receipt owned by the patient', async () => {
    const feedback = { create: jest.fn().mockResolvedValue({ id: 'feedback-id' }) };
    const receipts = { deleteMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'receipt-id' }) };
    const prisma = { aiResponseReceipt: receipts, aiResponseFeedback: feedback } as never;
    const limiter = { consume: jest.fn() } as never;
    const service = new AiAssistantService(prisma, {} as never, limiter, {} as never, {} as never);
    const result = await service.submitFeedback('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'NOT_HELPFUL', 'MISSING_CONTEXT');
    expect(result.submitted).toBe(true);
    expect(receipts.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: '00000000-0000-4000-8000-000000000001', responseId: '00000000-0000-4000-8000-000000000002', expiresAt: { gt: expect.any(Date) } } }));
    expect(feedback.create).toHaveBeenCalledWith({ data: { userId: '00000000-0000-4000-8000-000000000001', responseId: '00000000-0000-4000-8000-000000000002', rating: 'NOT_HELPFUL', category: 'MISSING_CONTEXT' } });
  });

  it('rejects feedback for an unknown or expired response', async () => {
    const feedback = { create: jest.fn() };
    const receipts = { deleteMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) };
    const service = new AiAssistantService({ aiResponseReceipt: receipts, aiResponseFeedback: feedback } as never, {} as never, { consume: jest.fn() } as never, {} as never, {} as never);
    await expect(service.submitFeedback('user-id', '00000000-0000-4000-8000-000000000002', 'HELPFUL')).rejects.toBeInstanceOf(NotFoundException);
    expect(feedback.create).not.toHaveBeenCalled();
  });
});

describe('Phase 3 reminder ownership', () => {
  it('scopes reminder deletion to the authenticated patient', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const controller = new PatientRemindersController({ patientReminder: { deleteMany } } as never);
    await expect(controller.remove('00000000-0000-4000-8000-000000000009', { auth: { userId: '00000000-0000-4000-8000-000000000001' } } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: '00000000-0000-4000-8000-000000000009', userId: '00000000-0000-4000-8000-000000000001' } });
  });
});
