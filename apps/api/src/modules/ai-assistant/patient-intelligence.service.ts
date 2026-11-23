import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';

type ReviewedValue = { testName: string; value: string; unit?: string | null; referenceRange?: string | null; abnormalFlag?: string | null };

@Injectable()
export class PatientIntelligenceService {
  constructor(private readonly prisma: PrismaService, private readonly limiter: SecurityRateLimiter) {}

  async overview(userId: string) {
    this.limiter.consume(`intelligence:${userId}`, 30, 60_000);
    const profile = await this.prisma.patientProfile.findUnique({ where: { userId }, select: { id: true, fullName: true, dateOfBirth: true, gender: true, bloodGroup: true, healthInformation: { select: { allergies: true, existingMedicalConditions: true, currentMedications: true } } } });
    if (!profile) return { insights: [], trends: [], recentReports: [], pendingOcrReviews: 0, completeness: { percent: 0, missing: ['patient profile'] }, disclaimer: 'Record-based observations only; not medical advice.' };
    const [documents, bp, glucose, pendingOcrReviews, reminders] = await Promise.all([
      this.prisma.medicalDocument.findMany({ where: { patientProfileId: profile.id, uploadedByUserId: userId, deletedAt: null, uploadStatus: 'AVAILABLE' }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }], take: 100, select: { id: true, title: true, category: true, documentDate: true, createdAt: true, ocrResult: { select: { status: true, reviewedAt: true, reviewedFields: true, reviewedMetadata: true } } } }),
      this.prisma.bloodPressureReading.findMany({ where: { patientProfileId: profile.id, deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: 30, select: { systolic: true, diastolic: true, measuredAt: true } }),
      this.prisma.bloodGlucoseReading.findMany({ where: { patientProfileId: profile.id, deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: 30, select: { glucoseValue: true, glucoseUnit: true, measurementType: true, measuredAt: true } }),
      this.prisma.medicalDocumentOcrResult.count({ where: { patientProfileId: profile.id, status: 'COMPLETED', reviewedAt: null, document: { deletedAt: null, uploadedByUserId: userId } } }),
      this.prisma.patientReminder.findMany({ where: { userId, disabledAt: null, completedAt: null, dueAt: { gte: new Date() } }, orderBy: { dueAt: 'asc' }, take: 5, select: { id: true, title: true, type: true, dueAt: true } }),
    ]);
    const missing = [!profile.fullName && 'full name', !profile.dateOfBirth && 'date of birth', !profile.gender && 'gender', !profile.bloodGroup && 'blood group', !profile.healthInformation?.allergies && 'allergy information', !profile.healthInformation?.existingMedicalConditions && 'conditions', !profile.healthInformation?.currentMedications && 'medication information'].filter((v): v is string => typeof v === 'string');
    const completeness = Math.round(((7 - missing.length) / 7) * 100);
    const insights: Array<Record<string, unknown>> = [];
    const groups = new Map<string, Array<{ value: number; date: Date; docId: string; title: string; testName: string; unit: string; flag: string | null; range: string | null }>>();
    for (const doc of documents) {
      if (!doc.ocrResult?.reviewedAt || !Array.isArray(doc.ocrResult.reviewedFields)) continue;
      const metadata = doc.ocrResult.reviewedMetadata && typeof doc.ocrResult.reviewedMetadata === 'object' && !Array.isArray(doc.ocrResult.reviewedMetadata) ? doc.ocrResult.reviewedMetadata as Record<string, unknown> : {};
      const rd = typeof metadata.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.reportDate) ? new Date(`${metadata.reportDate}T00:00:00.000Z`) : doc.documentDate;
      if (!rd || !Number.isFinite(rd.getTime())) continue;
      for (const raw of doc.ocrResult.reviewedFields) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const row = raw as Partial<ReviewedValue>;
        if (typeof row.testName !== 'string' || typeof row.value !== 'string' || !row.testName.trim()) continue;
        const value = Number(row.value.replace(',', '.'));
        if (!Number.isFinite(value)) continue;
        const unit = typeof row.unit === 'string' ? row.unit.trim() : '';
        const key = `${row.testName.trim().toLocaleLowerCase()}|${unit.toLocaleLowerCase()}`;
        const list = groups.get(key) ?? [];
        list.push({ value, date: rd, docId: doc.id, title: doc.title, testName: row.testName.trim(), unit, flag: typeof row.abnormalFlag === 'string' ? row.abnormalFlag.trim().toUpperCase() : null, range: typeof row.referenceRange === 'string' ? row.referenceRange : null });
        groups.set(key, list);
        if (row.abnormalFlag && /^(H|L|HIGH|LOW|ABNORMAL|CRITICAL)$/.test(row.abnormalFlag.trim().toUpperCase())) {
          insights.push({ kind: 'reported-flag', title: `${row.testName.trim()} marked ${row.abnormalFlag.trim()} in report`, why: 'This flag was explicitly present in patient-reviewed report data; HealthWallet does not independently assess the result.', confidence: 'source-reported; not clinically verified', supportingData: { value, unit: unit || null, referenceRange: row.referenceRange ?? null, flag: row.abnormalFlag, date: rd, source: { id: doc.id, title: doc.title } }, disclaimer: 'Discuss the original report with a qualified clinician.' });
        }
      }
    }
    const trends = [...groups.values()].filter(points => points.length >= 2).map(points => {
      points.sort((a, b) => a.date.getTime() - b.date.getTime());
      const first = points[0]!, latest = points.at(-1)!;
      const flagged = points.filter(p => p.flag && /^(H|L|HIGH|LOW|ABNORMAL|CRITICAL)$/.test(p.flag));
      if (flagged.length >= 2) insights.push({ kind: 'repeated-report-flag', title: `Repeated ${latest.testName} report flags`, why: `${flagged.length} reviewed reports explicitly marked the same test and unit; this is a record observation, not a clinical assessment.`, confidence: 'source-reported; not clinically verified', supportingData: flagged.map(p => ({ value: p.value, unit: p.unit || null, flag: p.flag, date: p.date, source: { id: p.docId, title: p.title } })), disclaimer: 'Discuss these reports with a qualified clinician.' });
      return { testName: latest.testName, unit: latest.unit || null, points: points.map(p => ({ value: p.value, date: p.date, source: { id: p.docId, title: p.title } })), change: latest.value - first.value, comparison: 'Numeric comparison only; no clinical interpretation.' };
    });
    const bpTrend = bp.length >= 2 ? { type: 'blood-pressure', unit: 'mmHg', points: [...bp].reverse().map(r => ({ systolic: r.systolic, diastolic: r.diastolic, date: r.measuredAt })) } : null;
    const glucoseGroups = new Map<string, typeof glucose>();
    for (const r of glucose) { const k = `${r.glucoseUnit}|${r.measurementType}`; glucoseGroups.set(k, [...(glucoseGroups.get(k) ?? []), r]); }
    const trackingTrends = [...glucoseGroups.entries()].filter(([, rows]) => rows.length >= 2).map(([key, rows]) => ({ type: 'blood-glucose', key, points: [...rows].reverse().map(r => ({ value: Number(r.glucoseValue), unit: r.glucoseUnit, measurementType: r.measurementType, date: r.measuredAt })), comparison: 'Compared only within matching unit and measurement type.' }));
    return { insights: insights.slice(0, 20), trends: [...trends, ...(bpTrend ? [bpTrend] : []), ...trackingTrends], recentReports: documents.slice(0, 5).map(d => ({ id: d.id, title: d.title, category: d.category, date: d.documentDate, ocrStatus: d.ocrResult?.status ?? 'PENDING', reviewed: Boolean(d.ocrResult?.reviewedAt) })), pendingOcrReviews, completeness: { percent: completeness, missing }, reminders, disclaimer: 'These are observations from your records, not a diagnosis or treatment recommendation. AI-generated summaries may be wrong.' };
  }

  async compare(userId: string, firstId: string, secondId: string) {
    this.limiter.consume(`compare:${userId}`, 20, 60_000);
    if (firstId === secondId) throw new ForbiddenException('Choose two different reports.');
    const docs = await this.prisma.medicalDocument.findMany({ where: { id: { in: [firstId, secondId] }, uploadedByUserId: userId, deletedAt: null, uploadStatus: 'AVAILABLE' }, select: { id: true, title: true, documentDate: true, patientProfileId: true, ocrResult: { select: { reviewedAt: true, reviewedFields: true, reviewedMetadata: true } } } });
    if (docs.length !== 2 || docs[0]!.patientProfileId !== docs[1]!.patientProfileId) throw new NotFoundException('One or both reports were not found in your account.');
    const prepared = docs.map(doc => {
      const rawValues: unknown[] = doc.ocrResult?.reviewedAt && Array.isArray(doc.ocrResult.reviewedFields) ? doc.ocrResult.reviewedFields as unknown[] : [];
      const values = rawValues.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
        .map(row => ({ testName: typeof row.testName === 'string' ? row.testName.trim() : '', value: typeof row.value === 'string' ? Number(row.value.replace(',', '.')) : NaN, unit: typeof row.unit === 'string' ? row.unit.trim() : '', referenceRange: typeof row.referenceRange === 'string' ? row.referenceRange : null, abnormalFlag: typeof row.abnormalFlag === 'string' ? row.abnormalFlag : null }))
        .filter(v => v.testName && Number.isFinite(v.value));
      return { doc, values };
    });
    const [left, right] = prepared;
    if (!left || !right) throw new NotFoundException('Reports not found.');
    const key = (testName: string, unit: string) => `${testName.toLocaleLowerCase()}|${unit.toLocaleLowerCase()}`;
    const rightMap = new Map(right.values.map(v => [key(v.testName, v.unit), v]));
    const comparisons = left.values.map(a => { const b = rightMap.get(key(a.testName, a.unit)); return b ? { testName: a.testName, unit: a.unit || null, first: { value: a.value, referenceRange: a.referenceRange, flag: a.abnormalFlag, source: { id: left.doc.id, title: left.doc.title, date: left.doc.documentDate } }, second: { value: b.value, referenceRange: b.referenceRange, flag: b.abnormalFlag, source: { id: right.doc.id, title: right.doc.title, date: right.doc.documentDate } }, change: b.value - a.value } : null; }).filter((v): v is NonNullable<typeof v> => Boolean(v));
    const incompatible = [
      ...left.values.filter(a => !right.values.some(b => b.testName.toLocaleLowerCase() === a.testName.toLocaleLowerCase() && b.unit.toLocaleLowerCase() === a.unit.toLocaleLowerCase())).map(a => ({ testName: a.testName, unit: a.unit || null, reportId: left.doc.id, reason: 'No matching test with the same unit in the other report.' })),
      ...right.values.filter(b => !left.values.some(a => a.testName.toLocaleLowerCase() === b.testName.toLocaleLowerCase() && a.unit.toLocaleLowerCase() === b.unit.toLocaleLowerCase())).map(b => ({ testName: b.testName, unit: b.unit || null, reportId: right.doc.id, reason: 'No matching test with the same unit in the other report.' })),
    ];
    return { reports: prepared.map(({ doc }) => ({ id: doc.id, title: doc.title, date: doc.documentDate, reviewed: Boolean(doc.ocrResult?.reviewedAt) })), comparisons, unmatched: incompatible, disclaimer: 'Only identical test names and units are compared. Values are not clinically interpreted; verify them against the original reports with a clinician.' };
  }
}
