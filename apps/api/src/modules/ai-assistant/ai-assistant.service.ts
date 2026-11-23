import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { AI_PROVIDER, AiProvider } from './ai-provider';
import { MedicalKnowledgeService } from './medical-knowledge.service';
import { AI_PROMPT_VERSION, enforceLocalSafety } from './safety-policy';

const POLICY_VERSION = '2026-01';

@Injectable()
export class AiAssistantService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly limiter: SecurityRateLimiter, @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly knowledge: MedicalKnowledgeService) {}

  private configured() {
    return this.config.get<string>('AI_ASSISTANT_ENABLED') === 'true' &&
      this.config.get<string>('AI_ASSISTANT_PROVIDER') === 'openai' &&
      Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
  }
  async status(userId: string) {
    const consent = await this.prisma.aiProcessingConsent.findUnique({ where: { userId }, select: { grantedAt: true, withdrawnAt: true, policyVersion: true } });
    const providerConfigured = this.configured();
    return { enabled: providerConfigured, provider: providerConfigured ? 'openai' : 'disabled', providerHealthy: providerConfigured ? await this.provider.health() : false,
      consentGranted: Boolean(consent?.grantedAt && !consent.withdrawnAt), consentGrantedAt: consent?.grantedAt ?? null,
      policyVersion: POLICY_VERSION, externalProcessing: providerConfigured,
      message: providerConfigured ? 'When you ask a question, the question and the listed patient context are sent to OpenAI for processing. Responses may be inaccurate.' : 'AI is disabled until the backend provider and key are configured. No patient data is sent.' };
  }
  async grantConsent(userId: string) {
    const now = new Date();
    await this.prisma.aiProcessingConsent.upsert({ where: { userId }, create: { userId, grantedAt: now, withdrawnAt: null, policyVersion: POLICY_VERSION }, update: { grantedAt: now, withdrawnAt: null, policyVersion: POLICY_VERSION } });
    return { consentGranted: true, grantedAt: now, policyVersion: POLICY_VERSION };
  }
  async withdrawConsent(userId: string) {
    const now = new Date();
    await this.prisma.aiProcessingConsent.upsert({ where: { userId }, create: { userId, grantedAt: null, withdrawnAt: now, policyVersion: POLICY_VERSION }, update: { withdrawnAt: now } });
    return { consentGranted: false, withdrawnAt: now };
  }
  async query(userId: string, question: string, language: 'en' | 'hi') {
    this.limiter.consume(`ai:user:${userId}`, 10, 60_000);
    // Emergency and prohibited-treatment responses are local and require neither records nor external processing consent.
    const safetyResponse = enforceLocalSafety(question, language);
    if (safetyResponse) {
      await this.recordResponse(userId, safetyResponse.responseId);
      return { ...safetyResponse, disclaimer: 'This assistant is not an emergency service and does not diagnose or prescribe.' };
    }
    if (!this.configured()) throw new ServiceUnavailableException('AI is not configured. No records were sent.');
    const consent = await this.prisma.aiProcessingConsent.findUnique({ where: { userId }, select: { grantedAt: true, withdrawnAt: true } });
    if (!consent?.grantedAt || consent.withdrawnAt) throw new ForbiddenException('Explicit active AI processing consent is required.');
    const profile = await this.prisma.patientProfile.findUnique({ where: { userId }, select: { id: true, healthInformation: { select: { diabetesStatus: true, hypertensionStatus: true, allergies: true, existingMedicalConditions: true, currentMedications: true } } } });
    const profileId = profile?.id;
    if (!profileId) throw new ServiceUnavailableException('Complete your patient profile before using the assistant.');
    const [documents, bp, glucose] = await Promise.all([
      this.prisma.medicalDocument.findMany({ where: { patientProfileId: profileId, uploadedByUserId: userId, deletedAt: null, uploadStatus: 'AVAILABLE' }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }], take: 20, select: { id: true, title: true, category: true, documentDate: true, createdAt: true, ocrResult: { select: { reviewedText: true, reviewedFields: true, reviewedMetadata: true, reviewedAt: true } } } }),
      this.prisma.bloodPressureReading.findMany({ where: { patientProfileId: profileId, deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: 10, select: { systolic: true, diastolic: true, measuredAt: true } }),
      this.prisma.bloodGlucoseReading.findMany({ where: { patientProfileId: profileId, deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: 10, select: { glucoseValue: true, glucoseUnit: true, measurementType: true, measuredAt: true } }),
    ]);
    const queryText = question.toLocaleLowerCase();
    const broadRequest = /\b(all|overview|summary|summarize|my records|health history|last six months)\b|सभी|सारांश|मेरे रिकॉर्ड|स्वास्थ्य इतिहास|पिछले छह महीने/i.test(question);
    const reportRequest = broadRequest || /\b(report|reports|test|result|cbc|blood test|lab|hba1c|cholesterol|kidney|liver|thyroid|hemoglobin|glucose)\b|रिपोर्ट|जांच|जाँच|परिणाम|खून की जांच|रक्त जांच|एचबीए1सी|कोलेस्ट्रॉल|किडनी|लिवर|थायरॉइड|हीमोग्लोबिन|ग्लूकोज/i.test(question);
    const comparisonRequest = /\b(compare|comparison|previous|versus|\bvs\b)\b|तुलना|पहले|पिछली|बदलाव/i.test(question);
    const matchingDocuments = documents.filter(document => {
      const reviewedSearch = document.ocrResult?.reviewedAt ? `${document.ocrResult.reviewedText ?? ''} ${JSON.stringify(document.ocrResult.reviewedFields ?? [])}` : '';
      const searchable = `${document.title} ${document.category} ${reviewedSearch}`.toLocaleLowerCase();
      const terms = queryText.split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 4);
      return terms.some(term => searchable.includes(term));
    });
    const selectedDocuments = broadRequest ? documents.slice(0, 8) : matchingDocuments.length ? matchingDocuments.slice(0, 5) : reportRequest ? documents.slice(0, comparisonRequest ? 8 : 1) : [];
    const includeBloodPressure = broadRequest || /\b(blood pressure|pressure|hypertension|systolic|diastolic)\b|रक्तचाप|ब्लड प्रेशर|बीपी/i.test(question);
    const includeGlucose = broadRequest || /\b(glucose|blood sugar|sugar level|fasting sugar|hba1c)\b|रक्त शर्करा|ब्लड शुगर|शुगर|ग्लूकोज|एचबीए1सी/i.test(question);
    const selectedBp = includeBloodPressure ? bp : [];
    const selectedGlucose = includeGlucose ? glucose : [];
    const includeProfile = broadRequest || /\b(allergy|allergies|condition|diagnosed|medication|medicine|medicine list|my profile)\b|एलर्जी|दवाइ|दवा|बीमारी|स्थिति|मेरा प्रोफाइल/i.test(question);
    // Only patient-reviewed OCR is allowed into external AI context; original files and unreviewed text are excluded.
    const reviewedReports = selectedDocuments.filter(d => d.ocrResult?.reviewedAt && d.ocrResult.reviewedFields);
    const labGroups = new Map<string, Array<{ value: number; unit: string; date: Date; source: string; testName: string }>>();
    for (const doc of reviewedReports) {
      if (!Array.isArray(doc.ocrResult?.reviewedFields)) continue;
      const metadata = doc.ocrResult.reviewedMetadata && typeof doc.ocrResult.reviewedMetadata === 'object' && !Array.isArray(doc.ocrResult.reviewedMetadata)
        ? doc.ocrResult.reviewedMetadata as Record<string, unknown> : null;
      const reportDateText = typeof metadata?.reportDate === 'string' ? metadata.reportDate.trim() : '';
      const isoReportDate = /^\d{4}-\d{2}-\d{2}$/.test(reportDateText) ? new Date(`${reportDateText}T00:00:00.000Z`) : null;
      const reportDateValid = isoReportDate && Number.isFinite(isoReportDate.getTime()) && isoReportDate.toISOString().slice(0, 10) === reportDateText;
      const reportDate = reportDateValid ? isoReportDate : doc.documentDate;
      if (!reportDate) continue;
      for (const field of doc.ocrResult.reviewedFields) {
        if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
        const row = field as Record<string, unknown>;
        if (typeof row.testName !== 'string' || typeof row.value !== 'string') continue;
        const value = Number(row.value.replace(',', '.'));
        if (!Number.isFinite(value)) continue;
        const unit = typeof row.unit === 'string' ? row.unit.trim() : '';
        const testName = row.testName.trim();
        if (!testName) continue;
        const key = `${testName.toLocaleLowerCase()}|${unit.toLocaleLowerCase()}`;
        const entries = labGroups.get(key) ?? [];
        entries.push({ value, unit, date: reportDate, source: `Document ${doc.id}`, testName });
        labGroups.set(key, entries);
      }
    }
    const labComparisons = [...labGroups.values()].map(entries => entries.sort((a, b) => a.date.getTime() - b.date.getTime()))
      .filter(entries => entries.length >= 2)
      .map(entries => {
        const previous = entries.at(-2)!;
        const current = entries.at(-1)!;
        return { testName: current.testName, unit: current.unit || null, previous: { value: previous.value, date: previous.date, source: previous.source }, current: { value: current.value, date: current.date, source: current.source }, absoluteChange: current.value - previous.value, note: 'Numeric comparison only; not a clinical interpretation.' };
      });
    const orderedBp = [...selectedBp].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
    const bpTrend = orderedBp.length >= 2 ? {
      first: { systolic: orderedBp[0]!.systolic, diastolic: orderedBp[0]!.diastolic, date: orderedBp[0]!.measuredAt },
      latest: { systolic: orderedBp.at(-1)!.systolic, diastolic: orderedBp.at(-1)!.diastolic, date: orderedBp.at(-1)!.measuredAt },
      change: { systolic: orderedBp.at(-1)!.systolic - orderedBp[0]!.systolic, diastolic: orderedBp.at(-1)!.diastolic - orderedBp[0]!.diastolic },
      note: 'Numeric comparison only; not a clinical interpretation.',
    } : null;
    const glucoseGroups = new Map<string, typeof selectedGlucose>();
    for (const reading of selectedGlucose) {
      const key = `${reading.glucoseUnit}|${reading.measurementType}`;
      glucoseGroups.set(key, [...(glucoseGroups.get(key) ?? []), reading]);
    }
    const glucoseTrends = [...glucoseGroups.values()].filter(readings => readings.length >= 2).map(readings => {
      const ordered = [...readings].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
      const first = ordered[0]!, latest = ordered.at(-1)!;
      return { unit: first.glucoseUnit, measurementType: first.measurementType,
        first: { value: Number(first.glucoseValue), date: first.measuredAt },
        latest: { value: Number(latest.glucoseValue), date: latest.measuredAt },
        change: Number(latest.glucoseValue) - Number(first.glucoseValue),
        note: 'Compared only within matching unit and measurement type; numeric comparison only.' };
    });
    const knowledge = await this.knowledge.retrieve(question);
    const context = JSON.stringify({
      healthInformation: includeProfile ? profile.healthInformation : null,
      documents: selectedDocuments.map(d => ({ source: `Document ${d.id}`, title: d.title, category: d.category, date: d.documentDate, uploadedAt: d.createdAt,
        reviewedExtract: d.ocrResult?.reviewedAt ? { reviewDate: d.ocrResult.reviewedAt, text: d.ocrResult.reviewedText, values: d.ocrResult.reviewedFields, reportDetails: d.ocrResult.reviewedMetadata, provenance: 'Patient-reviewed OCR, not clinically verified' } : null })),
      labComparisons,
      trackedHealthComparisons: { bloodPressure: bpTrend, glucose: glucoseTrends },
      curatedMedicalKnowledge: knowledge,
      bloodPressure: selectedBp,
      glucose: selectedGlucose.map(r => ({ ...r, glucoseValue: Number(r.glucoseValue) })),
    });
    try {
      const answer = await this.provider.answer({ question: question.trim(), language, context });
      const responseId = randomUUID();
      await this.recordResponse(userId, responseId);
      return { responseId, answer, promptVersion: AI_PROMPT_VERSION, sources: [
        ...selectedDocuments.map(d => ({ type: 'document-metadata', id: d.id, title: d.title, date: d.documentDate })),
        ...selectedBp.map(r => ({ type: 'blood-pressure', date: r.measuredAt })), ...selectedGlucose.map(r => ({ type: 'glucose', date: r.measuredAt })),
        ...knowledge.map(k => ({ type: 'medical-knowledge', id: k.source.id, title: k.source.title, sourceName: k.source.sourceName, url: k.source.sourceUrl, version: k.source.version })),
      ], disclaimer: 'Educational information only; not a diagnosis or treatment advice. Contact a qualified clinician. Seek urgent care for severe or sudden symptoms.' };
    } catch {
      throw new ServiceUnavailableException('The AI service is temporarily unavailable. Retry later; your question was not saved.');
    }
  }

  async submitFeedback(userId: string, responseId: string, rating: 'HELPFUL' | 'NOT_HELPFUL', category?: 'INCORRECT_INFORMATION' | 'MISSING_CONTEXT' | 'REPORT_INTERPRETATION' | 'LANGUAGE_QUALITY' | 'OTHER') {
    this.limiter.consume(`ai-feedback:${userId}`, 20, 60_000);
    try {
      const now = new Date();
      await this.prisma.aiResponseReceipt.deleteMany({ where: { expiresAt: { lte: now } } });
      const receipt = await this.prisma.aiResponseReceipt.findFirst({ where: { userId, responseId, expiresAt: { gt: now } }, select: { id: true } });
      if (!receipt) throw new NotFoundException('Response not found or feedback period expired.');
      const feedback = await this.prisma.aiResponseFeedback.create({ data: { userId, responseId, rating, ...(category ? { category } : {}) } });
      return { submitted: true, id: feedback.id };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('Feedback for this response was already submitted.');
      throw error;
    }
  }

  private async recordResponse(userId: string, responseId: string) {
    const now = new Date();
    await this.prisma.aiResponseReceipt.deleteMany({ where: { expiresAt: { lte: now } } });
    await this.prisma.aiResponseReceipt.create({ data: { userId, responseId, expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } });
  }
}
