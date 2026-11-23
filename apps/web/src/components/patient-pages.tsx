'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { patientRequest } from '../auth/patient-api';
import { PatientShell } from './patient-shell';
import type {
  PatientHealthInformation,
  PatientProfile,
  PatientProfileCompletion,
} from '@healthvault/shared';
import { isIndiaPostalCode, normalizeIndiaMobile } from '@healthvault/validation';

type Profile = PatientProfile;
type Health = Pick<
  PatientHealthInformation,
  | 'diabetesStatus'
  | 'hypertensionStatus'
  | 'allergies'
  | 'existingMedicalConditions'
  | 'currentMedications'
  | 'additionalNotes'
>;
type Completion = PatientProfileCompletion;
type DashboardDocument = {
  id: string;
  title: string;
  category: string;
  documentDate: string | null;
  createdAt: string;
};
type DashboardBloodPressure = {
  id: string;
  systolic: number;
  diastolic: number;
  heartRate: number | null;
  measuredAt: string;
};
type DashboardGlucose = {
  id: string;
  glucoseValue: number;
  glucoseUnit: 'MG_DL' | 'MMOL_L';
  measurementType: string;
  measuredAt: string;
};
type DashboardOverview = {
  documents: DashboardDocument[];
  bloodPressure: DashboardBloodPressure[];
  glucose: DashboardGlucose[];
  accessRequests: Array<{ id: string; requestedAt: string; expiresAt: string }>;
  sentInvitations: Array<{
    id: string;
    status: string;
    createdAt: string;
    familyMember: { fullName: string; relationship: string };
  }>;
  receivedInvitations: Array<{
    id: string;
    status: string;
    createdAt: string;
    familyMember: { fullName: string; relationship: string };
  }>;
};
const inputClass =
  'mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100';
const labelClass = 'block text-sm font-semibold text-slate-700';
const cardClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';

function Heading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-sky-700">
          Your health space
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-2 text-slate-600">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function useLoad<T>(path: string, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    patientRequest<Record<string, T | null>>(path)
      .then((r) => {
        if (active) setData(r[key] ?? null);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load information.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, key]);
  return { data, loading, error };
}

