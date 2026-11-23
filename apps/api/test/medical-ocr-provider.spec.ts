import { ConfigService } from '@nestjs/config';
import { parseOcrMetadata, TesseractMedicalOcrProvider } from '../src/modules/medical-documents/ocr/tesseract-ocr.provider';

function syntheticTextPdf(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf 50 740 Td (${escaped}) Tj ET`, 'ascii')} >>\nstream\nBT /F1 12 Tf 50 740 Td (${escaped}) Tj ET\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

function provider(enabled = true) {
  const config = {
    get: (key: string, fallback?: string) => key === 'OCR_PROVIDER' ? (enabled ? 'tesseract' : 'disabled') : fallback,
  } as ConfigService;
  return new TesseractMedicalOcrProvider(config);
}

describe('TesseractMedicalOcrProvider', () => {
  it('extracts text and preserves numeric results from a digital PDF without OCR', async () => {
    const text = 'Hemoglobin 12.5 g/dL reference range 12.0 - 16.0 g/dL';
    const result = await provider().extract(syntheticTextPdf(text), 'application/pdf');

    expect(result.engine).toBe('pdf-text');
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain(text);
    expect(result.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ testName: expect.stringContaining('Hemoglobin'), value: '12.5', confidence: 'REVIEW_REQUIRED' }),
    ]));
  });

  it('rejects unsupported content types', async () => {
    await expect(provider().extract(Buffer.from('not an image'), 'image/webp')).rejects.toThrow('OCR supports PDF, JPEG and PNG documents.');
  });

  it('does not process documents when the provider is disabled', async () => {
    await expect(provider(false).extract(Buffer.from('private'), 'application/pdf')).rejects.toThrow('OCR provider is not configured.');
  });

  it('extracts report details only from explicit labels and leaves missing values empty', () => {
    expect(parseOcrMetadata('Patient Name: Synthetic Patient\nReport Date: 2026-02-01\nLaboratory: Sample Lab\nDoctor Comments: Review with clinician')).toEqual({
      patientName: 'Synthetic Patient', reportDate: '2026-02-01', laboratoryName: 'Sample Lab', doctorComments: 'Review with clinician',
    });
    expect(parseOcrMetadata('Hemoglobin 12.5 g/dL')).toEqual({ patientName: null, reportDate: null, laboratoryName: null, doctorComments: null });
  });

  it('rejects images whose pixel size cannot be safely bounded before OCR', async () => {
    const pngHeader = Buffer.alloc(24);
    pngHeader.writeUInt32BE(100_000, 16); pngHeader.writeUInt32BE(100_000, 20);
    await expect(provider().extract(pngHeader, 'image/png')).rejects.toThrow('image exceeds the OCR pixel limit');
  });
});
