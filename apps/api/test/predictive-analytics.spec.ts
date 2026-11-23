import { PredictiveAnalyticsService } from '../src/modules/ai-assistant/predictive-analytics.service';
import { PrismaService } from '../src/database/prisma.service';
import { SecurityRateLimiter } from '../src/modules/auth/security-rate-limiter.service';

describe('PredictiveAnalyticsService', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const patientProfileId = '00000000-0000-4000-8000-000000000002';
  const findProfile = jest.fn(); const findBp = jest.fn(); const findGlucose = jest.fn(); const findDocuments = jest.fn();
  const prisma = { patientProfile: { findUnique: findProfile }, bloodPressureReading: { findMany: findBp }, bloodGlucoseReading: { findMany: findGlucose }, medicalDocument: { findMany: findDocuments } } as unknown as PrismaService;
  const limiter = { consume: jest.fn() } as unknown as SecurityRateLimiter;
  const service = new PredictiveAnalyticsService(prisma, limiter);
  const now = new Date('2026-11-15T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    findProfile.mockResolvedValue({ id: patientProfileId });
    findBp.mockResolvedValue([]); findGlucose.mockResolvedValue([]); findDocuments.mockResolvedValue([]);
  });
  afterEach(() => jest.useRealTimers());

  it('returns no fabricated risk estimate and explains insufficient history', async () => {
    const result = await service.riskTrends(userId);
    expect(result.modelBasedRisk).toMatchObject({ available: false });
    expect(result.statisticalTrends).toEqual([]);
    expect(result.insufficientData.map(item => item.measurement)).toEqual(expect.arrayContaining(['Blood pressure', 'Blood glucose', 'BMI']));
    expect(result.validationStatus).toBe('NOT_CLINICALLY_VALIDATED');
  });

  it('computes a descriptive patient-scoped trend after five readings across a month', async () => {
    findBp.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `bp-${index}`, systolic: 110 + index * 5, diastolic: 70 + index * 2, measuredAt: new Date(Date.UTC(2026, 9, 1 + index * 10)) })));
    const result = await service.riskTrends(userId);
    const systolic = result.statisticalTrends.find(item => item.series === 'Blood pressure systolic');
    expect(systolic?.result?.direction).toBe('upward');
    expect(systolic?.result?.observationCount).toBe(5);
    expect(systolic?.result?.sources).toHaveLength(5);
    expect(systolic?.result?.intervalNote).toContain('not a probability');
    expect(findProfile).toHaveBeenCalledWith({ where: { userId }, select: { id: true } });
    expect(findBp).toHaveBeenCalledWith(expect.objectContaining({ where: { patientProfileId, deletedAt: null } }));
  });

  it('does not combine incompatible glucose units or measurement types', async () => {
    findGlucose.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ id: `glucose-${index}`, glucoseValue: '100', glucoseUnit: index % 2 ? 'MG_DL' : 'MMOL_L', measurementType: index % 2 ? 'FASTING' : 'RANDOM', measuredAt: new Date(Date.UTC(2026, 9, 1 + index * 10)) })));
    const result = await service.riskTrends(userId);
    expect(result.statisticalTrends).toEqual([]);
    expect(result.insufficientData.filter(item => String(item.measurement).startsWith('Blood glucose')).length).toBe(2);
  });

  it('surfaces a large difference from personal history as a statistical observation only', async () => {
    const values = [110, 111, 109, 112, 108, 150];
    findBp.mockResolvedValue(values.map((systolic, index) => ({ id: `bp-deviation-${index}`, systolic, diastolic: 75 + index, measuredAt: new Date(Date.UTC(2026, 8, 1 + index * 10)) })));
    const result = await service.riskTrends(userId);
    const deviation = result.statisticalDeviations.find(item => item.measurement === 'Blood pressure systolic');
    expect(deviation?.current.value).toBe(150);
    expect(deviation?.interpretation).toContain('does not show that the value is medically dangerous');
  });

  it('counts repeated report flags only for a matching reviewed test and unit and retains citations', async () => {
    findDocuments.mockResolvedValue([
      { id: 'doc-one', title: 'Synthetic report one', documentDate: new Date('2026-01-01'), ocrResult: { reviewedAt: new Date('2026-01-02'), reviewedFields: [{ testName: 'HbA1c', value: '6.1', unit: '%', abnormalFlag: 'H' }], reviewedMetadata: null } },
      { id: 'doc-two', title: 'Synthetic report two', documentDate: new Date('2026-06-01'), ocrResult: { reviewedAt: new Date('2026-06-02'), reviewedFields: [{ testName: 'HbA1c', value: '6.4', unit: '%', abnormalFlag: 'HIGH' }], reviewedMetadata: null } },
      { id: 'doc-three', title: 'Synthetic different-unit report', documentDate: new Date('2026-07-01'), ocrResult: { reviewedAt: new Date('2026-07-02'), reviewedFields: [{ testName: 'HbA1c', value: '40', unit: 'mmol/mol', abnormalFlag: 'H' }], reviewedMetadata: null } },
    ]);
    const result = await service.riskTrends(userId);
    const repeated = result.persistentReportedFlags.find(item => item.series === 'hba1c|%');
    expect(repeated).toMatchObject({ observationCount: 2, reviewDisposition: 'DISCUSS_WITH_CLINICIAN' });
    expect(repeated?.observations.map(item => item.source.id)).toEqual(['doc-one', 'doc-two']);
    expect(findDocuments).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ patientProfileId, uploadedByUserId: userId }) }));
  });

  it('reports future-dated readings as quality issues and excludes them from trend estimates', async () => {
    findBp.mockResolvedValue([{ id: 'future-bp', systolic: 120, diastolic: 80, measuredAt: new Date('2027-01-01T00:00:00.000Z') }]);
    const result = await service.riskTrends(userId);
    expect(result.dataQualityIssues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'future-dated-observation' })]));
    expect(result.statisticalTrends).toEqual([]);
  });

  it('returns an insufficient-data state when no patient profile exists', async () => {
    findProfile.mockResolvedValue(null);
    const result = await service.riskTrends(userId);
    expect(result.insufficientData[0]?.reason).toContain('profile');
    expect(findBp).not.toHaveBeenCalled();
    expect(findDocuments).not.toHaveBeenCalled();
  });
});
