'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  FamilyInvitationSummary,
  FamilyMemberSummary,
  FamilyRelationship,
  MedicalSharePermission,
} from '@healthvault/shared';
import { API_BASE } from '../auth/api';
import { useAuth } from '../auth/auth-provider';
import { patientRequest } from '../auth/patient-api';
import { PatientShell } from './patient-shell';

type FamilyMember = Omit<FamilyMemberSummary, 'claimedByUserId' | 'invitation' | 'accessGrant'> & {
  accountLinked: boolean;
  invitation: FamilyMemberSummary['invitation'];
  accessGrant: FamilyMemberSummary['accessGrant'];
  guardianRelationship?: { verificationStatus: 'UNVERIFIED' } | null;
};
type FamilyInvitationData = {
  sentInvitations: Array<FamilyInvitationSummary & {
    targetPhoneNumber: string;
    familyMember: { id: string; fullName: string; relationship: FamilyRelationship };
  }>;
  receivedInvitations: Array<FamilyInvitationSummary & {
    familyMember: {
      fullName: string;
      relationship: FamilyRelationship;
      ownerPatientProfile: { fullName: string | null };
    };
  }>;
  familyLinks: Array<{
    id: string;
    fullName: string;
    relationship: FamilyRelationship;
    ownerPatientProfile: { fullName: string | null };
    accessGrant: {
      id: string;
      expiresAt: string;
      permissions: Array<{ permissionType: MedicalSharePermission }>;
      documents: Array<{ medicalDocumentId: string }>;
    } | null;
    accessStatus: string;
  }>;
};
type FamilyRecords = {
  accessGrant: { expiresAt: string; permissions: MedicalSharePermission[] };
  records: Record<string, unknown>;
};
type ApiError = { message?: string | string[] };

async function familyRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}/api/patient/family${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as ApiError & T;
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new Error(message || 'Unable to complete this family request.');
  }
  return body;
}

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const input = 'mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-100';
const button = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50';
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50';
const relationshipLabel = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
const permissionChoices: Array<[MedicalSharePermission, string]> = [
  ['PROFILE_BASIC', 'Basic profile'],
  ['BLOOD_GROUP', 'Blood group'],
  ['HEALTH_INFORMATION', 'Health information'],
  ['MEDICAL_DOCUMENTS', 'Selected medical reports'],
  ['BLOOD_PRESSURE_READINGS', 'Blood pressure readings'],
  ['BLOOD_GLUCOSE_READINGS', 'Blood glucose readings'],
];

