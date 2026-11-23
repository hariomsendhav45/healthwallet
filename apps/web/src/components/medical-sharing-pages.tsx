'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { BrowserQRCodeReader } from '@zxing/browser';
import type {
  MedicalShareDoctorDisplay,
  MedicalSharePermission,
  MedicalShareSessionSummary,
} from '@healthvault/shared';
import { API_BASE } from '../auth/api';
import { patientRequest } from '../auth/patient-api';
import { useAuth } from '../auth/auth-provider';
import { PatientShell } from './patient-shell';
import { InstallPwaButton } from './pwa-register';
import { usePathname, useRouter } from 'next/navigation';

type DocumentChoice = { id: string; title: string; category: string; documentDate: string | null };
type RequestItem = {
  id: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
  shareSession?: {
    id: string;
    permissions: Array<{ permissionType: MedicalSharePermission }>;
    documents: Array<{ medicalDocument: DocumentChoice }>;
  };
  doctor?: MedicalShareDoctorDisplay;
};
type GrantItem = {
  id: string;
  expiresAt: string;
  grantedAt: string;
  shareSession: {
    permissions: Array<{ permissionType: MedicalSharePermission }>;
    documents: Array<{ medicalDocument: DocumentChoice }>;
  };
  patientProfile?: { fullName: string | null };
};
type SharedRecords = {
  fullName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  healthInformation?: Record<string, unknown> | null;
  medicalDocuments?: Array<{ id: string; title: string; category: string }>;
  bloodPressureReadings?: Array<{
    id: string;
    systolic: number;
    diastolic: number;
    heartRate: number | null;
    measuredAt: string;
  }>;
  bloodGlucoseReadings?: Array<{
    id: string;
    glucoseValue: number;
    glucoseUnit: string;
    measurementType: string;
    measuredAt: string;
  }>;
};
type SharedAccess = {
  grant: { expiresAt: string; permissions: MedicalSharePermission[] };
  records: SharedRecords;
};
type ApiResult<T> = T & { message?: string | string[] };

const permissionLabels: Record<MedicalSharePermission, string> = {
  PROFILE_BASIC: 'Basic profile',
  BLOOD_GROUP: 'Blood group',
  HEALTH_INFORMATION: 'Health information',
  MEDICAL_DOCUMENTS: 'Selected medical reports',
  BLOOD_PRESSURE_READINGS: 'Blood pressure readings',
  BLOOD_GLUCOSE_READINGS: 'Blood glucose readings',
};
const permissionChoices: MedicalSharePermission[] = [
  'PROFILE_BASIC',
  'BLOOD_GROUP',
  'HEALTH_INFORMATION',
  'MEDICAL_DOCUMENTS',
  'BLOOD_PRESSURE_READINGS',
  'BLOOD_GLUCOSE_READINGS',
];
const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const button =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50';

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as ApiResult<T>;
  if (!response.ok)
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(' ')
        : body.message || 'Unable to complete the sharing request.',
    );
  return body;
}

