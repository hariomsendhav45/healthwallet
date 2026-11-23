import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiAssistantService } from '../src/modules/ai-assistant/ai-assistant.service';
import { AiProvider } from '../src/modules/ai-assistant/ai-provider';
import { PrismaService } from '../src/database/prisma.service';
import { SecurityRateLimiter } from '../src/modules/auth/security-rate-limiter.service';
import { MedicalKnowledgeService } from '../src/modules/ai-assistant/medical-knowledge.service';

describe('AI assistant privacy and provider gates', () => {
  const consent = { findUnique: jest.fn(), upsert: jest.fn() };
  const receipts = { deleteMany: jest.fn(), create: jest.fn() };
  const findPatient = jest.fn(); const findDocuments = jest.fn(); const findBp = jest.fn(); const findGlucose = jest.fn();
  const prisma = { aiProcessingConsent: consent, aiResponseReceipt: receipts, patientProfile: { findUnique: findPatient }, medicalDocument: { findMany: findDocuments }, bloodPressureReading: { findMany: findBp }, bloodGlucoseReading: { findMany: findGlucose } } as unknown as PrismaService;
  const configValues: Record<string,string> = { AI_ASSISTANT_ENABLED:'true', AI_ASSISTANT_PROVIDER:'openai', OPENAI_API_KEY:'test-key' };
  const config = { get: (key:string) => configValues[key] } as ConfigService;
  const limiter = { consume: jest.fn() } as unknown as SecurityRateLimiter;
  const knowledgeMock = { retrieve: jest.fn().mockResolvedValue([]) };
  const knowledge = knowledgeMock as unknown as MedicalKnowledgeService;
  const provider: AiProvider = { name:'openai', health:jest.fn().mockResolvedValue(true), answer:jest.fn().mockResolvedValue('Educational response.') };
  const service = new AiAssistantService(prisma, config, limiter, provider, knowledge);
  beforeEach(() => { jest.clearAllMocks(); receipts.deleteMany.mockResolvedValue({ count: 0 }); receipts.create.mockResolvedValue({}); knowledgeMock.retrieve.mockResolvedValue([]); });

  it('keeps provider disabled without key', async () => {
    delete configValues.OPENAI_API_KEY;
    expect((await service.status('patient-a')).enabled).toBe(false);
    configValues.OPENAI_API_KEY='test-key';
  });
  it('does not call provider without active consent', async () => {
    consent.findUnique.mockResolvedValue({grantedAt:null,withdrawnAt:null});
    await expect(service.query('patient-a','question','en')).rejects.toBeInstanceOf(ForbiddenException);
    expect(provider.answer).not.toHaveBeenCalled();
    expect(findPatient).not.toHaveBeenCalled();
  });
  it('blocks withdrawn consent', async () => {
    consent.findUnique.mockResolvedValue({grantedAt:new Date(),withdrawnAt:new Date()});
    await expect(service.query('patient-a','question','hi')).rejects.toBeInstanceOf(ForbiddenException);
    expect(provider.answer).not.toHaveBeenCalled();
  });
  it('blocks requests when AI is disabled even with consent', async () => {
    configValues.AI_ASSISTANT_ENABLED='false';
    await expect(service.query('patient-a','question','en')).rejects.toBeInstanceOf(ServiceUnavailableException);
    configValues.AI_ASSISTANT_ENABLED='true';
  });
  it('retrieves context only through the authenticated patient user and does not pass unrelated records', async () => {
    consent.findUnique.mockResolvedValue({grantedAt:new Date(),withdrawnAt:null});
    findPatient.mockResolvedValue({id:'profile-a',healthInformation:null});
    findDocuments.mockResolvedValue([{id:'doc-a',title:'Own report',category:'BLOOD_TEST',documentDate:null}]);
    findBp.mockResolvedValue([]);
    findGlucose.mockResolvedValue([]);
    await service.query('patient-a','Summarize my records','en');
    expect(findPatient).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'patient-a'}}));
    expect(findDocuments).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({patientProfileId:'profile-a',uploadedByUserId:'patient-a'})}));
    const sent = (provider.answer as jest.Mock).mock.calls[0][0];
    expect(sent.context).toContain('Own report');
    expect(sent.context).not.toContain('another patient');
  });
  it('compares only reviewed lab values with the same test name and unit and keeps report provenance', async () => {
    consent.findUnique.mockResolvedValue({grantedAt:new Date(),withdrawnAt:null});
    findPatient.mockResolvedValue({id:'profile-a',healthInformation:null});
    findDocuments.mockResolvedValue([
      {id:'doc-old',title:'Old report',category:'BLOOD_TEST',documentDate:null,createdAt:new Date('2025-01-02'),ocrResult:{reviewedAt:new Date('2025-01-03'),reviewedText:'HbA1c 6.5%',reviewedFields:[{testName:'HbA1c',value:'6.5',unit:'%'}],reviewedMetadata:{reportDate:'2025-01-01'}}},
      {id:'doc-new',title:'Current report',category:'BLOOD_TEST',documentDate:new Date('2025-06-01'),createdAt:new Date('2025-06-02'),ocrResult:{reviewedAt:new Date('2025-06-03'),reviewedText:'HbA1c 7.1%',reviewedFields:[{testName:'HbA1c',value:'7.1',unit:'%'}],reviewedMetadata:{reportDate:'2025-06-01'}}},
    ]);
    findBp.mockResolvedValue([]); findGlucose.mockResolvedValue([]);
    await service.query('patient-a','Compare my reports','en');
    const sent = (provider.answer as jest.Mock).mock.calls[0][0];
    const context = JSON.parse(sent.context);
    expect(context.labComparisons).toHaveLength(1);
    expect(context.labComparisons[0]).toEqual(expect.objectContaining({testName:'HbA1c',unit:'%'}));
    expect(context.labComparisons[0].absoluteChange).toBeCloseTo(0.6);
    expect(context.documents[1].reviewedExtract.provenance).toContain('not clinically verified');
    expect(context.labComparisons[0].previous.source).toBe('Document doc-old');
    expect(context.labComparisons[0].current.source).toBe('Document doc-new');
  });
  it('converts provider errors to safe responses without exposing provider details', async () => {
    consent.findUnique.mockResolvedValue({grantedAt:new Date(),withdrawnAt:null});
    findPatient.mockResolvedValue({id:'profile-a',healthInformation:null});
    findDocuments.mockResolvedValue([]);
    findBp.mockResolvedValue([]);
    findGlucose.mockResolvedValue([]);
    (provider.answer as jest.Mock).mockRejectedValueOnce(new Error('secret provider response data'));
    await expect(service.query('patient-a','Hindi question','hi')).rejects.toThrow('temporarily unavailable');
  });
});