export function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [patientName, setPatientName] = useState('');
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(false);
  const [intelligence, setIntelligence] = useState<{ insights: Array<{title:string;why:string}>; pendingOcrReviews:number; trends:Array<{testName?:string;type?:string;change?:number}>; disclaimer:string } | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<{ answer: string; sources: Array<{ id?: string; title?: string; date?: string | null; type: string }> } | null>(null);
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState('');
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);
  useEffect(() => {
    if (user?.role === 'PATIENT') {
      patientRequest<unknown>('/health-intelligence/overview')
        .then((result) => {
          if (result && typeof result === 'object' && 'insights' in result && Array.isArray(result.insights) && 'trends' in result && Array.isArray(result.trends)) setIntelligence(result as NonNullable<typeof intelligence>);
          else setIntelligence(null);
        })
        .catch(() => setIntelligence(null))
        .finally(() => setIntelligenceLoading(false));
      patientRequest<Completion>('/profile/completion')
        .then(setCompletion)
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'Unable to load profile status.'),
        );
      patientRequest<{ profile: Pick<PatientProfile, 'fullName'> | null }>('/profile')
        .then((result) => setPatientName(result.profile?.fullName ?? ''))
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'Unable to load your profile.'),
        );
      void Promise.allSettled([
        patientRequest<{ documents: DashboardDocument[] }>('/documents?page=1&limit=5'),
        patientRequest<{ readings: DashboardBloodPressure[] }>(
          '/health-tracking/blood-pressure?page=1&pageSize=5',
        ),
        patientRequest<{ readings: DashboardGlucose[] }>(
          '/health-tracking/blood-glucose?page=1&pageSize=5',
        ),
        patientRequest<{ requests: DashboardOverview['accessRequests'] }>('/sharing/requests'),
        patientRequest<{
          sentInvitations: DashboardOverview['sentInvitations'];
          receivedInvitations: DashboardOverview['receivedInvitations'];
        }>('/family/invitations'),
      ]).then((results) => {
        const [documents, bloodPressure, glucose, requests, invitations] = results;
        const hasDocuments = documents.status === 'fulfilled' && Array.isArray(documents.value.documents);
        const hasBloodPressure = bloodPressure.status === 'fulfilled' && Array.isArray(bloodPressure.value.readings);
        const hasGlucose = glucose.status === 'fulfilled' && Array.isArray(glucose.value.readings);
        const hasRequests = requests.status === 'fulfilled' && Array.isArray(requests.value.requests);
        const hasInvitations = invitations.status === 'fulfilled' && Array.isArray(invitations.value.sentInvitations) && Array.isArray(invitations.value.receivedInvitations);
        setOverview({
          documents: hasDocuments ? documents.value.documents : [],
          bloodPressure: hasBloodPressure ? bloodPressure.value.readings : [],
          glucose: hasGlucose ? glucose.value.readings : [],
          accessRequests: hasRequests ? requests.value.requests : [],
          sentInvitations: hasInvitations ? invitations.value.sentInvitations : [],
          receivedInvitations: hasInvitations ? invitations.value.receivedInvitations : [],
        });
        setOverviewError(
          results.some((result) => result.status === 'rejected') ||
            !hasDocuments || !hasBloodPressure || !hasGlucose || !hasRequests || !hasInvitations,
        );
      }).finally(() => setOverviewLoading(false));
    }
  }, [user]);
  async function generateAiSummary() {
    setAiSummaryBusy(true); setAiSummaryError('');
    try {
      const status = await patientRequest<{ enabled: boolean; providerHealthy: boolean; consentGranted: boolean }>('/ai-assistant/status');
      if (!status.enabled || !status.providerHealthy) { setAiSummaryError('AI is unavailable until the backend provider is configured. No patient data was sent.'); return; }
      if (!status.consentGranted) { setAiSummaryError('Give AI processing consent in the AI assistant before requesting a summary. No patient data was sent.'); return; }
      const result = await patientRequest<{ answer: string; sources: Array<{ id?: string; title?: string; date?: string | null; type: string }> }>('/ai-assistant/query', { method: 'POST', body: JSON.stringify({ question: 'Summarize my recent health records and measurements. Cite the records and dates used. State what is missing and do not diagnose or recommend treatment.', language: 'en' }) });
      setAiSummary(result);
    } catch { setAiSummaryError('Could not prepare the AI summary. Your question was not saved; retry from the AI assistant.'); }
    finally { setAiSummaryBusy(false); }
  }
  if (authLoading || !user)
    return (
      <main
        className="grid min-h-screen place-items-center bg-sky-50 text-slate-600"
        aria-live="polite"
      >
        Checking your session…
      </main>
    );
  if (user.role !== 'PATIENT')
    return (
      <main className="grid min-h-screen place-items-center bg-sky-50 px-5">
        <section className={cardClass}>
          <h1 className="text-2xl font-bold">Your HealthWallet account</h1>
          <p className="mt-3 text-slate-600">Mobile number: {user.phoneNumber}</p>
          <p className="mt-2 text-slate-600">
            Role: {user.role}
            {user.role === 'DOCTOR'
              ? ` · Verification ${user.doctorVerificationStatus?.toLowerCase()}`
              : ''}
          </p>
          <p className="mt-4 max-w-lg text-sm text-slate-600">
            Patient profile tools are available to patient accounts.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-sky-700 px-4 font-semibold text-white"
          >
            Home
          </Link>
        </section>
      </main>
    );
  return (
    <PatientShell>
      <Heading
        title={patientName ? `Welcome back, ${patientName}` : 'Welcome to your dashboard'}
        subtitle="Your details stay attached to your account and are available when you sign in on another device."
      />
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-rose-800">
          {error}
        </p>
      )}
      <section className={`${cardClass} grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center`}>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Complete your profile</h2>
          <p className="mt-1 text-slate-600">
            Add a few details so your information is ready when you need it.
          </p>
          <p className="mt-4 text-sm font-semibold text-slate-700">
            {completion?.completionPercent ?? 0}% complete
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Profile completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion?.completionPercent ?? 0}
          >
            <div
              className="h-full rounded-full bg-sky-600"
              style={{ width: `${completion?.completionPercent ?? 0}%` }}
            />
          </div>
          {completion?.missingFields.length ? (
            <p className="mt-2 text-sm text-slate-500">
              Recommended next:{' '}
              {completion.missingFields
                .join(', ')
                .replaceAll(/([A-Z])/g, ' $1')
                .toLowerCase()}
            </p>
          ) : null}
        </div>
        <Link
          href="/profile/edit"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-sky-700 px-5 font-semibold text-white hover:bg-sky-800"
        >
          Update profile
        </Link>
      </section>
      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Latest health records">
        <article className={`${cardClass} p-5`}>
          <h2 className="font-bold">Latest blood pressure</h2>
          {overviewLoading ? <p className="mt-3 text-sm text-slate-500">Loading…</p> :
            overview?.bloodPressure[0] ? (
              <p className="mt-3 text-2xl font-bold tabular-nums">
                {overview.bloodPressure[0].systolic}/{overview.bloodPressure[0].diastolic} <span className="text-sm font-medium">mmHg</span>
              </p>
            ) : <p className="mt-3 text-sm text-slate-500">No reading recorded.</p>}
          {overview?.bloodPressure[0] && <p className="mt-1 text-xs text-slate-500">{new Date(overview.bloodPressure[0].measuredAt).toLocaleString()}</p>}
        </article>
        <article className={`${cardClass} p-5`}>
          <h2 className="font-bold">Latest blood glucose</h2>
          {overviewLoading ? <p className="mt-3 text-sm text-slate-500">Loading…</p> :
            overview?.glucose[0] ? (
              <p className="mt-3 text-2xl font-bold tabular-nums">
                {overview.glucose[0].glucoseValue} <span className="text-sm font-medium">{overview.glucose[0].glucoseUnit === 'MG_DL' ? 'mg/dL' : 'mmol/L'}</span>
              </p>
            ) : <p className="mt-3 text-sm text-slate-500">No reading recorded.</p>}
          {overview?.glucose[0] && <p className="mt-1 text-xs text-slate-500">{new Date(overview.glucose[0].measuredAt).toLocaleString()}</p>}
        </article>
        <Link href="/sharing/requests" className={`${cardClass} p-5 hover:border-sky-300`}>
          <h2 className="font-bold">Doctor access requests</h2>
          <p className="mt-3 text-2xl font-bold tabular-nums">{overviewLoading ? '…' : overview?.accessRequests.length ?? '—'}</p>
          <p className="mt-1 text-sm text-slate-500">Pending your review · View requests</p>
        </Link>
        <Link href="/family/invitations" className={`${cardClass} p-5 hover:border-sky-300`}>
          <h2 className="font-bold">Family invitations</h2>
          <p className="mt-3 text-2xl font-bold tabular-nums">
            {overviewLoading ? '…' : (overview?.sentInvitations.filter((item) => item.status === 'PENDING').length ?? 0) + (overview?.receivedInvitations.length ?? 0)}
          </p>
          <p className="mt-1 text-sm text-slate-500">Pending · View status</p>
        </Link>
      </section>
      <section className={`${cardClass} mt-5`} aria-labelledby="intelligence-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="intelligence-heading" className="text-lg font-bold">Your health record overview</h2><p className="mt-1 text-sm text-slate-600">Grounded in your uploaded reports and measurements; no diagnosis or treatment advice.</p></div><div className="flex flex-wrap gap-4"><Link href="/ai-assistant" className="font-semibold text-sky-800">Ask AI for a summary →</Link><Link href="/health-insights" className="font-semibold text-sky-800">View trends and compare →</Link></div></div>
        {intelligenceLoading ? <p className="mt-4 text-sm text-slate-500">Loading record observations…</p> : intelligence ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><article className="rounded-xl bg-slate-50 p-4"><p className="font-semibold">Reports awaiting your OCR review</p><p className="mt-1 text-2xl font-bold">{intelligence.pendingOcrReviews}</p><Link href="/medical-records" className="text-sm font-semibold text-sky-800">Review reports</Link></article><article className="rounded-xl bg-slate-50 p-4"><p className="font-semibold">Historical values with multiple readings</p><p className="mt-1 text-2xl font-bold">{intelligence.trends.length}</p><p className="text-sm text-slate-600">Compatible values are compared only within matching units.</p></article>{intelligence.insights.slice(0,2).map((item,i)=><article key={i} className="rounded-xl border p-4 sm:col-span-2"><p className="font-semibold">{item.title}</p><p className="mt-1 text-sm leading-6 text-slate-600">{item.why}</p></article>)}</div> : <p className="mt-4 text-sm text-slate-600">Record observations are unavailable. Open Health insights to retry.</p>}
        <div className="mt-4 border-t pt-4"><div className="flex flex-wrap items-center gap-3"><button onClick={() => void generateAiSummary()} disabled={aiSummaryBusy} className="min-h-10 rounded-xl bg-[#0d5b50] px-4 text-sm font-semibold text-white disabled:opacity-50">{aiSummaryBusy ? 'Preparing summary…' : 'Generate AI summary'}</button><Link href="/ai-assistant" className="text-sm font-semibold text-sky-800">Open AI assistant</Link></div>{aiSummaryError && <p role="status" className="mt-3 text-sm text-amber-900">{aiSummaryError}</p>}{aiSummary && <article className="mt-3 rounded-xl bg-slate-50 p-4"><h3 className="font-semibold">AI-generated explanation · educational only</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{aiSummary.answer}</p>{aiSummary.sources.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-600">{aiSummary.sources.map((source,i)=><li key={`${source.id??source.type}-${i}`}>{source.id&&source.type==='document-metadata'?<Link href={`/medical-records/${source.id}`} className="underline">{source.title??'Report'}</Link>:source.title??source.type}{source.date?` · ${new Date(source.date).toLocaleDateString()}`:''}</li>)}</ul>}</article>}</div>
        {intelligence && <p className="mt-3 text-xs leading-5 text-slate-500">{intelligence.disclaimer}</p>}
      </section>
      {overviewError && <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Some dashboard summaries could not be loaded. Open the relevant section to retry.</p>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className={cardClass} aria-labelledby="recent-reports-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-reports-heading" className="text-lg font-bold">Recent medical reports</h2>
            <Link href="/medical-records" className="text-sm font-semibold text-sky-800">All reports</Link>
          </div>
          {overviewLoading ? <p className="mt-4 text-sm text-slate-500">Loading reports…</p> :
            overview?.documents.length ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {overview.documents.slice(0, 4).map((document) => (
                  <li key={document.id} className="py-3">
                    <Link href={`/medical-records/${encodeURIComponent(document.id)}`} className="font-semibold text-sky-900 hover:underline">{document.title}</Link>
                    <p className="mt-1 text-xs text-slate-500">{document.category.replaceAll('_', ' ')} · {document.documentDate?.slice(0, 10) ?? new Date(document.createdAt).toLocaleDateString()}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-slate-500">No reports are stored yet.</p>}
        </section>
        <section className={cardClass} aria-labelledby="health-timeline-heading">
          <h2 id="health-timeline-heading" className="text-lg font-bold">Health record timeline</h2>
          {overviewLoading ? <p className="mt-4 text-sm text-slate-500">Loading timeline…</p> : (() => {
            const events = [
              ...(overview?.documents ?? []).map((item) => ({ id: `doc-${item.id}`, date: item.documentDate ?? item.createdAt, label: `Report: ${item.title}`, href: `/medical-records/${encodeURIComponent(item.id)}` })),
              ...(overview?.bloodPressure ?? []).map((item) => ({ id: `bp-${item.id}`, date: item.measuredAt, label: `Blood pressure recorded: ${item.systolic}/${item.diastolic} mmHg`, href: '/health-tracking' })),
              ...(overview?.glucose ?? []).map((item) => ({ id: `glucose-${item.id}`, date: item.measuredAt, label: `Blood glucose recorded: ${item.glucoseValue} ${item.glucoseUnit === 'MG_DL' ? 'mg/dL' : 'mmol/L'}`, href: '/health-tracking' })),
            ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 7);
            return events.length ? <ol className="mt-3 space-y-3 border-l-2 border-sky-100 pl-4">{events.map((event) => <li key={event.id}><Link href={event.href} className="font-medium text-slate-800 hover:text-sky-800">{event.label}</Link><p className="text-xs text-slate-500">{new Date(event.date).toLocaleDateString()}</p></li>)}</ol> : <p className="mt-4 text-sm text-slate-500">Your timeline will appear when you add a report or tracking entry.</p>;
          })()}
        </section>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Link href="/profile" className={`${cardClass} block hover:border-sky-300`}>
          <h2 className="text-lg font-bold">Personal profile</h2>
          <p className="mt-2 leading-6 text-slate-600">
            Manage your name, contact details and emergency contact.
          </p>
          <span className="mt-4 inline-block font-semibold text-sky-800">View profile →</span>
        </Link>
        <Link href="/health-information" className={`${cardClass} block hover:border-sky-300`}>
          <h2 className="text-lg font-bold">Health information</h2>
          <p className="mt-2 leading-6 text-slate-600">
            Save health details you choose to provide. These are patient-provided and not a
            diagnosis.
          </p>
          <span className="mt-4 inline-block font-semibold text-sky-800">
            View health information →
          </span>
        </Link>
      </div>
    </PatientShell>
  );
}

export function ProfilePage() {
  const { data, loading, error } = useLoad<Profile>('/profile', 'profile');
  const address = [
    data?.addressLine1,
    data?.addressLine2,
    data?.city,
    data?.state,
    data?.postalCode,
    data?.country,
  ]
    .filter(Boolean)
    .join(', ');
  const contact = [data?.emergencyContactName, data?.emergencyContactPhone]
    .filter(Boolean)
    .join(' · ');
  const fields: Array<[string, string | null | undefined]> = [
    ['Full name', data?.fullName],
    ['Mobile number', data?.mobileNumber],
    ['Date of birth', data?.dateOfBirth?.slice(0, 10)],
    ['Gender', data?.gender?.replaceAll('_', ' ')],
    ['Blood group', data?.bloodGroup?.replaceAll('_', ' ')],
    ['Address', address],
    ['Emergency contact', contact],
  ];
  return (
    <PatientShell>
      <Heading
        title="My profile"
        subtitle="Personal information saved to your HealthWallet account."
        action={
          <Link
            href="/profile/edit"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-sky-700 px-4 font-semibold text-white"
          >
            Edit profile
          </Link>
        }
      />
      {loading ? (
        <p aria-live="polite">Loading your profile…</p>
      ) : error ? (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">
          {error}
        </p>
      ) : (
        <section className={cardClass}>
          {!data?.fullName && (
            <p className="mb-5 rounded-xl bg-sky-50 p-4 text-sky-900">
              Your profile is ready for details. Add only what you want to keep here.
            </p>
          )}
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm font-semibold text-slate-500">{label}</dt>
                <dd className="mt-1 break-words font-medium text-slate-900">
                  {value || 'Not provided'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </PatientShell>
  );
}

const emptyProfile = {
  fullName: '',
  dateOfBirth: '',
  gender: '',
  bloodGroup: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};
export function EditProfilePage() {
  const router = useRouter();
  const { data, loading, error: loadError } = useLoad<Profile>('/profile', 'profile');
  const [values, setValues] = useState(emptyProfile);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data)
      setValues({
        fullName: data.fullName ?? '',
        dateOfBirth: data.dateOfBirth?.slice(0, 10) ?? '',
        gender: data.gender ?? '',
        bloodGroup: data.bloodGroup ?? '',
        addressLine1: data.addressLine1 ?? '',
        addressLine2: data.addressLine2 ?? '',
        city: data.city ?? '',
        state: data.state ?? '',
        postalCode: data.postalCode ?? '',
        emergencyContactName: data.emergencyContactName ?? '',
        emergencyContactPhone: data.emergencyContactPhone ?? '',
      });
  }, [data]);
  const change =
    (field: keyof typeof emptyProfile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (values.dateOfBirth && values.dateOfBirth > new Date().toISOString().slice(0, 10)) {
      setError('Date of birth cannot be in the future.');
      return;
    }
    if (values.postalCode && !isIndiaPostalCode(values.postalCode)) {
      setError('Enter a valid six-digit Indian postal code.');
      return;
    }
    const contactMobile = values.emergencyContactPhone.replace(/^\+91/, '');
    if (contactMobile && !normalizeIndiaMobile('+91', contactMobile)) {
      setError('Enter a valid 10-digit Indian emergency contact mobile.');
      return;
    }
    setSaving(true);
    try {
      await patientRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify(
          Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])),
        ),
      });
      router.push('/profile');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your profile.');
    } finally {
      setSaving(false);
    }
  };
  const select = (
    field: 'gender' | 'bloodGroup',
    label: string,
    options: Array<[string, string]>,
  ) => (
    <label className={labelClass}>
      {label}
      <select className={inputClass} value={values[field]} onChange={change(field)}>
        <option value="">Select (optional)</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const text = (
    field: keyof typeof emptyProfile,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className={labelClass}>
      {label}
      <input className={inputClass} value={values[field]} onChange={change(field)} {...props} />
    </label>
  );
  return (
    <PatientShell>
      <Heading
        title="Edit profile"
        subtitle="Fields are optional. You can add or update them gradually."
      />
      {loading ? (
        <p aria-live="polite">Loading your profile…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">
          {loadError}
        </p>
      ) : (
        <form onSubmit={submit} className={cardClass}>
          <div className="grid gap-5 sm:grid-cols-2">
            {text('fullName', 'Full name', { autoComplete: 'name', maxLength: 120 })}
            {text('dateOfBirth', 'Date of birth', {
              type: 'date',
              max: new Date().toISOString().slice(0, 10),
            })}
            {select('gender', 'Gender', [
              ['FEMALE', 'Female'],
              ['MALE', 'Male'],
              ['NON_BINARY', 'Non-binary'],
              ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
            ])}
            {select(
              'bloodGroup',
              'Blood group',
              [
                'A_POSITIVE',
                'A_NEGATIVE',
                'B_POSITIVE',
                'B_NEGATIVE',
                'AB_POSITIVE',
                'AB_NEGATIVE',
                'O_POSITIVE',
                'O_NEGATIVE',
                'UNKNOWN',
              ].map((x) => [
                x,
                x.replace('_POSITIVE', '+').replace('_NEGATIVE', '−').replaceAll('_', ' '),
              ]),
            )}
            {text('addressLine1', 'Address line 1', {
              autoComplete: 'address-line1',
              maxLength: 200,
            })}
            {text('addressLine2', 'Address line 2', {
              autoComplete: 'address-line2',
              maxLength: 200,
            })}
            {text('city', 'City', { autoComplete: 'address-level2', maxLength: 100 })}
            {text('state', 'State', { autoComplete: 'address-level1', maxLength: 100 })}
            {text('postalCode', 'Postal code', {
              inputMode: 'numeric',
              autoComplete: 'postal-code',
              maxLength: 6,
              pattern: '[1-9][0-9]{5}',
            })}
            {text('emergencyContactName', 'Emergency contact name', { maxLength: 120 })}
            {text('emergencyContactPhone', 'Emergency contact mobile', {
              type: 'tel',
              inputMode: 'tel',
              placeholder: '10-digit Indian mobile',
              maxLength: 13,
              pattern: '(\\+91)?[6-9][0-9]{9}',
            })}
          </div>
          {error && (
            <p role="alert" className="mt-5 rounded-xl bg-rose-50 p-3 text-rose-800">
              {error}
            </p>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              disabled={saving}
              className="min-h-12 rounded-xl bg-sky-700 px-5 font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            <Link
              href="/profile"
              className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 px-5 font-semibold text-slate-700"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </PatientShell>
  );
}

const emptyHealth: Health = {
  diabetesStatus: 'UNKNOWN',
  hypertensionStatus: 'UNKNOWN',
  allergies: '',
  existingMedicalConditions: '',
  currentMedications: '',
  additionalNotes: '',
};
export function HealthInformationPage() {
  const {
    data,
    loading,
    error: loadError,
  } = useLoad<PatientHealthInformation>('/health-information', 'healthInformation');
  const [values, setValues] = useState<Health>(emptyHealth);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data)
      setValues({
        diabetesStatus: data.diabetesStatus,
        hypertensionStatus: data.hypertensionStatus,
        allergies: data.allergies,
        existingMedicalConditions: data.existingMedicalConditions,
        currentMedications: data.currentMedications,
        additionalNotes: data.additionalNotes,
      });
  }, [data]);
  const change =
    (field: keyof Health) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLSelectElement>) => {
      setStatus('');
      setValues((v) => ({ ...v, [field]: e.target.value }));
    };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');
    setSaving(true);
    try {
      const r = await patientRequest<{ healthInformation: PatientHealthInformation }>(
        '/health-information',
        { method: 'PUT', body: JSON.stringify(values) },
      );
      const saved = r.healthInformation;
      setValues({
        diabetesStatus: saved.diabetesStatus,
        hypertensionStatus: saved.hypertensionStatus,
        allergies: saved.allergies,
        existingMedicalConditions: saved.existingMedicalConditions,
        currentMedications: saved.currentMedications,
        additionalNotes: saved.additionalNotes,
      });
      setStatus('Health information saved.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to save your health information.',
      );
    } finally {
      setSaving(false);
    }
  };
  const notes: Array<[keyof Health, string]> = [
    ['allergies', 'Allergies'],
    ['existingMedicalConditions', 'Existing medical conditions'],
    ['currentMedications', 'Current medications'],
    ['additionalNotes', 'Additional notes'],
  ];
  return (
    <PatientShell>
      <Heading
        title="Health information"
        subtitle="This is information you provide about yourself. It is not a diagnosis or medical advice."
      />
      {loading ? (
        <p aria-live="polite">Loading your health information…</p>
      ) : loadError ? (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">
          {loadError}
        </p>
      ) : (
        <form onSubmit={submit} className={cardClass}>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className={labelClass}>
              Diabetes status
              <select
                className={inputClass}
                value={values.diabetesStatus}
                onChange={change('diabetesStatus')}
              >
                <option value="UNKNOWN">Not provided / unknown</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
                <option value="PREDIABETES">Prediabetes</option>
              </select>
            </label>
            <label className={labelClass}>
              Hypertension status
              <select
                className={inputClass}
                value={values.hypertensionStatus}
                onChange={change('hypertensionStatus')}
              >
                <option value="UNKNOWN">Not provided / unknown</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
              </select>
            </label>
            {notes.map(([field, label]) => (
              <label
                key={field}
                className={`${labelClass} ${field === 'additionalNotes' ? 'sm:col-span-2' : ''}`}
              >
                {label}
                <textarea
                  className={`${inputClass} min-h-28 py-3`}
                  maxLength={4000}
                  value={values[field] ?? ''}
                  onChange={change(field)}
                />
              </label>
            ))}
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-500">
            Share only information you choose to save. These details are patient-provided and should
            not replace advice from a qualified clinician.
          </p>
          {error && (
            <p role="alert" className="mt-5 rounded-xl bg-rose-50 p-3 text-rose-800">
              {error}
            </p>
          )}
          {status && (
            <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-3 text-emerald-800">
              {status}
            </p>
          )}
          <button
            disabled={saving}
            className="mt-6 min-h-12 rounded-xl bg-sky-700 px-5 font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save health information'}
          </button>
        </form>
      )}
    </PatientShell>
  );
}
