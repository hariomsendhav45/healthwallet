import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';

export const PREDICTIVE_RULE_VERSION = 'descriptive-health-trends-2026-11-v1';
const MIN_TREND_POINTS = 5;
const MIN_TREND_SPAN_DAYS = 30;
const MAX_OBSERVATIONS = 200;
const DAY_MS = 86_400_000;
const T_CRITICAL_95 = [0, 0, 0, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

type SourceRef = { kind: 'blood-pressure' | 'blood-glucose' | 'medical-document'; id: string; title?: string; observedAt: Date };
type Observation = { value: number; unit: string; at: Date; source: SourceRef; flag?: string | null };
type Series = { key: string; name: string; unit: string; observations: Observation[] };

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function regression(series: Series) {
  const observations = [...series.observations].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (observations.length < MIN_TREND_POINTS) return null;
  const start = observations[0]!.at.getTime();
  const x = observations.map(item => (item.at.getTime() - start) / DAY_MS);
  const spanDays = x.at(-1)!;
  if (spanDays < MIN_TREND_SPAN_DAYS) return null;
  const y = observations.map(item => item.value);
  const xMean = x.reduce((sum, value) => sum + value, 0) / x.length;
  const yMean = y.reduce((sum, value) => sum + value, 0) / y.length;
  const xx = x.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (xx === 0) return null;
  const slopePerDay = x.reduce((sum, value, index) => sum + (value - xMean) * (y[index]! - yMean), 0) / xx;
  const intercept = yMean - slopePerDay * xMean;
  const residualSum = y.reduce((sum, value, index) => sum + (value - (intercept + slopePerDay * x[index]!)) ** 2, 0);
  const standardErrorPerDay = Math.sqrt(Math.max(0, residualSum / (x.length - 2)) / xx);
  const slopePer30Days = slopePerDay * 30;
  const degreesOfFreedom = x.length - 2;
  const tCritical = T_CRITICAL_95[degreesOfFreedom] ?? 1.96;
  const marginPer30Days = tCritical * standardErrorPerDay * 30;
  const direction = slopePer30Days - marginPer30Days > 0 ? 'upward' : slopePer30Days + marginPer30Days < 0 ? 'downward' : 'no-clear-linear-direction';
  return {
    direction,
    directionalUncertainty: direction === 'no-clear-linear-direction' ? 'HIGH_DIRECTIONAL_UNCERTAINTY' : 'DESCRIPTIVE_FIT_ONLY_NOT_VALIDATED',
    slopePer30Days: Number(slopePer30Days.toFixed(4)),
    descriptive95PercentIntervalPer30Days: [Number((slopePer30Days - marginPer30Days).toFixed(4)), Number((slopePer30Days + marginPer30Days).toFixed(4))],
    intervalNote: 'Approximate two-sided 95% interval for a descriptive linear fit only; it is not a probability, future prediction, or clinical risk estimate.',
    rSquared: Number((1 - residualSum / (y.reduce((sum, value) => sum + (value - yMean) ** 2, 0) || 1)).toFixed(3)),
    observationCount: observations.length,
    observationPeriod: { start: observations[0]!.at, end: observations.at(-1)!.at, spanDays },
    sources: observations.map(item => item.source),
  };
}

function detectDeviation(series: Series) {
  const observations = [...series.observations].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (observations.length < MIN_TREND_POINTS + 1) return null;
  const current = observations.at(-1)!;
  const baseline = observations.slice(0, -1);
  const center = median(baseline.map(item => item.value));
  const mad = median(baseline.map(item => Math.abs(item.value - center)));
  if (mad <= 0) return null;
  const robustDeviation = Math.abs(current.value - center) / mad;
  if (robustDeviation < 3) return null;
  return {
    kind: 'statistical-deviation',
    measurement: series.name,
    unit: series.unit,
    current: { value: current.value, observedAt: current.at, source: current.source },
    baseline: { median: center, mad, observationCount: baseline.length, sources: baseline.map(item => item.source) },
    robustDeviationMultiple: Number(robustDeviation.toFixed(2)),
    rule: 'Current observation is at least 3 median absolute deviations from this patient’s preceding observations.',
    interpretation: 'This is a statistical comparison to personal history only. It does not show that the value is medically dangerous or indicate a disease.',
  };
}

@Injectable()
export class PredictiveAnalyticsService {
  constructor(private readonly prisma: PrismaService, private readonly limiter: SecurityRateLimiter) {}

  async riskTrends(userId: string) {
    this.limiter.consume(`predictive-analytics:${userId}`, 20, 60_000);
    const profile = await this.prisma.patientProfile.findUnique({ where: { userId }, select: { id: true } });
    const generatedAt = new Date();
    const empty = (reason: string) => ({
      analysisType: 'DESCRIPTIVE_TREND_ANALYSIS', generatedAt, ruleVersion: PREDICTIVE_RULE_VERSION,
      validationStatus: 'NOT_CLINICALLY_VALIDATED', modelBasedRisk: { available: false, reason: 'No validated risk model is registered; no risk score was generated.' },
      observationPeriod: { start: null, end: null }, dataCoverage: { bloodPressure: 0, bloodGlucose: 0, reviewedLabValues: 0, reviewedLabSeries: 0, bmi: 'NOT_AVAILABLE_IN_CURRENT_SCHEMA' },
      persistentReportedFlags: [], statisticalTrends: [], statisticalDeviations: [], dataQualityIssues: [],
      insufficientData: [{ measurement: 'patient health history', reason }],
      ruleProvenance: { version: PREDICTIVE_RULE_VERSION, observationLimitPerSource: MAX_OBSERVATIONS, minimumTrendPoints: MIN_TREND_POINTS, minimumTrendSpanDays: MIN_TREND_SPAN_DAYS, deviationHeuristic: '3 × median absolute deviation from at least five preceding observations', validationStatus: 'ENGINEERING_HEURISTIC_ONLY; NOT_CLINICALLY_VALIDATED' },
      limitations: this.limitations(),
    });
    if (!profile) return empty('Complete patient profile is not available.');

    const [bp, glucose, documents] = await Promise.all([
      this.prisma.bloodPressureReading.findMany({ where: { patientProfileId: profile.id, deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: MAX_OBSERVATIONS, select: { id: true, systolic: true, diastolic: true, measuredAt: true } }),
      this.prisma.bloodGlucoseReading.findMany({ where: { patientProfileId: profile.id, deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: MAX_OBSERVATIONS, select: { id: true, glucoseValue: true, glucoseUnit: true, measurementType: true, measuredAt: true } }),
      this.prisma.medicalDocument.findMany({ where: { patientProfileId: profile.id, uploadedByUserId: userId, deletedAt: null, uploadStatus: 'AVAILABLE', ocrResult: { is: { reviewedAt: { not: null } } } }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }], take: MAX_OBSERVATIONS, select: { id: true, title: true, documentDate: true, ocrResult: { select: { reviewedAt: true, reviewedFields: true, reviewedMetadata: true } } } }),
    ]);

    const issues: Array<Record<string, unknown>> = [];
    const seriesMap = new Map<string, Series>();
    const validObservations: Observation[] = [];
    const add = (key: string, name: string, unit: string, value: number, at: Date, source: SourceRef, flag?: string | null) => {
      if (!Number.isFinite(value)) { issues.push({ kind: 'invalid-numeric-value', measurement: name, source }); return; }
      if (!Number.isFinite(at.getTime())) { issues.push({ kind: 'invalid-observation-date', measurement: name, source }); return; }
      if (at.getTime() > generatedAt.getTime() + 5 * 60_000) { issues.push({ kind: 'future-dated-observation', measurement: name, source }); return; }
      const observation: Observation = { value, unit, at, source, ...(flag === undefined ? {} : { flag }) };
      validObservations.push(observation);
      const target = seriesMap.get(key) ?? { key, name, unit, observations: [] };
      target.observations.push(observation); seriesMap.set(key, target);
    };

    for (const reading of bp) {
      const source: SourceRef = { kind: 'blood-pressure', id: reading.id, observedAt: reading.measuredAt };
      if (reading.systolic <= 0 || reading.diastolic <= 0) { issues.push({ kind: 'non-positive-reading', measurement: 'blood pressure', source }); continue; }
      add('blood-pressure:systolic:mmHg', 'Blood pressure systolic', 'mmHg', reading.systolic, reading.measuredAt, source);
      add('blood-pressure:diastolic:mmHg', 'Blood pressure diastolic', 'mmHg', reading.diastolic, reading.measuredAt, source);
    }
    for (const reading of glucose) {
      const unit = reading.glucoseUnit === 'MG_DL' ? 'mg/dL' : 'mmol/L';
      const key = `blood-glucose:${reading.glucoseUnit}:${reading.measurementType}`;
      add(key, `Blood glucose (${reading.measurementType.toLowerCase().replaceAll('_', ' ')})`, unit, Number(reading.glucoseValue), reading.measuredAt, { kind: 'blood-glucose', id: reading.id, observedAt: reading.measuredAt });
    }

    const flagGroups = new Map<string, Observation[]>();
    let reviewedLabSeries = 0;
    for (const document of documents) {
      if (!document.ocrResult?.reviewedAt || !Array.isArray(document.ocrResult.reviewedFields)) continue;
      const metadata = document.ocrResult.reviewedMetadata && typeof document.ocrResult.reviewedMetadata === 'object' && !Array.isArray(document.ocrResult.reviewedMetadata) ? document.ocrResult.reviewedMetadata as Record<string, unknown> : {};
      const dateText = typeof metadata.reportDate === 'string' ? metadata.reportDate : '';
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : document.documentDate;
      const source: SourceRef = { kind: 'medical-document', id: document.id, title: document.title, observedAt: parsedDate ?? document.ocrResult.reviewedAt };
      if (!parsedDate) { issues.push({ kind: 'missing-observation-date', source }); continue; }
      if (parsedDate.getTime() > generatedAt.getTime() + 5 * 60_000) { issues.push({ kind: 'future-dated-report', source }); continue; }
      if (!Array.isArray(document.ocrResult.reviewedFields)) continue;
      for (const item of document.ocrResult.reviewedFields) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        const testName = typeof row.testName === 'string' ? row.testName.trim() : '';
        const unit = typeof row.unit === 'string' ? row.unit.trim() : '';
        const rawValue = typeof row.value === 'string' ? row.value.trim() : '';
        if (!testName || !unit || !rawValue) { issues.push({ kind: !testName ? 'missing-test-name' : !unit ? 'missing-unit' : 'missing-numeric-value', source }); continue; }
        const value = Number(rawValue.replace(',', '.'));
        const groupKey = `lab:${testName.toLocaleLowerCase()}|${unit.toLocaleLowerCase()}`;
        const abnormalFlag = typeof row.abnormalFlag === 'string' ? row.abnormalFlag.trim().toUpperCase() : '';
        const observation: Observation = { value, unit, at: parsedDate, source, flag: abnormalFlag || null };
        if (/^(H|L|HIGH|LOW|ABNORMAL|CRITICAL)$/.test(abnormalFlag) && Number.isFinite(value)) flagGroups.set(groupKey, [...(flagGroups.get(groupKey) ?? []), observation]);
        if (!Number.isFinite(value)) { issues.push({ kind: 'invalid-numeric-value', measurement: testName, source }); continue; }
        add(groupKey, testName, unit, value, parsedDate, source, abnormalFlag || null);
        reviewedLabSeries++;
      }
    }

    const series = [...seriesMap.values()].map(item => ({ ...item, observations: item.observations.sort((a, b) => a.at.getTime() - b.at.getTime()) }));
    for (const item of series) {
      const dateCounts = new Map<number, SourceRef[]>();
      for (const observation of item.observations) dateCounts.set(observation.at.getTime(), [...(dateCounts.get(observation.at.getTime()) ?? []), observation.source]);
      for (const [timestamp, sources] of dateCounts) if (sources.length > 1) issues.push({ kind: 'duplicate-timestamp-observations', measurement: item.name, observedAt: new Date(timestamp), sources });
    }
    const statisticalTrends = series.map(item => ({ series: item.name, unit: item.unit, result: regression(item) })).filter(item => item.result);
    const statisticalDeviations = series.map(item => detectDeviation(item)).filter(item => item !== null);
    const persistentReportedFlags = [...flagGroups.entries()].filter(([, observations]) => observations.length >= 2).map(([key, observations]) => ({
      kind: 'repeated-source-reported-flag', series: key.slice(4), observationCount: observations.length,
      reviewDisposition: 'DISCUSS_WITH_CLINICIAN',
      validationStatus: 'PATIENT_REVIEWED_SOURCE_FLAGS_ONLY', observations: observations.map(item => ({ value: item.value, unit: item.unit, flag: item.flag, observedAt: item.at, source: item.source })),
      interpretation: 'These flags were explicitly present in patient-reviewed reports. This is not a diagnosis or an independent clinical assessment.',
    }));
    const insufficientData: Array<Record<string, unknown>> = [];
    for (const item of series) {
      const dates = item.observations.map(observation => observation.at.getTime());
      const spanDays = dates.length ? (Math.max(...dates) - Math.min(...dates)) / DAY_MS : 0;
      if (item.observations.length < MIN_TREND_POINTS || spanDays < MIN_TREND_SPAN_DAYS) insufficientData.push({ measurement: item.name, unit: item.unit, observationCount: item.observations.length, requiredCount: MIN_TREND_POINTS, observedSpanDays: Number(spanDays.toFixed(1)), requiredSpanDays: MIN_TREND_SPAN_DAYS, reason: 'Not enough compatible observations across enough time for a statistical trend.' });
    }
    if (bp.length === 0) insufficientData.push({ measurement: 'Blood pressure', reason: 'No recorded blood-pressure history is available.' });
    if (glucose.length === 0) insufficientData.push({ measurement: 'Blood glucose', reason: 'No recorded blood-glucose history is available.' });
    if (!series.some(item => /hba1c|hemoglobin a1c/i.test(item.name))) insufficientData.push({ measurement: 'HbA1c', reason: 'No patient-reviewed HbA1c report values are available.' });
    if (!series.some(item => /cholesterol|lipid/i.test(item.name))) insufficientData.push({ measurement: 'Cholesterol', reason: 'No patient-reviewed cholesterol or lipid values are available.' });
    if (!series.some(item => /creatinine|egfr|kidney/i.test(item.name))) insufficientData.push({ measurement: 'Kidney function', reason: 'No patient-reviewed kidney-function values are available.' });
    if (!series.some(item => /alt|ast|liver/i.test(item.name))) insufficientData.push({ measurement: 'Liver function', reason: 'No patient-reviewed liver-function values are available.' });
    insufficientData.push({ measurement: 'BMI', reason: 'BMI is not stored in the current structured patient schema; no value was inferred.' });
    const observedDates = validObservations.map(item => item.at.getTime());
    const earliest = observedDates.length ? new Date(Math.min(...observedDates)) : null;
    const latest = observedDates.length ? new Date(Math.max(...observedDates)) : null;
    return {
      analysisType: 'DESCRIPTIVE_TREND_ANALYSIS', generatedAt, ruleVersion: PREDICTIVE_RULE_VERSION,
      validationStatus: 'NOT_CLINICALLY_VALIDATED',
      modelBasedRisk: { available: false, reason: 'No validated clinical risk model is registered. HealthVault does not generate risk percentages or disease predictions.' },
      observationPeriod: { start: earliest, end: latest },
      dataCoverage: { bloodPressure: bp.length, bloodGlucose: glucose.length, reviewedLabValues: reviewedLabSeries, reviewedLabSeries: series.filter(item => item.key.startsWith('lab:')).length, bmi: 'NOT_AVAILABLE_IN_CURRENT_SCHEMA' },
      persistentReportedFlags, statisticalTrends, statisticalDeviations,
      dataQualityIssues: issues.slice(0, 100), insufficientData: insufficientData.slice(0, 100),
      ruleProvenance: { version: PREDICTIVE_RULE_VERSION, observationLimitPerSource: MAX_OBSERVATIONS, minimumTrendPoints: MIN_TREND_POINTS, minimumTrendSpanDays: MIN_TREND_SPAN_DAYS, deviationHeuristic: '3 × median absolute deviation from at least five preceding observations', validationStatus: 'ENGINEERING_HEURISTIC_ONLY; NOT_CLINICALLY_VALIDATED' },
      limitations: this.limitations(),
    };
  }

  private limitations() {
    return [
      'This endpoint produces descriptive statistics only; it does not predict future health outcomes or estimate disease risk.',
      'No clinically validated risk model or clinician-reviewed alert rules are configured.',
      'Linear slopes and personal-history deviations may be unstable and are not medical advice.',
      'Laboratory values are included only from patient-reviewed OCR. Review does not make OCR clinically verified.',
      'Only patient-owned records are used. No records are sent to an external AI provider by this analysis.',
      'BMI is not available in the current structured schema. Missing values are reported rather than inferred.',
    ];
  }
}
