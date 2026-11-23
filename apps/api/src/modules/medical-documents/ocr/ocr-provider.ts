export type ExtractedMedicalValue = {
  testName: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  abnormalFlag: string | null;
  confidence: 'HIGH' | 'REVIEW_REQUIRED';
  sourceLine: string;
};
export type ExtractedMedicalMetadata = { patientName: string | null; reportDate: string | null; laboratoryName: string | null; doctorComments: string | null };
export type OcrResult = { text: string; values: ExtractedMedicalValue[]; metadata: ExtractedMedicalMetadata; pageCount: number; engine: string };
export interface MedicalOcrProvider {
  readonly configured: boolean;
  extract(buffer: Buffer, mimeType: string): Promise<OcrResult>;
}
export const MEDICAL_OCR_PROVIDER = Symbol('MEDICAL_OCR_PROVIDER');
