'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../auth/api';
import { PatientShell } from './patient-shell';

export const documentCategories = [
  ['BLOOD_TEST', 'Blood test'],
  ['URINE_TEST', 'Urine test'],
  ['RADIOLOGY', 'Radiology'],
  ['X_RAY', 'X-ray'],
  ['MRI', 'MRI'],
  ['CT_SCAN', 'CT scan'],
  ['ULTRASOUND', 'Ultrasound'],
  ['PRESCRIPTION', 'Prescription'],
  ['DISCHARGE_SUMMARY', 'Discharge summary'],
  ['CONSULTATION_REPORT', 'Consultation report'],
  ['ECG', 'ECG'],
  ['OTHER', 'Other'],
] as const;

type MedicalDocument = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  documentDate: string | null;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  scanStatus?: 'CLEAN' | 'NOT_SCANNED';
  createdAt: string;
  updatedAt: string;
};
type ApiError = { message?: string | string[] };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const response = await fetch(`${API_BASE}/api/patient/documents${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as ApiError & T;
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new Error(message || 'Unable to complete this document request. Please try again.');
  }
  return body;
}

const input =
  'mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-100';
const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const categoryLabel = (value: string) =>
  documentCategories.find(([key]) => key === value)?.[1] ?? value;
const prettySize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const previewUrl = (id: string) =>
  `${API_BASE}/api/patient/documents/${encodeURIComponent(id)}/content`;
const maxUploadBytes = Number(
  process.env.NEXT_PUBLIC_MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES || 15 * 1024 * 1024,
);

export function MedicalRecordsPage() {
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [uploadedAfter, setUploadedAfter] = useState('');
  const [uploadedBefore, setUploadedBefore] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const filters = useMemo(
    () => ({
      search,
      category,
      dateFrom,
      dateTo,
      uploadedAfter,
      uploadedBefore,
      mimeType,
      page,
      refreshKey,
    }),
    [search, category, dateFrom, dateTo, uploadedAfter, uploadedBefore, mimeType, page, refreshKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ page: String(filters.page), limit: '20' });
      if (filters.search.trim()) query.set('q', filters.search.trim());
      if (filters.category) query.set('category', filters.category);
      if (filters.dateFrom) query.set('documentDateFrom', filters.dateFrom);
      if (filters.dateTo) query.set('documentDateTo', filters.dateTo);
      if (filters.uploadedAfter) query.set('uploadedAfter', filters.uploadedAfter);
      if (filters.uploadedBefore) query.set('uploadedBefore', filters.uploadedBefore);
      if (filters.mimeType) query.set('mimeType', filters.mimeType);
      setLoading(true);
      setError('');
      void request<{ documents: MedicalDocument[]; pagination: { total: number; pages: number } }>(
        `?${query}`,
        { signal: controller.signal },
      )
        .then((result) => {
          setDocuments(result.documents);
          setTotal(result.pagination.total);
          setPages(result.pagination.pages);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : 'Unable to load medical records.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, search]);

  return (
    <PatientShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-sky-700">
            Your health space
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Medical Records</h1>
          <p className="mt-2 text-slate-600">
            Your private reports, available when you’re signed in.
          </p>
        </div>
        <Link
          href="/medical-records/upload"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-sky-700 px-5 font-semibold text-white hover:bg-sky-800"
        >
          Upload report
        </Link>
      </div>
      <section className={`${card} mb-5`} aria-label="Search and filter medical records">
        <p className="mb-3 font-semibold">
          {total} {total === 1 ? 'document' : 'documents'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold">
            Search
            <input
              className={input}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Title or file name"
            />
          </label>
          <label className="text-sm font-semibold">
            Category
            <select
              className={input}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {documentCategories.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Report date from
            <input
              className={input}
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="text-sm font-semibold">
            Report date to
            <input
              className={input}
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="text-sm font-semibold">
            Upload date from
            <input
              className={input}
              type="date"
              value={uploadedAfter}
              onChange={(event) => {
                setUploadedAfter(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="text-sm font-semibold">
            Upload date to
            <input
              className={input}
              type="date"
              value={uploadedBefore}
              onChange={(event) => {
                setUploadedBefore(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="text-sm font-semibold">
            File type
            <select
              className={input}
              value={mimeType}
              onChange={(event) => {
                setMimeType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All file types</option>
              <option value="application/pdf">PDF</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
            </select>
          </label>
        </div>
      </section>
      {error && (
        <div role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-900">
          {error}
          <button
            onClick={() => setRefreshKey((value) => value + 1)}
            className="ml-3 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <p aria-live="polite">Loading medical records…</p>
      ) : documents.length === 0 ? (
        <section className={card}>
          <h2 className="text-lg font-bold">No reports found</h2>
          <p className="mt-2 text-slate-600">Upload a PDF or image to keep a copy here.</p>
        </section>
      ) : (
        <div className="grid gap-4">
          {documents.map((document) => (
            <article
              key={document.id}
              className={`${card} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
            >
              <div className="min-w-0">
                <h2 className="break-words text-lg font-bold">{document.title}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {categoryLabel(document.category)} ·{' '}
                  {document.mimeType === 'application/pdf'
                    ? 'PDF'
                    : document.mimeType.split('/')[1]?.toUpperCase()}{' '}
                  · {prettySize(document.fileSize)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Report date:{' '}
                  {document.documentDate
                    ? new Date(
                        `${document.documentDate.slice(0, 10)}T00:00:00`,
                      ).toLocaleDateString()
                    : 'Not provided'}{' '}
                  · Uploaded {new Date(document.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  className="inline-flex min-h-11 items-center rounded-xl border border-sky-200 px-4 font-semibold text-sky-800"
                  href={`/medical-records/${document.id}`}
                >
                  View
                </Link>
                <a
                  className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 font-semibold"
                  href={`${previewUrl(document.id)}?download=true`}
                >
                  Download
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <button
            className="min-h-11 rounded-xl border px-4 disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span aria-live="polite">
            Page {page} of {pages}
          </span>
          <button
            className="min-h-11 rounded-xl border px-4 disabled:opacity-50"
            disabled={page >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      )}
    </PatientShell>
  );
}

export function MedicalDocumentUploadPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [documentDate, setDocumentDate] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState('');
  const [activeXhr, setActiveXhr] = useState<XMLHttpRequest | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!file) {
      setError('Choose a PDF, JPEG or PNG file.');
      return;
    }
    if (file.size > maxUploadBytes) {
      setError(`Choose a file smaller than ${prettySize(maxUploadBytes)}.`);
      return;
    }
    const form = new FormData();
    if (title.trim()) form.append('title', title.trim());
    form.append('category', category);
    if (documentDate) form.append('documentDate', documentDate);
    if (description.trim()) form.append('description', description.trim());
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    setActiveXhr(xhr);
    setUploading(true);
    setProgress(0);
    xhr.open('POST', `${API_BASE}/api/patient/documents/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (progressEvent) => {
      if (progressEvent.lengthComputable)
        setProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
    };
    xhr.onerror = () => {
      setError('Upload failed. Check your connection and retry.');
      setUploading(false);
      setActiveXhr(null);
    };
    xhr.onabort = () => {
      setError(
        'Upload cancelled. If it had already completed, check your records before retrying.',
      );
      setUploading(false);
      setActiveXhr(null);
    };
    xhr.onload = () => {
      setUploading(false);
      setActiveXhr(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const result = JSON.parse(xhr.responseText) as { document: MedicalDocument };
        router.push(`/medical-records/${result.document.id}`);
        return;
      }
      let message = 'Upload failed. Please retry.';
      try {
        const body = JSON.parse(xhr.responseText) as ApiError;
        message = Array.isArray(body.message) ? body.message.join(' ') : body.message || message;
      } catch {
        /* Use a safe generic error. */
      }
      setError(message);
    };
    xhr.send(form);
  };

  const chooseFile = (selected: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(selected && selected.type.startsWith('image/') ? URL.createObjectURL(selected) : '');
  };

  return (
    <PatientShell>
      <div className="mb-6">
        <Link href="/medical-records" className="font-semibold text-sky-800">
          ← Medical records
        </Link>
        <h1 className="mt-4 text-3xl font-bold">Upload a report</h1>
        <p className="mt-2 text-slate-600">
          PDF, JPEG or PNG · maximum {prettySize(maxUploadBytes)}. Reports are private and not
          available offline.
        </p>
      </div>
      <form onSubmit={submit} className={`${card} grid gap-5`}>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Document title (optional)
            <input
              className={input}
              maxLength={180}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Annual blood test"
            />
          </label>
          <label className="text-sm font-semibold">
            Category
            <select
              required
              className={input}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {documentCategories.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Report date (optional)
            <input
              className={input}
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
            />
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            Description (optional)
            <textarea
              className={`${input} min-h-24 py-3`}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <label className="block rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/60 p-5 text-sm font-semibold text-slate-800">
          Select a report or use your camera
          <input
            className="mt-3 block min-h-12 w-full"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            capture="environment"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
          <span className="mt-2 block font-normal text-slate-600">
            Files are checked by type, signature and size on the server. Camera availability depends
            on your browser.
          </span>
        </label>
        {file && (
          <p role="status">
            Selected: {file.name} ({prettySize(file.size)})
          </p>
        )}
        {preview && (
          // Keep the user-selected image in memory; do not proxy it through Next's optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Preview of the selected report image"
            className="max-h-80 w-full rounded-xl border border-slate-200 object-contain"
          />
        )}
        {uploading && (
          <div>
            <progress className="h-3 w-full accent-sky-700" max={100} value={progress} />
            <p aria-live="polite" className="mt-1 text-sm">
              Uploading: {progress}%
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-900">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            disabled={uploading}
            className="min-h-12 rounded-xl bg-sky-700 px-5 font-semibold text-white disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : 'Upload report'}
          </button>
          {uploading ? (
            <button
              type="button"
              className="min-h-12 rounded-xl border px-5 font-semibold"
              onClick={() => activeXhr?.abort()}
            >
              Cancel upload
            </button>
          ) : (
            <Link
              href="/medical-records"
              className="inline-flex min-h-12 items-center rounded-xl border px-5 font-semibold"
            >
              Cancel
            </Link>
          )}
        </div>
      </form>
    </PatientShell>
  );
}

export function MedicalDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<MedicalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [documentDate, setDocumentDate] = useState('');
  const [description, setDescription] = useState('');
  const [ocrStatus, setOcrStatus] = useState<{ status: string; message: string; extractedText?: string | null; reviewedText?: string | null; extractedFields?: unknown[]; reviewedFields?: unknown[] | null; extractedMetadata?: Record<string, unknown> | null; reviewedMetadata?: Record<string, unknown> | null; retryAvailable?: boolean; reviewedAt?: string | null } | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [ocrFields, setOcrFields] = useState('[]');
  const [ocrMetadata, setOcrMetadata] = useState('{\n  "patientName": null,\n  "reportDate": null,\n  "laboratoryName": null,\n  "doctorComments": null\n}');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(true);
  const [ocrError, setOcrError] = useState(false);
  const content = previewUrl(params.id);
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    void request<{ document: MedicalDocument }>(`/${encodeURIComponent(params.id)}`)
      .then(({ document: value }) => {
        setDocument(value);
        setTitle(value.title);
        setCategory(value.category);
        setDocumentDate(value.documentDate?.slice(0, 10) ?? '');
        setDescription(value.description ?? '');
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load this report.'),
      )
      .finally(() => setLoading(false));
  }, [params.id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    let active = true;
    setOcrLoading(true);
    request<{ ocr: NonNullable<typeof ocrStatus> }>(`/${encodeURIComponent(params.id)}/ocr`)
      .then((result) => { if (active) { setOcrStatus(result.ocr); setOcrText(result.ocr.reviewedText ?? result.ocr.extractedText ?? ''); setOcrFields(JSON.stringify(result.ocr.reviewedFields ?? result.ocr.extractedFields ?? [], null, 2)); setOcrMetadata(JSON.stringify(result.ocr.reviewedMetadata ?? result.ocr.extractedMetadata ?? {patientName:null,reportDate:null,laboratoryName:null,doctorComments:null}, null, 2)); } })
      .catch(() => { if (active) setOcrError(true); })
      .finally(() => { if (active) setOcrLoading(false); });
    return () => { active = false; };
  }, [params.id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await request<{ document: MedicalDocument }>(
        `/${encodeURIComponent(params.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            category,
            documentDate: documentDate || null,
            description: description.trim() || null,
          }),
        },
      );
      setDocument(result.document);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save document details.');
    } finally {
      setSaving(false);
    }
  };

  const retryOcr = async () => {
    setOcrBusy(true); setOcrError(false);
    try { const result = await request<{ocr: NonNullable<typeof ocrStatus>}>(`/${encodeURIComponent(params.id)}/ocr/retry`, { method: 'POST', body: '{}' }); setOcrStatus(result.ocr); setOcrText(result.ocr.extractedText ?? ''); setOcrFields(JSON.stringify(result.ocr.extractedFields ?? [], null, 2)); setOcrMetadata(JSON.stringify(result.ocr.extractedMetadata ?? {patientName:null,reportDate:null,laboratoryName:null,doctorComments:null}, null, 2)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'OCR failed. Retry later.'); }
    finally { setOcrBusy(false); }
  };
  const saveOcrReview = async () => {
    setOcrBusy(true); setError('');
    try { const fields: unknown = JSON.parse(ocrFields); const metadata: unknown = JSON.parse(ocrMetadata); if (!Array.isArray(fields) || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Check the structured values and report details JSON.'); const result = await request<{ocr: {reviewedText:string; reviewedFields:unknown[]; reviewedMetadata:Record<string,unknown>; reviewedAt:string}}>(`/${encodeURIComponent(params.id)}/ocr/review`, {method:'PATCH',body:JSON.stringify({reviewedText:ocrText,reviewedFields:fields,reviewedMetadata:metadata})}); setOcrStatus(current => current ? {...current,reviewedText:result.ocr.reviewedText,reviewedFields:result.ocr.reviewedFields,reviewedMetadata:result.ocr.reviewedMetadata,reviewedAt:result.ocr.reviewedAt} : current); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save OCR review.'); }
    finally { setOcrBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this report? It will be removed from your HealthWallet records.'))
      return;
    setDeleting(true);
    setError('');
    try {
      await request(`/${encodeURIComponent(params.id)}`, { method: 'DELETE' });
      router.replace('/medical-records');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to delete this report. Retry the request.',
      );
      setDeleting(false);
    }
  };

  return (
    <PatientShell>
      <div className="mb-6">
        <Link href="/medical-records" className="font-semibold text-sky-800">
          ← Medical records
        </Link>
      </div>
      {loading ? (
        <p aria-live="polite">Loading report…</p>
      ) : error && !document ? (
        <div role="alert" className={`${card} text-rose-900`}>
          {error}
          <button onClick={load} className="ml-3 font-semibold underline">
            Retry
          </button>
        </div>
      ) : (
        document && (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-sky-700">
                  {categoryLabel(document.category)}
                </p>
                <h1 className="mt-2 break-words text-3xl font-bold">{document.title}</h1>
                <p className="mt-2 text-slate-600">
                  {document.originalFileName} · {prettySize(document.fileSize)} ·{' '}
                  {document.documentDate?.slice(0, 10) || 'No report date'}
                </p>
                {document.scanStatus === 'NOT_SCANNED' && (
                  <p className="mt-2 text-sm text-amber-800">
                    Development mode: antivirus scanning is not configured for this file.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setEditing(!editing)}
                  className="min-h-11 rounded-xl border px-4 font-semibold"
                >
                  {editing ? 'Close editor' : 'Edit details'}
                </button>
                <button
                  disabled={deleting}
                  onClick={() => void remove()}
                  className="min-h-11 rounded-xl border border-rose-200 px-4 font-semibold text-rose-800"
                >
                  {deleting ? 'Deleting…' : 'Delete report'}
                </button>
                <a
                  href={`${content}?download=true`}
                  className="inline-flex min-h-11 items-center rounded-xl bg-sky-700 px-4 font-semibold text-white"
                >
                  Download
                </a>
              </div>
            </div>
            {error && (
              <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-rose-900">
                {error}
              </p>
            )}
            {editing && (
              <form onSubmit={save} className={`${card} mb-5 grid gap-4`}>
                <label className="text-sm font-semibold">
                  Title
                  <input
                    className={input}
                    maxLength={180}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                </label>
                <label className="text-sm font-semibold">
                  Category
                  <select
                    className={input}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {documentCategories.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Report date
                  <input
                    className={input}
                    type="date"
                    value={documentDate}
                    onChange={(event) => setDocumentDate(event.target.value)}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Description
                  <textarea
                    className={`${input} min-h-24 py-3`}
                    maxLength={2000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <button
                  disabled={saving}
                  className="min-h-12 w-fit rounded-xl bg-sky-700 px-5 font-semibold text-white"
                >
                  {saving ? 'Saving…' : 'Save details'}
                </button>
              </form>
            )}
            <section className={`${card} mb-5`} aria-labelledby="ocr-heading">
              <h2 id="ocr-heading" className="text-lg font-bold">Report text extraction</h2>
              {ocrLoading ? <p className="mt-3 text-sm text-slate-600">Checking OCR status…</p> : ocrError ? (
                <div className="mt-3" role="status">
                  <p className="text-sm text-amber-900">OCR status could not be loaded. The original report is unchanged.</p>
                  <button onClick={() => { setOcrError(false); setOcrLoading(true); void request<{ ocr: { status: string; message: string } }>(`/${encodeURIComponent(params.id)}/ocr`).then((result) => setOcrStatus(result.ocr)).catch(() => setOcrError(true)).finally(() => setOcrLoading(false)); }} className="mt-2 min-h-10 font-semibold text-sky-800 underline">Retry status check</button>
                </div>
              ) : (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-700">Status: {ocrStatus?.status ?? 'UNKNOWN'}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{ocrStatus?.message ?? 'OCR is unavailable.'} OCR text is not verified medical information.</p>
                  {ocrStatus?.retryAvailable && <button disabled={ocrBusy} onClick={() => void retryOcr()} className="mt-3 min-h-10 rounded-lg bg-[#0d5b50] px-4 font-semibold text-white disabled:opacity-60">{ocrBusy ? 'Processing…' : ocrStatus.status === 'FAILED' ? 'Retry extraction' : 'Extract report text'}</button>}
                  {ocrStatus?.status === 'COMPLETED' && <div className="mt-4 space-y-3">
                    <p className="text-sm text-slate-600">Original file remains unchanged. OCR output is machine-extracted and is not a verified medical fact.</p>
                    <label className="block text-sm font-semibold">Extracted text — review and correct<textarea value={ocrText} onChange={event=>setOcrText(event.target.value)} maxLength={200000} className="mt-1 min-h-40 w-full rounded-xl border border-slate-300 p-3 font-normal" /></label>
                    <label className="block text-sm font-semibold">Structured values (JSON) — preserve units and stated ranges<textarea value={ocrFields} onChange={event=>setOcrFields(event.target.value)} className="mt-1 min-h-40 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs font-normal" /></label>
                    <label className="block text-sm font-semibold">Report details (JSON): patient name, date, lab and doctor comments<textarea value={ocrMetadata} onChange={event=>setOcrMetadata(event.target.value)} className="mt-1 min-h-32 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs font-normal" /></label>
                    <button disabled={ocrBusy} onClick={()=>void saveOcrReview()} className="min-h-11 rounded-xl bg-[#0d5b50] px-4 font-semibold text-white disabled:opacity-60">{ocrBusy?'Saving…':ocrStatus.reviewedAt?'Save corrections':'Confirm reviewed extraction'}</button>
                    {ocrStatus.reviewedAt && <p className="text-sm text-emerald-800">Patient reviewed {new Date(ocrStatus.reviewedAt).toLocaleString()}.</p>}
                  </div>}
                </>
              )}
            </section>
            <section className={`${card} min-h-[60vh]`} aria-label="Medical report preview">
              {document.mimeType === 'application/pdf' ? (
                <iframe
                  title={`Preview: ${document.title}`}
                  src={content}
                  className="h-[70vh] min-h-[480px] w-full rounded-xl border border-slate-200"
                />
              ) : (
                // This protected API image must bypass Next's optimizer so it retains cookie auth.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={content}
                  alt={`Medical report: ${document.title}`}
                  className="mx-auto max-h-[75vh] max-w-full rounded-xl object-contain"
                />
              )}
            </section>
          </>
        )
      )}
    </PatientShell>
  );
}