function PatientPage({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PatientShell>{children}</PatientShell>;
}

export function SharingOverviewPage() {
  const [sessions, setSessions] = useState<MedicalShareSessionSummary[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await patientRequest<{ sessions: MedicalShareSessionSummary[] }>(
        '/sharing/sessions',
      );
      setSessions(data.sessions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load sharing sessions.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this QR session and any access it granted?')) return;
    try {
      await patientRequest(`/sharing/sessions/${id}/revoke`, { method: 'POST', body: '{}' });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke access.');
    }
  };
  return (
    <PatientPage>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
              Privacy controls
            </p>
            <h1 className="mt-1 text-3xl font-bold text-slate-950">Medical sharing</h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Choose exactly what a doctor can request. Scanning a QR never grants access; you must
              approve each request.
            </p>
          </div>
          <Link className={button} href="/sharing/create">
            Create QR session
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link className={`${card} hover:border-sky-300`} href="/sharing/requests">
            <h2 className="font-bold">Review requests</h2>
            <p className="mt-1 text-sm text-slate-600">See doctors waiting for your consent.</p>
          </Link>
          <Link className={`${card} hover:border-sky-300`} href="/sharing/history">
            <h2 className="font-bold">Sharing history</h2>
            <p className="mt-1 text-sm text-slate-600">Review sharing and access events.</p>
          </Link>
        </div>
        <section className={card}>
          <h2 className="text-xl font-bold">Your QR sessions</h2>
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {error}
            </p>
          )}
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No sharing sessions yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-4"
                >
                  <div>
                    <p className="font-semibold">
                      {session.permissions
                        .map(({ permissionType }) => permissionLabels[permissionType])
                        .join(', ')}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {session.status.toLowerCase()} · expires{' '}
                      {new Date(session.expiresAt).toLocaleString()} · {session.useCount}/
                      {session.maxUses} scans
                    </p>
                    {session.documents.length > 0 && (
                      <p className="mt-1 text-sm text-slate-600">
                        Reports:{' '}
                        {session.documents
                          .map(({ medicalDocument }) => medicalDocument.title)
                          .join(', ')}
                      </p>
                    )}
                    {session.accessRequests && session.accessRequests.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm text-slate-600">
                        {session.accessRequests.map((accessRequest) => (
                          <li key={accessRequest.id}>
                            {accessRequest.doctor?.doctorProfile?.fullName || 'Doctor'} request:{' '}
                            {accessRequest.status.toLowerCase()}
                            {accessRequest.accessGrant
                              ? ` · access ${accessRequest.accessGrant.status.toLowerCase()}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {session.status === 'ACTIVE' && (
                    <button
                      className="min-h-10 rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-700"
                      onClick={() => void revoke(session.id)}
                    >
                      Revoke session
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PatientPage>
  );
}

export function CreateSharingPage() {
  const [permissions, setPermissions] = useState<MedicalSharePermission[]>([]);
  const [documents, setDocuments] = useState<DocumentChoice[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<MedicalShareSessionSummary | null>(null);
  const [qr, setQr] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hasDocs = permissions.includes('MEDICAL_DOCUMENTS');
  useEffect(() => {
    let active = true;
    void patientRequest<{ documents: DocumentChoice[] }>('/documents?limit=100&page=1')
      .then((result) => {
        if (active) setDocuments(result.documents);
      })
      .catch(() => {
        if (active) setDocuments([]);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!token || !session) return;
    let active = true;
    void QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => {
        if (active) setError('Could not render the QR code. Revoke this session and try again.');
      });
    return () => {
      active = false;
    };
  }, [token, session]);
  useEffect(() => {
    if (!session) return;
    const update = () =>
      setRemaining(
        Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session]);
  const togglePermission = (permission: MedicalSharePermission) =>
    setPermissions((old) =>
      old.includes(permission) ? old.filter((value) => value !== permission) : [...old, permission],
    );
  const toggleDocument = (id: string) =>
    setSelectedDocuments((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : [...old, id],
    );
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!permissions.length) throw new Error('Choose at least one category to share.');
      if (hasDocs && !selectedDocuments.length)
        throw new Error('Choose the specific reports to share.');
      const result = await patientRequest<{ session: MedicalShareSessionSummary; token: string }>(
        '/sharing/sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            permissionTypes: permissions,
            ...(hasDocs ? { medicalDocumentIds: selectedDocuments } : {}),
            durationMinutes,
          }),
        },
      );
      setSession(result.session);
      setToken(result.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the QR session.');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!session || !window.confirm('Revoke this sharing session now?')) return;
    try {
      await patientRequest(`/sharing/sessions/${session.id}/revoke`, {
        method: 'POST',
        body: '{}',
      });
      setSession({ ...session, status: 'REVOKED', revokedAt: new Date().toISOString() });
      setToken(null);
      setQr('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke the session.');
    }
  };
  return (
    <PatientPage>
      <div className="space-y-5">
        <Link href="/sharing" className="text-sm font-semibold text-sky-800">
          ← Medical sharing
        </Link>
        <h1 className="text-3xl font-bold">Create a QR session</h1>
        <p className="max-w-3xl text-slate-600">
          Only selected categories and reports can be requested. You will separately approve or
          reject every doctor request.
        </p>
        {session && token ? (
          <section className={`${card} max-w-2xl`}>
            <h2 className="text-xl font-bold">Show this QR to your doctor</h2>
            <p className="mt-2 text-slate-600">
              QR expires in{' '}
              <strong aria-live="polite">
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </strong>
              . Selected:{' '}
              {session.permissions
                .map(({ permissionType }) => permissionLabels[permissionType])
                .join(', ')}
              .
            </p>
            {session.documents.length > 0 && (
              <p className="mt-1 text-sm text-slate-600">
                Reports:{' '}
                {session.documents.map(({ medicalDocument }) => medicalDocument.title).join(', ')}
              </p>
            )}
            {qr && remaining > 0 && (
              <Image
                unoptimized
                width={300}
                height={300}
                className="mx-auto my-5 h-auto w-full max-w-[300px] rounded-xl border border-slate-200 p-2"
                src={qr}
                alt="QR code containing a temporary opaque sharing reference"
              />
            )}
            {remaining === 0 && (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">
                This QR session has expired.
              </p>
            )}
            <p className="text-sm text-slate-600">
              Do not share a screenshot of an active QR with anyone else. The QR contains no health
              information, but it lets verified doctors submit a request.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="min-h-11 rounded-xl border border-rose-300 px-4 font-semibold text-rose-700"
                onClick={() => void revoke()}
              >
                Revoke sharing
              </button>
              <Link className={secondary} href="/sharing/requests">
                Review requests
              </Link>
            </div>
          </section>
        ) : (
          <form onSubmit={(event) => void create(event)} className={`${card} max-w-3xl space-y-5`}>
            <fieldset>
              <legend className="text-lg font-bold">Select categories</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {permissionChoices.map((permission) => (
                  <label
                    key={permission}
                    className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3"
                  >
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      onChange={() => togglePermission(permission)}
                    />
                    <span>{permissionLabels[permission]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {hasDocs && (
              <fieldset>
                <legend className="text-lg font-bold">Choose specific reports</legend>
                {documents.length ? (
                  <div className="mt-3 max-h-64 space-y-2 overflow-auto">
                    {documents.map((document) => (
                      <label
                        key={document.id}
                        className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocuments.includes(document.id)}
                          onChange={() => toggleDocument(document.id)}
                        />
                        <span>
                          <strong>{document.title}</strong>
                          <span className="block text-sm text-slate-600">
                            {document.category}
                            {document.documentDate
                              ? ` · ${new Date(document.documentDate).toLocaleDateString()}`
                              : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">No available reports to select.</p>
                )}
              </fieldset>
            )}
            <label className="block text-sm font-semibold text-slate-700">
              Session duration
              <select
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </label>
            {error && (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            )}
            <button className={button} disabled={busy}>
              {busy ? 'Creating…' : 'Create QR session'}
            </button>
          </form>
        )}
      </div>
    </PatientPage>
  );
}

export function PatientSharingRequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await patientRequest<{ requests: RequestItem[] }>('/sharing/requests');
      setRequests(result.requests);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load requests.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const review = async (id: string, decision: 'approve' | 'reject') => {
    if (!window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} this doctor request?`))
      return;
    try {
      await patientRequest(`/sharing/requests/${id}/${decision}`, { method: 'POST', body: '{}' });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to review request.');
    }
  };
  return (
    <PatientPage>
      <div className="space-y-5">
        <Link href="/sharing" className="text-sm font-semibold text-sky-800">
          ← Medical sharing
        </Link>
        <h1 className="text-3xl font-bold">Access requests</h1>
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        {requests.length === 0 ? (
          <p className={card}>No pending requests.</p>
        ) : (
          requests.map((item) => {
            const doctor = item.doctor?.doctorProfile;
            return (
              <section className={card} key={item.id}>
                <h2 className="text-lg font-bold">{doctor?.fullName || 'Verified doctor'}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Doctor account status is verified. Professional details are self-reported and are
                  not independently credential-verified by HealthWallet.
                </p>
                {doctor?.professionalRegistrationNo && (
                  <p className="mt-2 text-sm">
                    Registration: {doctor.professionalRegistrationNo}
                    {doctor.registrationAuthority ? ` · ${doctor.registrationAuthority}` : ''}
                  </p>
                )}
                <p className="mt-2 text-sm">
                  Requested {new Date(item.requestedAt).toLocaleString()} · request expires{' '}
                  {new Date(item.expiresAt).toLocaleString()}
                </p>
                <p className="mt-2 text-sm font-medium">
                  Selected categories:{' '}
                  {item.shareSession?.permissions
                    .map(({ permissionType }) => permissionLabels[permissionType])
                    .join(', ')}
                </p>
                {item.shareSession?.documents.length ? (
                  <ul className="mt-2 list-inside list-disc text-sm">
                    {item.shareSession.documents.map(({ medicalDocument }) => (
                      <li key={medicalDocument.id}>
                        {medicalDocument.title} ({medicalDocument.category})
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button className={button} onClick={() => void review(item.id, 'approve')}>
                    Approve access
                  </button>
                  <button
                    className="min-h-11 rounded-xl border border-rose-300 px-4 font-semibold text-rose-700"
                    onClick={() => void review(item.id, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </section>
            );
          })
        )}
      </div>
    </PatientPage>
  );
}

export function PatientSharingHistoryPage() {
  const [history, setHistory] = useState<
    Array<{
      eventType: string;
      createdAt: string;
      doctor?: MedicalShareDoctorDisplay;
      shareSession?: {
        status: string;
        expiresAt: string;
        permissions: Array<{ permissionType: MedicalSharePermission }>;
      };
    }>
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void patientRequest<{ history: typeof history }>('/sharing/history')
      .then((result) => setHistory(result.history))
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load sharing history.'),
      );
  }, []);
  return (
    <PatientPage>
      <div className="space-y-5">
        <Link href="/sharing" className="text-sm font-semibold text-sky-800">
          ← Medical sharing
        </Link>
        <h1 className="text-3xl font-bold">Sharing history</h1>
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        {history.length === 0 ? (
          <p className={card}>No sharing activity yet.</p>
        ) : (
          <ul className={`${card} divide-y divide-slate-200`}>
            {history.map((event, index) => (
              <li className="py-4" key={`${event.createdAt}-${index}`}>
                <p className="font-semibold">
                  {event.eventType.replaceAll('_', ' ').toLowerCase()}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {new Date(event.createdAt).toLocaleString()}
                  {event.doctor?.doctorProfile?.fullName
                    ? ` · ${event.doctor.doctorProfile.fullName}`
                    : ''}
                  {event.shareSession
                    ? ` · session ${event.shareSession.status.toLowerCase()} · ${event.shareSession.permissions.map((p) => permissionLabels[p.permissionType]).join(', ')}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PatientPage>
  );
}

function DoctorShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [installAvailable, setInstallAvailable] = useState(false);
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && user.role !== 'DOCTOR') router.replace('/dashboard');
  }, [loading, user, router]);
  useEffect(() => {
    const refresh = () =>
      setInstallAvailable(
        Boolean((window as Window & { deferredInstallPrompt?: Event }).deferredInstallPrompt),
      );
    refresh();
    window.addEventListener('pwa-install-change', refresh);
    return () => window.removeEventListener('pwa-install-change', refresh);
  }, []);
  if (loading || !user || user.role !== 'DOCTOR')
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Checking your session…
      </main>
    );
  const nav: Array<[string, string]> =
    user.doctorVerificationStatus === 'APPROVED'
      ? [
          ['/doctor/dashboard', 'Overview'],
          ['/doctor/profile', 'Profile'],
          ['/doctor/verification-status', 'Verification'],
          ['/doctor/scan', 'Scan QR'],
          ['/doctor/requests', 'Requests'],
          ['/doctor/patients', 'Patients'],
        ]
      : [['/doctor/dashboard', 'Overview'], ['/doctor/profile', 'Profile'], ['/doctor/verification-status', 'Verification']];
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/doctor/dashboard" className="text-lg font-bold">
            HealthWallet · Doctor
          </Link>
          <div className="flex items-center gap-2">
            {installAvailable && <InstallPwaButton />}
            <button className="min-h-11 rounded-xl border px-3" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Doctor navigation"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-col"
        >
          {nav.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold ${path === href ? 'bg-sky-100 text-sky-900' : 'text-slate-600 hover:bg-white'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

export function DoctorDashboardPage() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [authority, setAuthority] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (user?.role !== 'DOCTOR') return;
    void apiRequest<{
      doctorProfile: {
        fullName: string | null;
        professionalRegistrationNo: string | null;
        registrationAuthority: string | null;
      } | null;
    }>('/doctor/profile')
      .then(({ doctorProfile }) => {
        setName(doctorProfile?.fullName ?? '');
        setRegistration(doctorProfile?.professionalRegistrationNo ?? '');
        setAuthority(doctorProfile?.registrationAuthority ?? '');
      })
      .catch(() => undefined);
  }, [user]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await apiRequest('/doctor/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName: name || null,
          professionalRegistrationNo: registration || null,
          registrationAuthority: authority || null,
        }),
      });
      setStatus(
        'Details saved. These self-reported credentials have not been independently verified.',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save details.');
    }
  };
  return (
    <DoctorShell>
      <div className="space-y-5">
        <h1 className="text-3xl font-bold">Doctor dashboard</h1>
        {user?.doctorVerificationStatus !== 'APPROVED' ? (
          <section className={`${card} border-amber-300 bg-amber-50`}>
            <h2 className="text-lg font-bold text-amber-950">Application status: {user?.doctorVerificationStatus?.replaceAll('_', ' ') ?? 'PENDING'}</h2>
            <p className="mt-2 text-amber-900">
              Complete your profile and upload registration documents for manual HealthWallet administrator review. This review does not verify credentials with a medical council or registry.
            </p>
          </section>
        ) : (
          <>
            <section className={card}>
              <p className="font-semibold">Account status: Approved by HealthWallet administrator</p>
              <p className="mt-1 text-sm text-slate-600">
                Professional registration details entered below are self-reported and are not
                independently credential-verified by this app.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className={button} href="/doctor/scan">
                  Scan patient QR
                </Link>
                <Link className={secondary} href="/doctor/patients">
                  Active patient access
                </Link>
              </div>
            </section>
            <form className={`${card} max-w-2xl space-y-4`} onSubmit={(event) => void save(event)}>
              <h2 className="text-lg font-bold">Doctor profile</h2>
              <label className="block text-sm font-semibold">
                Full name
                <input
                  className="mt-1 min-h-12 w-full rounded-xl border px-3 text-base"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="block text-sm font-semibold">
                Medical registration / council number
                <input
                  className="mt-1 min-h-12 w-full rounded-xl border px-3 text-base"
                  value={registration}
                  onChange={(event) => setRegistration(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="block text-sm font-semibold">
                Medical council / registration authority
                <input
                  className="mt-1 min-h-12 w-full rounded-xl border px-3 text-base"
                  value={authority}
                  onChange={(event) => setAuthority(event.target.value)}
                  maxLength={160}
                />
              </label>
              {error && (
                <p role="alert" className="text-rose-700">
                  {error}
                </p>
              )}
              {status && (
                <p role="status" className="text-emerald-800">
                  {status}
                </p>
              )}
              <button className={button}>Save display details</button>
            </form>
          </>
        )}
      </div>
    </DoctorShell>
  );
}

export function DoctorScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [manual, setManual] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);
  useEffect(
    () => () => {
      controlsRef.current?.stop();
    },
    [],
  );
  const submitToken = async (value: string) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      setError('That is not a valid temporary QR reference.');
      return;
    }
    stop();
    setError('');
    setMessage('Submitting a request…');
    try {
      const result = await apiRequest<{ request: { status: string } }>('/doctor/sharing/scan', {
        method: 'POST',
        body: JSON.stringify({ token: value }),
      });
      setMessage(
        result.request.status === 'PENDING'
          ? 'Request sent. The patient must approve before any records are available.'
          : `This sharing request is already ${result.request.status.toLowerCase()}.`,
      );
      setManual('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit the access request.');
      setMessage('');
    }
  };
  const startCamera = async () => {
    setError('');
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera scanning is unavailable in this browser. You can enter the token manually.');
      return;
    }
    if (!videoRef.current) return;
    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result) return;
        const value = result.getText();
        stop();
        void submitToken(value);
      });
      controlsRef.current = controls;
    } catch {
      stop();
      setError(
        'Camera permission was denied or no camera is available. Enter the token manually if your doctor can provide it securely.',
      );
    }
  };
  return (
    <DoctorShell>
      <div className="space-y-5">
        <Link href="/doctor/dashboard" className="text-sm font-semibold text-sky-800">
          ← Doctor dashboard
        </Link>
        <h1 className="text-3xl font-bold">Scan a patient QR</h1>
        <p className="max-w-2xl text-slate-600">
          Scanning submits an access request only. No patient information is shown until the patient
          approves.
        </p>
        <section className={`${card} max-w-2xl`}>
          <video
            ref={videoRef}
            className={`aspect-video w-full rounded-xl bg-slate-950 ${scanning ? '' : 'hidden'}`}
            muted
            playsInline
            aria-label="Camera preview for QR scanning"
          />
          {scanning && (
            <button className={`${secondary} mt-3`} onClick={stop}>
              Stop camera
            </button>
          )}
          <button
            className={`${button} mt-3`}
            onClick={() => void startCamera()}
            disabled={scanning}
          >
            Start camera
          </button>
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitToken(manual.trim());
            }}
          >
            <label className="block text-sm font-semibold">
              Temporary QR token
              <input
                autoComplete="off"
                className="mt-1 min-h-12 w-full rounded-xl border px-3 font-mono text-base"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                maxLength={43}
              />
            </label>
            <button className={secondary} disabled={manual.length !== 43}>
              Submit access request
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-rose-700">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="mt-3 text-emerald-800">
              {message}
            </p>
          )}
        </section>
        <p className="text-sm text-slate-600">
          Camera access requires HTTPS or localhost and browser permission. Video frames and scanned
          values are not stored in browser persistence.
        </p>
      </div>
    </DoctorShell>
  );
}

export function DoctorRequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void apiRequest<{ requests: RequestItem[] }>('/doctor/sharing/requests')
      .then((value) => setRequests(value.requests))
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load requests.'),
      );
  }, []);
  return (
    <DoctorShell>
      <div className="space-y-5">
        <h1 className="text-3xl font-bold">My access requests</h1>
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        {requests.length === 0 ? (
          <p className={card}>No requests yet.</p>
        ) : (
          requests.map((item) => (
            <section className={card} key={item.id}>
              <h2 className="font-bold">Request {item.status.toLowerCase()}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Sent {new Date(item.requestedAt).toLocaleString()} · expires{' '}
                {new Date(item.expiresAt).toLocaleString()}
              </p>
              <p className="mt-2 text-sm">
                Categories:{' '}
                {item.shareSession?.permissions
                  .map(({ permissionType }) => permissionLabels[permissionType])
                  .join(', ')}
              </p>
              {item.shareSession?.documents.map(({ medicalDocument }) => (
                <p key={medicalDocument.id} className="mt-1 text-sm">
                  Selected report: {medicalDocument.title} ({medicalDocument.category})
                </p>
              ))}
            </section>
          ))
        )}
      </div>
    </DoctorShell>
  );
}

export function DoctorPatientsPage() {
  const [grants, setGrants] = useState<GrantItem[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{ grants: GrantItem[] }>('/doctor/patient-access');
      setGrants(data.grants);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load active access.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <DoctorShell>
      <div className="space-y-5">
        <h1 className="text-3xl font-bold">Authorized patient access</h1>
        <p className="text-slate-600">
          Only currently active, patient-approved grants appear here.
        </p>
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        {grants.length === 0 ? (
          <p className={card}>No active patient grants.</p>
        ) : (
          grants.map((grant) => (
            <section key={grant.id} className={card}>
              <h2 className="font-bold">
                {grant.patientProfile?.fullName || 'Shared patient records'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Expires {new Date(grant.expiresAt).toLocaleString()}
              </p>
              <p className="mt-2 text-sm">
                Permissions:{' '}
                {grant.shareSession.permissions
                  .map(({ permissionType }) => permissionLabels[permissionType])
                  .join(', ')}
              </p>
              <Link className={`${button} mt-4`} href={`/doctor/patients/${grant.id}`}>
                Open shared records
              </Link>
            </section>
          ))
        )}
      </div>
    </DoctorShell>
  );
}

export function DoctorPatientAccessPage({ grantId }: { grantId: string }) {
  const [data, setData] = useState<SharedAccess | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void apiRequest<SharedAccess>(`/doctor/patient-access/${grantId}`)
      .then(setData)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'This access is unavailable.'),
      );
  }, [grantId]);
  const revoke = async () => {
    if (!window.confirm('End your access to these records?')) return;
    try {
      await apiRequest(`/doctor/patient-access/${grantId}/revoke`, { method: 'POST', body: '{}' });
      setNotice('Access ended.');
      setData(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke access.');
    }
  };
  const grant = data?.grant;
  const records = data?.records;
  const docs = records?.medicalDocuments;
  const bp = records?.bloodPressureReadings;
  const glucose = records?.bloodGlucoseReadings;
  return (
    <DoctorShell>
      <div className="space-y-5">
        <Link href="/doctor/patients" className="text-sm font-semibold text-sky-800">
          ← Authorized patient access
        </Link>
        <h1 className="text-3xl font-bold">Shared patient records</h1>
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-emerald-800">
            {notice}
          </p>
        )}
        {grant && records && (
          <>
            <section className={card}>
              <p>Access expires {new Date(grant.expiresAt).toLocaleString()}</p>
              <p className="mt-1 text-sm text-slate-600">
                Permitted:{' '}
                {grant.permissions.map((permission) => permissionLabels[permission]).join(', ')}
              </p>
              <button
                className="mt-4 min-h-11 rounded-xl border border-rose-300 px-4 font-semibold text-rose-700"
                onClick={() => void revoke()}
              >
                End my access
              </button>
            </section>
            {records.fullName !== undefined && (
              <section className={card}>
                <h2 className="font-bold">Basic profile</h2>
                <p>
                  {String(records.fullName ?? 'Name not provided')}
                  {records.dateOfBirth
                    ? ` · ${new Date(String(records.dateOfBirth)).toLocaleDateString()}`
                    : ''}
                  {records.gender ? ` · ${String(records.gender)}` : ''}
                </p>
              </section>
            )}
            {records.bloodGroup !== undefined && (
              <section className={card}>
                <h2 className="font-bold">Blood group</h2>
                <p>{String(records.bloodGroup ?? 'Not provided')}</p>
              </section>
            )}
            {records.healthInformation !== undefined && (
              <section className={card}>
                <h2 className="font-bold">Health information</h2>
                <pre className="mt-2 whitespace-pre-wrap text-sm">
                  {JSON.stringify(records.healthInformation, null, 2)}
                </pre>
              </section>
            )}
            {docs && (
              <section className={card}>
                <h2 className="font-bold">Selected medical reports</h2>
                <ul className="mt-3 space-y-2">
                  {docs.map((doc) => (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {doc.title} · {doc.category}
                      </span>
                      <a
                        className={secondary}
                        href={`${API_BASE}/api/doctor/patient-access/${grantId}/documents/${doc.id}/content`}
                        rel="noreferrer"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {bp && (
              <section className={card}>
                <h2 className="font-bold">Blood pressure readings</h2>
                <ul className="mt-2 space-y-2">
                  {bp.map((reading) => (
                    <li key={reading.id}>
                      {reading.systolic}/{reading.diastolic} mmHg ·{' '}
                      {new Date(reading.measuredAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {glucose && (
              <section className={card}>
                <h2 className="font-bold">Blood glucose readings</h2>
                <ul className="mt-2 space-y-2">
                  {glucose.map((reading) => (
                    <li key={reading.id}>
                      {reading.glucoseValue} {reading.glucoseUnit} · {reading.measurementType} ·{' '}
                      {new Date(reading.measuredAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </DoctorShell>
  );
}
