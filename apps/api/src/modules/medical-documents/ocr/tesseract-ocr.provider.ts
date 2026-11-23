import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { ExtractedMedicalMetadata, ExtractedMedicalValue, MedicalOcrProvider, OcrResult } from './ocr-provider';

const MAX_PAGES = 12;
const MAX_TEXT = 200_000;
const MAX_IMAGE_PIXELS = 24_000_000;
type PdfJsModule = {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
};
type PdfLoadingTask = { promise: Promise<PdfDocument>; destroy(): Promise<void> };
type PdfDocument = {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
};
type PdfPage = {
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: unknown; viewport: unknown; canvas: unknown }): { promise: Promise<void> };
};
const importPdfJs = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

function parseValues(text: string): ExtractedMedicalValue[] {
  const values: ExtractedMedicalValue[] = [];
  for (const line of text.split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
    const flagMatch = line.match(/\b(H|L|HIGH|LOW|ABNORMAL)\s*$/i);
    const withoutFlag = flagMatch ? line.slice(0, flagMatch.index).trim() : line;
    const rangeMatch = withoutFlag.match(/(?:\s+(?:ref(?:erence)?\s*)?range\s*[:=]?\s*)?([<>≤≥]?\s*-?\d+(?:[.,]\d+)?\s*(?:-|to|–)\s*[<>≤≥]?\s*-?\d+(?:[.,]\d+)?)(?:\s*[a-zA-Z%µμ/³^0-9.-]{1,24})?\s*$/i);
    const beforeRange = rangeMatch?.index !== undefined ? withoutFlag.slice(0, rangeMatch.index).trim() : withoutFlag;
    const resultMatch = beforeRange.match(/^(.{2,90}?)\s+(-?\d+(?:[.,]\d+)?)(?:\s*([a-zA-Z%µμ/³^0-9.-]{1,24}))?\s*$/);
    if (!resultMatch) continue;
    values.push({ testName: resultMatch[1]!.trim(), value: resultMatch[2]!.replace(',', '.'), unit: resultMatch[3]?.trim() ?? null,
      referenceRange: rangeMatch?.[1]?.trim() ?? null, abnormalFlag: flagMatch?.[1]?.toUpperCase() ?? null,
      confidence: 'REVIEW_REQUIRED', sourceLine: line });
  }
  return values.slice(0, 1000);
}

function labeledValue(text: string, labels: string): string | null {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*[:#-]\\s*([^\\n]{1,240})`, 'i'));
  return match?.[1]?.trim() || null;
}

export function parseOcrMetadata(text: string): ExtractedMedicalMetadata {
  return {
    patientName: labeledValue(text, 'patient\\s+name|name\\s+of\\s+patient'),
    reportDate: labeledValue(text, 'report\\s+date|collection\\s+date|specimen\\s+date'),
    laboratoryName: labeledValue(text, 'laboratory|lab\\s+name|diagnostic\\s+centre'),
    doctorComments: labeledValue(text, "doctor(?:'s)?\\s+comments?|physician(?:'s)?\\s+comments?|remarks"),
  };
}

function imagePixels(buffer: Buffer, mimeType: string): number {
  if (mimeType === 'image/png') {
    if (buffer.length < 24) throw new UnprocessableEntityException('The image header is incomplete.');
    return buffer.readUInt32BE(16) * buffer.readUInt32BE(20);
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width * height;
    }
    offset += 2 + length;
  }
  throw new UnprocessableEntityException('The JPEG image dimensions could not be verified.');
}

@Injectable()
export class TesseractMedicalOcrProvider implements MedicalOcrProvider {
  private readonly language: string;
  private readonly languagePath?: string;
  readonly configured: boolean;
  constructor(config: ConfigService) {
    this.language = config.get<string>('OCR_LANGUAGES', 'eng');
    const languagePath = config.get<string>('OCR_LANG_PATH')?.trim();
    if (languagePath) this.languagePath = languagePath;
    this.configured = config.get<string>('OCR_PROVIDER', 'disabled') === 'tesseract';
    // PDF.js needs canvas browser primitives in Node for scanned-page rendering.
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  }

  async extract(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    if (!this.configured) throw new ServiceUnavailableException('OCR provider is not configured.');
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    let pdfLoadingTask: PdfLoadingTask | undefined;
    try {
      if (mimeType === 'application/pdf') {
        const pdfjs = await importPdfJs('pdfjs-dist/legacy/build/pdf.mjs') as PdfJsModule;
        const loadingTask = pdfLoadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
        const doc = await loadingTask.promise;
        if (!Number.isInteger(doc.numPages) || doc.numPages < 1 || doc.numPages > MAX_PAGES) throw new UnprocessableEntityException(`PDF must contain ${MAX_PAGES} pages or fewer.`);
        const digital: string[] = [];
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
          const page = await doc.getPage(pageNo);
          const content = await page.getTextContent();
          const lines = new Map<number, string[]>();
          for (const item of content.items) {
            if (!item.str?.trim()) continue;
            const y = Math.round(item.transform?.[5] ?? 0);
            lines.set(y, [...(lines.get(y) ?? []), item.str.trim()]);
          }
          digital.push([...lines.entries()].sort(([a], [b]) => b - a).map(([, parts]) => parts.join(' ')).join('\n'));
        }
        const digitalText = digital.join('\n').trim();
        if (digitalText.replace(/\s/g, '').length >= 40) return this.result(digitalText, doc.numPages, 'pdf-text');
        worker = await createWorker(this.language, 1, { logger: () => undefined, ...(this.languagePath ? { langPath: this.languagePath } : {}) });
        const pages: string[] = [];
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
          const page = await doc.getPage(pageNo);
          const viewport = page.getViewport({ scale: 1.6 });
          if (viewport.width * viewport.height > 24_000_000) throw new UnprocessableEntityException('A PDF page exceeds the OCR processing limit.');
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
          const output = await worker.recognize(await canvas.encode('png'));
          pages.push(output.data.text);
        }
        return this.result(pages.join('\n'), doc.numPages, 'tesseract-image-ocr');
      }
      if (!['image/jpeg', 'image/png'].includes(mimeType)) throw new UnprocessableEntityException('OCR supports PDF, JPEG and PNG documents.');
      const pixels = imagePixels(buffer, mimeType);
      if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > MAX_IMAGE_PIXELS) throw new UnprocessableEntityException('The image exceeds the OCR pixel limit.');
      worker = await createWorker(this.language, 1, { logger: () => undefined, ...(this.languagePath ? { langPath: this.languagePath } : {}) });
      const output = await worker.recognize(buffer);
      return this.result(output.data.text, 1, 'tesseract-image-ocr');
    } catch (error) {
      if (error instanceof UnprocessableEntityException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('OCR processing failed. The original document is unchanged.');
    } finally {
      await worker?.terminate().catch(() => undefined);
      await pdfLoadingTask?.destroy().catch(() => undefined);
    }
  }
  private result(text: string, pageCount: number, engine: string): OcrResult {
    const clipped = text.slice(0, MAX_TEXT);
    return { text: clipped, values: parseValues(clipped), metadata: parseOcrMetadata(clipped), pageCount, engine };
  }
}