function FamilyPage({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PatientShell>{children}</PatientShell>;
}

export function FamilyOverviewPage() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await familyRequest<{ familyMembers: FamilyMember[] }>('/members');
      setMembers(result.familyMembers);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load family members.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <FamilyPage>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-sky-700">Connections</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-950">Family members</h1>
            <p className="mt-2 max-w-2xl text-slate-600">Manage family relationships. Adding someone never gives either person access to health records.</p>
          </div>
          <Link className={button} href="/family/add">Add family member</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/family/invitations" className={`${card} hover:border-sky-300`}>
            <h2 className="font-bold">Invitations and consent</h2>
            <p className="mt-1 text-sm text-slate-600">Accept an invitation or explicitly manage record access you granted.</p>
          </Link>
        </div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>}
        <section className={card} aria-busy={loading}>
          <h2 className="text-xl font-bold">Your family list</h2>
          {loading ? <p className="mt-3 text-slate-600">Loading family members…</p> : null}
          {!loading && !error && members.length === 0 ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-5 text-slate-700">
              <p>No family members added yet.</p><Link className="mt-3 inline-block font-semibold text-sky-800" href="/family/add">Add a family member</Link>
            </div>
          ) : null}
          {!loading && members.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {members.map((member) => (
                <li key={member.id}>
                  <Link href={`/family/${member.id}`} className="block rounded-xl border border-slate-200 p-4 hover:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <p className="font-bold text-slate-900">{member.fullName}</p>
                    <p className="mt-1 text-sm text-slate-600">{relationshipLabel(member.relationship)}</p>
                    <p className="mt-2 text-sm font-semibold text-sky-800">{statusLabel(member.accessStatus)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </FamilyPage>
  );
}

export function FamilyAddPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fullName: '', dateOfBirth: '', relationship: 'OTHER' as FamilyRelationship, contactNumber: '', gender: '' });
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await familyRequest<{ familyMember: { id: string } }>('/members', {
        method: 'POST', body: JSON.stringify({
          fullName: form.fullName,
          relationship: form.relationship,
          ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
          ...(form.contactNumber ? { contactNumber: normalizedPhone(form.contactNumber) } : {}),
          ...(form.gender ? { gender: form.gender } : {}),
        }),
      });
      router.push(`/family/${result.familyMember.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add this family member.');
    } finally { setBusy(false); }
  };
  return (
    <FamilyPage>
      <div className="mx-auto max-w-2xl space-y-5">
        <Link className="text-sm font-semibold text-sky-800" href="/family">← Family members</Link>
        <section className={card}>
          <h1 className="text-3xl font-bold">Add a family member</h1>
          <p className="mt-2 text-slate-600">Only basic relationship details are stored. This does not create an account link or provide access to anyone’s records.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">Full name<input className={input} required maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoComplete="name" /></label>
            <label className="block text-sm font-semibold">Relationship<select className={input} value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value as FamilyRelationship })}><option value="PARENT">Parent</option><option value="SPOUSE">Spouse</option><option value="CHILD">Child</option><option value="SIBLING">Sibling</option><option value="OTHER">Other</option></select></label>
            <label className="block text-sm font-semibold">Date of birth (optional)<input className={input} type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
            <label className="block text-sm font-semibold">Contact number for invitation (optional)<input className={input} type="tel" inputMode="tel" placeholder="+919876543210" value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /><span className="mt-1 block font-normal text-slate-500">Use international format. An invitation can only be claimed by an account with this verified number.</span></label>
            <label className="block text-sm font-semibold">Gender (optional)<select className={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">Prefer not to provide</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="NON_BINARY">Non-binary</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select></label>
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <button className={button} disabled={busy}>{busy ? 'Saving…' : 'Add family member'}</button>
          </form>
        </section>
      </div>
    </FamilyPage>
  );
}

export function FamilyMemberPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [member, setMember] = useState<FamilyMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ fullName: '', dateOfBirth: '', relationship: 'OTHER' as FamilyRelationship, contactNumber: '', gender: '' });
  const [claimLink, setClaimLink] = useState('');
  const [records, setRecords] = useState<FamilyRecords | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await familyRequest<{ familyMember: FamilyMember }>('/members/' + encodeURIComponent(id));
      setMember(result.familyMember);
      setForm({ fullName: result.familyMember.fullName, dateOfBirth: result.familyMember.dateOfBirth?.slice(0, 10) ?? '', relationship: result.familyMember.relationship, contactNumber: result.familyMember.contactNumber ?? '', gender: result.familyMember.gender ?? '' });
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load this family member.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await familyRequest(`/members/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ fullName: form.fullName, relationship: form.relationship, dateOfBirth: form.dateOfBirth || null, contactNumber: form.contactNumber ? normalizedPhone(form.contactNumber) : null, gender: form.gender || null }) });
      setNotice('Family member details updated.'); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save changes.'); }
    finally { setBusy(false); }
  };
  const invite = async () => {
    setBusy(true); setError(''); setNotice(''); setClaimLink('');
    try {
      const result = await familyRequest<{ token: string; invitation: FamilyInvitationSummary; targetPhoneNumber: string }>('/members/' + encodeURIComponent(id) + '/invitations', { method: 'POST', body: '{}' });
      const link = `${window.location.origin}/family/invitations#token=${encodeURIComponent(result.token)}`;
      setClaimLink(link);
      setNotice(`Invitation link created for ${result.targetPhoneNumber}. It expires ${new Date(result.invitation.expiresAt).toLocaleString()}. Copy it and send it privately; the link contains no health information.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create invitation.'); }
    finally { setBusy(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(claimLink); setNotice('Invitation link copied. Share it privately with the invited person.'); }
    catch { setError('Clipboard access failed. Select and copy the invitation link below.'); }
  };
  const remove = async () => {
    if (!window.confirm('Remove this family relationship? Any invitation and family record access will be revoked.')) return;
    setBusy(true);
    try { await familyRequest(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' }); router.replace('/family'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove the family member.'); }
    finally { setBusy(false); }
  };
  const loadRecords = async () => {
    setBusy(true); setError('');
    try { const result = await familyRequest<FamilyRecords>(`/members/${encodeURIComponent(id)}/records`); setRecords(result); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to view family records.'); }
    finally { setBusy(false); }
  };
  if (loading) return <FamilyPage><p aria-live="polite" className="text-slate-600">Loading family member…</p></FamilyPage>;
  if (!member) return <FamilyPage><div className={card}><p role="alert" className="text-rose-700">{error || 'Family member unavailable.'}</p><Link className="mt-4 inline-block text-sky-800" href="/family">Return to family list</Link></div></FamilyPage>;
  return (
    <FamilyPage>
      <div className="mx-auto max-w-3xl space-y-5">
        <Link className="text-sm font-semibold text-sky-800" href="/family">← Family members</Link>
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-widest text-sky-700">{relationshipLabel(member.relationship)}</p><h1 className="mt-1 text-3xl font-bold">{member.fullName}</h1><p className="mt-2 text-sm text-slate-600">Access status: <strong>{statusLabel(member.accessStatus)}</strong></p></div><button className="min-h-11 rounded-xl border border-rose-300 px-4 text-sm font-semibold text-rose-700" disabled={busy} onClick={() => void remove()}>Remove member</button></div>
          {member.guardianRelationship && <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Guardian relationship is unverified. Health record access is disabled. HealthWallet has no legal verification process.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
          {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
          {claimLink && <div className="mt-3 space-y-2"><button className={secondary} onClick={() => void copyLink()}>Copy one-time invitation link</button><textarea readOnly aria-label="One-time invitation link" className={`${input} min-h-24 break-all`} value={claimLink} /></div>}
          <form onSubmit={save} className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Full name<input className={input} required maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
            <label className="text-sm font-semibold">Relationship<select className={input} value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value as FamilyRelationship })}><option value="PARENT">Parent</option><option value="SPOUSE">Spouse</option><option value="CHILD">Child</option><option value="SIBLING">Sibling</option><option value="OTHER">Other</option></select></label>
            <label className="text-sm font-semibold">Date of birth<input className={input} type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
            <label className="text-sm font-semibold">Contact number<input className={input} type="tel" placeholder="+919876543210" value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /></label>
            <label className="text-sm font-semibold sm:col-span-2">Gender<select className={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">Not provided</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="NON_BINARY">Non-binary</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><button className={button} disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button><button type="button" className={secondary} disabled={busy || member.accountLinked} onClick={() => void invite()}>{member.invitation ? 'Resend invitation' : 'Create invitation'}</button></div>
          </form>
        </section>
        {member.accessGrant && member.accessStatus === 'ACTIVE' && (
          <section className={card}><h2 className="text-xl font-bold">Records shared with you</h2><p className="mt-1 text-sm text-slate-600">The family member granted access until {new Date(member.accessGrant.expiresAt).toLocaleString()}.</p><p className="mt-2 text-sm">Permissions: {member.accessGrant.permissions.map((x) => permissionLabel(x.permissionType)).join(', ')}</p><button className={`${button} mt-4`} disabled={busy} onClick={() => void loadRecords()}>View permitted records</button>{records && <RecordDisplay records={records.records} familyMemberId={id} />}</section>
        )}
        {member.relationship === 'CHILD' && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">A parent or guardian relationship does not establish legal authority. No family record access can be granted for this relationship in this phase.</p>}
      </div>
    </FamilyPage>
  );
}

export function FamilyInvitationsPage() {
  const [data, setData] = useState<FamilyInvitationData | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [permissions, setPermissions] = useState<MedicalSharePermission[]>([]);
  const [durationDays, setDurationDays] = useState(7);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [availableDocuments, setAvailableDocuments] = useState<Array<{ id: string; title: string }>>([]);
  const { user } = useAuth();
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await familyRequest<FamilyInvitationData>('/invitations')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load invitations.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const linkToken = params.get('token');
    if (linkToken) {
      setToken(linkToken);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setNotice('Invitation link received. Review the invitation, then accept or reject it.');
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    void patientRequest<{ documents: Array<{ id: string; title: string }> }>('/documents?limit=100&page=1')
      .then((result) => setAvailableDocuments(result.documents))
      .catch(() => setAvailableDocuments([]));
  }, [user]);
  const actOnInvite = async (accept: boolean) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await familyRequest<{ accessStatus: string; guardianVerificationStatus: string | null }>(`/invitations/${accept ? 'accept' : 'reject'}`, { method: 'POST', body: JSON.stringify({ token }) });
      setToken('');
      setNotice(accept ? (result.guardianVerificationStatus ? 'Invitation accepted. Guardian status remains unverified, and no record access was created.' : 'Invitation accepted. No health records were shared. The family member must separately authorize any record access.') : 'Invitation rejected.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to process this invitation.'); }
    finally { setBusy(false); }
  };
  const toggle = (value: MedicalSharePermission) => setPermissions((old) => old.includes(value) ? old.filter((x) => x !== value) : [...old, value]);
  const grant = async (familyMemberId: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await familyRequest(`/members/${encodeURIComponent(familyMemberId)}/consent`, { method: 'POST', body: JSON.stringify({ permissionTypes: permissions, durationDays, ...(permissions.includes('MEDICAL_DOCUMENTS') ? { medicalDocumentIds: selectedDocuments } : {}) }) });
      setNotice('Your selected record access is now active. You can revoke it here at any time.');
      setPermissions([]); setSelectedDocuments([]); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to grant family access.'); }
    finally { setBusy(false); }
  };
  const revoke = async (familyMemberId: string) => {
    setBusy(true); setError('');
    try { await familyRequest(`/members/${encodeURIComponent(familyMemberId)}/consent/revoke`, { method: 'POST', body: '{}' }); setNotice('Family access revoked.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to revoke access.'); }
    finally { setBusy(false); }
  };
  const toggleDocument = (id: string) => setSelectedDocuments((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  const hasDocumentPermission = permissions.includes('MEDICAL_DOCUMENTS');
  return (
    <FamilyPage>
      <div className="mx-auto max-w-4xl space-y-5">
        <Link className="text-sm font-semibold text-sky-800" href="/family">← Family members</Link>
        <section className={card}>
          <h1 className="text-3xl font-bold">Family invitations and consent</h1>
          <p className="mt-2 text-slate-600">Accepting an invitation only links the relationship. It does not grant record access.</p>
          {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
          {notice && <p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{notice}</p>}
          <label className="mt-5 block text-sm font-semibold">Claim invitation token<input className={input} value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="Paste the one-time invitation token" autoComplete="off" /></label>
          {!user?.phoneVerified && <p className="mt-2 text-sm text-amber-800">A verified phone account matching the invitation is required.</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={!token || busy || !user?.phoneVerified} onClick={() => void actOnInvite(true)}>Accept invitation</button><button className={secondary} disabled={!token || busy || !user?.phoneVerified} onClick={() => void actOnInvite(false)}>Reject invitation</button></div>
        </section>
        <section className={card} aria-busy={loading}>
          <h2 className="text-xl font-bold">Invitations sent to this account</h2>
          {loading ? <p className="mt-3 text-slate-600">Loading…</p> : data?.receivedInvitations.length ? <ul className="mt-3 divide-y divide-slate-200">{data.receivedInvitations.map((invite) => <li key={invite.id} className="py-4"><p className="font-semibold">{invite.familyMember.fullName} invited you as {relationshipLabel(invite.familyMember.relationship)}</p><p className="mt-1 text-sm text-slate-600">From {invite.familyMember.ownerPatientProfile.fullName || 'a HealthWallet patient'} · expires {new Date(invite.expiresAt).toLocaleString()}</p><p className="mt-2 text-sm text-slate-700">No health information is included. Use the one-time claim link to accept or reject.</p></li>)}</ul> : !loading ? <p className="mt-3 text-sm text-slate-600">No pending invitations for your verified number.</p> : null}
        </section>
        <section className={card}>
          <h2 className="text-xl font-bold">Family links you accepted</h2>
          {data?.familyLinks.length ? <div className="mt-4 space-y-4">{data.familyLinks.map((link) => <article key={link.id} className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">{link.fullName} · {relationshipLabel(link.relationship)}</h3><p className="mt-1 text-sm text-slate-600">Connected to {link.ownerPatientProfile.fullName || 'a family member'} · {statusLabel(link.accessStatus)}</p>{link.accessStatus === 'GUARDIAN_UNVERIFIED_NO_ACCESS' || link.relationship === 'CHILD' ? <p className="mt-3 text-sm text-amber-900">Guardian authority is unverified. Record access is disabled.</p> : link.accessGrant ? <div className="mt-3"><p className="text-sm text-slate-700">You granted: {link.accessGrant.permissions.map((x) => permissionLabel(x.permissionType)).join(', ')} until {new Date(link.accessGrant.expiresAt).toLocaleString()}.</p><button className="mt-3 min-h-10 rounded-xl border border-rose-300 px-3 text-sm font-semibold text-rose-700" disabled={busy} onClick={() => void revoke(link.id)}>Revoke access</button></div> : <div className="mt-4 space-y-4"><p className="text-sm text-slate-600">Only you can authorize access to your records. Choose exactly what this family member can see.</p><div className="grid gap-2 sm:grid-cols-2">{permissionChoices.map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm"><input type="checkbox" checked={permissions.includes(value)} onChange={() => toggle(value)} />{label}</label>)}</div>{hasDocumentPermission && <div className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">Select reports</p>{availableDocuments.length ? availableDocuments.map((doc) => <label key={doc.id} className="mt-2 flex items-center gap-3 text-sm"><input type="checkbox" checked={selectedDocuments.includes(doc.id)} onChange={() => toggleDocument(doc.id)} />{doc.title}</label>) : <p className="mt-2 text-sm text-slate-600">No available reports to share.</p>}</div>}<label className="block text-sm font-semibold">Access duration<select className={input} value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label><button className={button} disabled={busy || !permissions.length || (hasDocumentPermission && !selectedDocuments.length)} onClick={() => void grant(link.id)}>Grant selected access</button></div>}</article>)}</div> : <p className="mt-3 text-sm text-slate-600">Accepted family links will appear here.</p>}
        </section>
        <section className={card}>
          <h2 className="text-xl font-bold">Invitations you sent</h2>
          {data?.sentInvitations.length ? <ul className="mt-3 divide-y divide-slate-200">{data.sentInvitations.map((invite) => <li key={invite.id} className="py-3"><p className="font-semibold">{invite.familyMember.fullName} · {relationshipLabel(invite.familyMember.relationship)}</p><p className="text-sm text-slate-600">{invite.targetPhoneNumber} · {invite.status.toLowerCase()} · expires {new Date(invite.expiresAt).toLocaleString()}</p></li>)}</ul> : <p className="mt-3 text-sm text-slate-600">No invitations sent.</p>}
        </section>
      </div>
    </FamilyPage>
  );
}

function RecordDisplay({ records, familyMemberId }: { records: Record<string, unknown>; familyMemberId: string }) {
  const sections = useMemo(() => Object.entries(records).filter(([, value]) => value !== null && value !== undefined), [records]);
  return <div className="mt-5 space-y-4">{sections.length ? sections.map(([key, value]) => <section key={key} className="rounded-xl bg-slate-50 p-4"><h3 className="font-bold">{humanize(key)}</h3>{Array.isArray(value) ? <ul className="mt-2 space-y-2">{value.map((item, index) => <li key={String((item as { id?: string }).id ?? index)} className="text-sm">{renderValue(item)}{key === 'medicalDocuments' && (item as { id?: string }).id ? <a className="ml-2 font-semibold text-sky-800" href={`${API_BASE}/api/patient/family/members/${encodeURIComponent(familyMemberId)}/documents/${encodeURIComponent((item as { id: string }).id)}/content`} target="_blank" rel="noreferrer">Open report</a> : null}</li>)}</ul> : <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{JSON.stringify(value, null, 2)}</pre>}</section>) : <p className="text-sm text-slate-600">No records are available in the categories you authorized.</p>}</div>;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = { NO_ACCESS: 'No record access', ACTIVE: 'Record access active', CONNECTED_NO_ACCESS: 'Connected · no record access', NOT_INVITED: 'Not invited', GUARDIAN_UNVERIFIED_NO_ACCESS: 'Guardian unverified · no access', PENDING: 'Invitation pending', ACCEPTED: 'Invitation accepted', REJECTED: 'Invitation rejected', REVOKED: 'Invitation revoked', EXPIRED: 'Invitation expired' };
  return labels[value] ?? value.replaceAll('_', ' ').toLowerCase();
}
function permissionLabel(value: string) { return permissionChoices.find(([key]) => key === value)?.[1] ?? value; }
function normalizedPhone(value: string) { const cleaned = value.replace(/[\s()-]/g, ''); return cleaned.startsWith('+') ? cleaned : `+91${cleaned}`; }
function humanize(value: string) { return value.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase()).trim(); }
function renderValue(value: unknown): string { if (value === null || value === undefined) return '—'; if (typeof value === 'object') return Object.entries(value).map(([key, inner]) => `${humanize(key)}: ${inner instanceof Date ? inner.toLocaleString() : String(inner ?? '—')}`).join(' · '); return String(value); }
