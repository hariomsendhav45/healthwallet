'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PatientShell } from './patient-shell';
import { patientRequest } from '../auth/patient-api';
import type {
  BloodGlucoseReading as GlucoseReading,
  BloodPressureReading as BPReading,
  GlucoseMeasurementType,
  GlucoseUnit,
  HealthTrackingSummary,
  PaginatedResponse,
} from '@healthvault/shared';
type Summary = HealthTrackingSummary;
type EditTarget = { kind: 'bp' | 'glucose'; id: string } | null;

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7';
const field = 'mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100';
const label = 'block text-sm font-semibold text-slate-700';
const measurementTypes: Array<[GlucoseMeasurementType, string]> = [
  ['FASTING', 'Fasting'], ['POST_MEAL', 'Post-meal'], ['RANDOM', 'Random'],
  ['BEFORE_MEAL', 'Before meal'], ['AFTER_MEAL', 'After meal'], ['BEDTIME', 'Bedtime'], ['OTHER', 'Other'],
];

function localDateTime(value = new Date()) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function isoDate(value: Date) {
  const offsetDate = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function errorMessage(error: unknown) {
  if (error instanceof TypeError) return 'HealthWallet could not connect. Check your connection and retry. No reading was saved offline.';
  return error instanceof Error ? error.message : 'Unable to complete this request.';
}
function ChartCard({ title, unit, readings, lines }: { title: string; unit: string; readings: Array<Record<string, string | number>>; lines: Array<{ key: string; name: string; color: string }> }) {
  return (
    <section className={`${card} min-w-0 overflow-hidden`}>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">Measurements in {unit}</p>
      {readings.length === 0 ? (
        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No readings for this unit in the selected date range.</p>
      ) : (
        <>
          <div className="mt-4 h-64 min-w-0 max-w-full w-full overflow-hidden" role="img" aria-label={`${title} trend chart in ${unit}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={readings} margin={{ top: 8, right: 12, bottom: 8, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis width={52} tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip />
                <Legend />
                {lines.map((line) => <Line key={line.key} type="linear" dataKey={line.key} name={line.name} stroke={line.color} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="sr-only">
            <ul>{readings.map((reading, index) => <li key={index}>{String(reading.date)}: {lines.map((line) => `${line.name} ${reading[line.key]} ${unit}`).join(', ')}</li>)}</ul>
          </div>
        </>
      )}
    </section>
  );
}

export function HealthTrackingPage() {
  const [bp, setBp] = useState<BPReading[]>([]);
  const [glucose, setGlucose] = useState<GlucoseReading[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bpTotalPages, setBpTotalPages] = useState(1);
  const [glucoseTotalPages, setGlucoseTotalPages] = useState(1);
  const [bpNextPage, setBpNextPage] = useState(2);
  const [glucoseNextPage, setGlucoseNextPage] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [edit, setEdit] = useState<EditTarget>(null);
  const [bpValues, setBpValues] = useState({ systolic: '', diastolic: '', heartRate: '', measuredAt: localDateTime(), notes: '' });
  const [glucoseValues, setGlucoseValues] = useState({ glucoseValue: '', glucoseUnit: 'MG_DL' as GlucoseUnit, measurementType: 'FASTING' as GlucoseMeasurementType, measuredAt: localDateTime(), notes: '' });

  const dateRange = useMemo(() => {
    if (range === 'custom') return { start: customStart, end: customEnd };
    const today = new Date();
    const end = isoDate(today);
    const start = new Date(today);
    if (range === '180') start.setMonth(start.getMonth() - 6);
    else if (range === '365') start.setFullYear(start.getFullYear() - 1);
    else start.setDate(start.getDate() - Number(range) + 1);
    return { start: isoDate(start), end };
  }, [range, customStart, customEnd]);
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: '1', pageSize: '100', sort: 'DESC' });
    if (dateRange.start) params.set('startDate', new Date(`${dateRange.start}T00:00:00`).toISOString());
    if (dateRange.end) {
      const endExclusive = new Date(`${dateRange.end}T00:00:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      params.set('endDate', endExclusive.toISOString());
    }
    return params.toString();
  }, [dateRange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setBp([]); setGlucose([]); setSummary(null);
    try {
      const [bpResult, glucoseResult, summaryResult] = await Promise.all([
        patientRequest<PaginatedResponse<BPReading>>(`/health-tracking/blood-pressure?${query}`),
        patientRequest<PaginatedResponse<GlucoseReading>>(`/health-tracking/blood-glucose?${query}`),
        patientRequest<Summary>(`/health-tracking/summary?${new URLSearchParams(Object.fromEntries([...new URLSearchParams(query)].filter(([key]) => !['page', 'pageSize', 'sort'].includes(key)))).toString()}`),
      ]);
      setBp(bpResult.readings);
      setGlucose(glucoseResult.readings);
      setSummary(summaryResult);
      setBpTotalPages(bpResult.pagination.totalPages); setGlucoseTotalPages(glucoseResult.pagination.totalPages);
      setBpNextPage(2); setGlucoseNextPage(2);
    } catch (reason) {
      setBp([]); setGlucose([]); setSummary(null);
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  const requestWrite = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', data?: object) => {
    await patientRequest(path, { method, ...(data ? { body: JSON.stringify(data) } : {}) });
    setStatus(method === 'DELETE' ? 'Reading deleted.' : edit ? 'Reading updated.' : 'Reading saved.');
    setError('');
    setEdit(null);
    setBpValues({ systolic: '', diastolic: '', heartRate: '', measuredAt: localDateTime(), notes: '' });
    setGlucoseValues({ glucoseValue: '', glucoseUnit: 'MG_DL', measurementType: 'FASTING', measuredAt: localDateTime(), notes: '' });
    await load();
  };

  const submitBp = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setStatus('');
    try {
      const body = { systolic: Number(bpValues.systolic), diastolic: Number(bpValues.diastolic), heartRate: bpValues.heartRate ? Number(bpValues.heartRate) : null, measuredAt: new Date(bpValues.measuredAt).toISOString(), notes: bpValues.notes || null };
      await requestWrite(`/health-tracking/blood-pressure${edit?.kind === 'bp' ? `/${edit.id}` : ''}`, edit?.kind === 'bp' ? 'PATCH' : 'POST', body);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const submitGlucose = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setStatus('');
    try {
      const body = { glucoseValue: Number(glucoseValues.glucoseValue), glucoseUnit: glucoseValues.glucoseUnit, measurementType: glucoseValues.measurementType, measuredAt: new Date(glucoseValues.measuredAt).toISOString(), notes: glucoseValues.notes || null };
      await requestWrite(`/health-tracking/blood-glucose${edit?.kind === 'glucose' ? `/${edit.id}` : ''}`, edit?.kind === 'glucose' ? 'PATCH' : 'POST', body);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const beginEditBp = (reading: BPReading) => {
    setEdit({ kind: 'bp', id: reading.id });
    setBpValues({ systolic: String(reading.systolic), diastolic: String(reading.diastolic), heartRate: reading.heartRate == null ? '' : String(reading.heartRate), measuredAt: localDateTime(new Date(reading.measuredAt)), notes: reading.notes ?? '' });
    document.getElementById('blood-pressure-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const beginEditGlucose = (reading: GlucoseReading) => {
    setEdit({ kind: 'glucose', id: reading.id });
    setGlucoseValues({ glucoseValue: String(reading.glucoseValue), glucoseUnit: reading.glucoseUnit, measurementType: reading.measurementType, measuredAt: localDateTime(new Date(reading.measuredAt)), notes: reading.notes ?? '' });
    document.getElementById('blood-glucose-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const deleteReading = async (kind: 'bp' | 'glucose', id: string) => {
    if (!window.confirm('Delete this reading? This action cannot be undone.')) return;
    setBusy(true); setError(''); setStatus('');
    try { await requestWrite(`/health-tracking/${kind === 'bp' ? 'blood-pressure' : 'blood-glucose'}/${id}`, 'DELETE'); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const loadMore = async (kind: 'bp' | 'glucose') => {
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams(query);
      params.set('page', String(kind === 'bp' ? bpNextPage : glucoseNextPage));
      if (kind === 'bp') {
        const result = await patientRequest<PaginatedResponse<BPReading>>(`/health-tracking/blood-pressure?${params}`);
        setBp((current) => [...current, ...result.readings]); setBpNextPage((page) => page + 1);
      } else {
        const result = await patientRequest<PaginatedResponse<GlucoseReading>>(`/health-tracking/blood-glucose?${params}`);
        setGlucose((current) => [...current, ...result.readings]); setGlucoseNextPage((page) => page + 1);
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const cancelEdit = () => { setEdit(null); setBpValues({ systolic: '', diastolic: '', heartRate: '', measuredAt: localDateTime(), notes: '' }); setGlucoseValues({ glucoseValue: '', glucoseUnit: 'MG_DL', measurementType: 'FASTING', measuredAt: localDateTime(), notes: '' }); };

  const bpChart = useMemo(() => [...bp].reverse().map((reading) => ({ date: dateLabel(reading.measuredAt), systolic: reading.systolic, diastolic: reading.diastolic })), [bp]);
  const glucoseMg = useMemo(() => [...glucose].reverse().filter((r) => r.glucoseUnit === 'MG_DL').map((r) => ({ date: dateLabel(r.measuredAt), value: r.glucoseValue })), [glucose]);
  const glucoseMmol = useMemo(() => [...glucose].reverse().filter((r) => r.glucoseUnit === 'MMOL_L').map((r) => ({ date: dateLabel(r.measuredAt), value: r.glucoseValue })), [glucose]);

  return (
    <PatientShell>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-sky-700">Your health space</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Health tracking</h1>
        <p className="mt-2 text-slate-600">Record and review your own blood pressure and glucose measurements.</p>
      </div>
      <section className={`${card} mb-5`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Health summary</h2>
            <p className="mt-1 text-sm text-slate-500">Counts reflect the selected date range.</p>
          </div>
          <label className={`${label} min-w-48`}>
            Date range
            <select className={field} value={range} onChange={(event) => setRange(event.target.value)}>
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 1 year</option><option value="custom">Custom range</option>
            </select>
          </label>
        </div>
        {range === 'custom' && <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className={label}>From<input className={field} type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></label><label className={label}>To<input className={field} type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></label></div>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-sky-50 p-4"><p className="text-sm font-semibold text-sky-900">Blood pressure readings in range</p><p className="mt-1 text-2xl font-bold text-slate-900">{summary?.bloodPressureReadingsInRange ?? '—'}</p><p className="mt-1 text-sm text-slate-600">Total recorded: {summary?.totalBloodPressureReadings ?? '—'}</p><p className="mt-3 text-sm text-slate-700">Latest: {summary?.latestBloodPressureReading ? `${summary.latestBloodPressureReading.systolic}/${summary.latestBloodPressureReading.diastolic} mmHg · ${dateLabel(summary.latestBloodPressureReading.measuredAt)}` : 'No reading yet'}</p></div>
          <div className="rounded-xl bg-violet-50 p-4"><p className="text-sm font-semibold text-violet-900">Blood glucose readings in range</p><p className="mt-1 text-2xl font-bold text-slate-900">{summary?.glucoseReadingsInRange ?? '—'}</p><p className="mt-1 text-sm text-slate-600">Total recorded: {summary?.totalGlucoseReadings ?? '—'}</p><p className="mt-3 text-sm text-slate-700">Latest: {summary?.latestGlucoseReading ? `${summary.latestGlucoseReading.glucoseValue} ${summary.latestGlucoseReading.glucoseUnit === 'MG_DL' ? 'mg/dL' : 'mmol/L'} · ${dateLabel(summary.latestGlucoseReading.measuredAt)}` : 'No reading yet'}</p></div>
        </div>
      </section>
      {error && <div className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-800"><p role="alert">{error}</p><button type="button" onClick={() => void load()} className="mt-2 font-semibold underline">Retry loading readings</button></div>}
      {status && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-emerald-800">{status}</p>}
      {loading && <p aria-live="polite" className="mb-4 text-slate-600">Loading your readings…</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        <form id="blood-pressure-form" onSubmit={submitBp} className={card}>
          <h2 className="text-xl font-bold text-slate-900">{edit?.kind === 'bp' ? 'Edit blood pressure reading' : 'Record blood pressure'}</h2>
          <p className="mt-1 text-sm text-slate-500">Blood pressure uses mmHg. Heart rate is optional and uses bpm.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={label}>Systolic (mmHg)<input required type="number" min="1" max="1000" inputMode="numeric" className={field} value={bpValues.systolic} onChange={(e) => setBpValues({ ...bpValues, systolic: e.target.value })} /></label>
            <label className={label}>Diastolic (mmHg)<input required type="number" min="1" max="1000" inputMode="numeric" className={field} value={bpValues.diastolic} onChange={(e) => setBpValues({ ...bpValues, diastolic: e.target.value })} /></label>
            <label className={label}>Heart rate (bpm, optional)<input type="number" min="1" max="1000" inputMode="numeric" className={field} value={bpValues.heartRate} onChange={(e) => setBpValues({ ...bpValues, heartRate: e.target.value })} /></label>
            <label className={label}>Measurement date &amp; time<input required type="datetime-local" className={field} value={bpValues.measuredAt} onChange={(e) => setBpValues({ ...bpValues, measuredAt: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">Notes (optional)<textarea maxLength={1000} className={`${field} min-h-24 py-3`} value={bpValues.notes} onChange={(e) => setBpValues({ ...bpValues, notes: e.target.value })} /></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} className="min-h-12 rounded-xl bg-sky-700 px-5 font-semibold text-white disabled:opacity-60">{busy ? 'Saving…' : edit?.kind === 'bp' ? 'Save changes' : 'Save reading'}</button>{edit?.kind === 'bp' && <button type="button" onClick={cancelEdit} className="min-h-12 rounded-xl border border-slate-300 px-5 font-semibold text-slate-700">Cancel edit</button>}</div>
        </form>
        <form id="blood-glucose-form" onSubmit={submitGlucose} className={card}>
          <h2 className="text-xl font-bold text-slate-900">{edit?.kind === 'glucose' ? 'Edit glucose reading' : 'Record blood glucose'}</h2>
          <p className="mt-1 text-sm text-slate-500">Your original selected unit is kept; values are not silently converted.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={label}>Glucose value<input required type="number" min="0.01" max="2000" step="0.01" inputMode="decimal" className={field} value={glucoseValues.glucoseValue} onChange={(e) => setGlucoseValues({ ...glucoseValues, glucoseValue: e.target.value })} /></label>
            <label className={label}>Unit<select className={field} value={glucoseValues.glucoseUnit} onChange={(e) => setGlucoseValues({ ...glucoseValues, glucoseUnit: e.target.value as GlucoseUnit })}><option value="MG_DL">mg/dL</option><option value="MMOL_L">mmol/L</option></select></label>
            <label className={label}>Measurement type<select className={field} value={glucoseValues.measurementType} onChange={(e) => setGlucoseValues({ ...glucoseValues, measurementType: e.target.value as GlucoseMeasurementType })}>{measurementTypes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label className={label}>Measurement date &amp; time<input required type="datetime-local" className={field} value={glucoseValues.measuredAt} onChange={(e) => setGlucoseValues({ ...glucoseValues, measuredAt: e.target.value })} /></label>
            <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">Notes (optional)<textarea maxLength={1000} className={`${field} min-h-24 py-3`} value={glucoseValues.notes} onChange={(e) => setGlucoseValues({ ...glucoseValues, notes: e.target.value })} /></label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} className="min-h-12 rounded-xl bg-violet-700 px-5 font-semibold text-white disabled:opacity-60">{busy ? 'Saving…' : edit?.kind === 'glucose' ? 'Save changes' : 'Save reading'}</button>{edit?.kind === 'glucose' && <button type="button" onClick={cancelEdit} className="min-h-12 rounded-xl border border-slate-300 px-5 font-semibold text-slate-700">Cancel edit</button>}</div>
        </form>
      </div>
      <section className="mt-5">
        <h2 className="mb-4 text-xl font-bold text-slate-900">Trends</h2>
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <ChartCard title="Blood pressure" unit="mmHg" readings={bpChart} lines={[{ key: 'systolic', name: 'Systolic', color: '#0369a1' }, { key: 'diastolic', name: 'Diastolic', color: '#7c3aed' }]} />
          <div className="grid min-w-0 gap-5">
            <ChartCard title="Blood glucose" unit="mg/dL" readings={glucoseMg} lines={[{ key: 'value', name: 'Glucose', color: '#7c3aed' }]} />
            <ChartCard title="Blood glucose" unit="mmol/L" readings={glucoseMmol} lines={[{ key: 'value', name: 'Glucose', color: '#0f766e' }]} />
          </div>
        </div>
      </section>
      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
        <section className={`${card} min-w-0`}>
          <h2 className="text-xl font-bold text-slate-900">Blood pressure history</h2>
          {bp.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-slate-600">No blood pressure readings in this date range.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><caption className="sr-only">Blood pressure readings</caption><thead><tr className="border-b text-slate-500"><th className="py-2 pr-3">Measured</th><th className="py-2 pr-3">Pressure</th><th className="py-2 pr-3">Heart rate</th><th className="py-2">Actions</th></tr></thead><tbody>{bp.map((reading) => <tr key={reading.id} className="border-b border-slate-100 align-top"><td className="py-3 pr-3">{dateLabel(reading.measuredAt)}</td><td className="py-3 pr-3 font-semibold">{reading.systolic}/{reading.diastolic} mmHg{reading.notes && <p className="mt-1 max-w-52 break-words font-normal text-slate-500">{reading.notes}</p>}</td><td className="py-3 pr-3">{reading.heartRate == null ? '—' : `${reading.heartRate} bpm`}</td><td className="py-3"><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => beginEditBp(reading)} className="font-semibold text-sky-800 underline">Edit</button><button type="button" disabled={busy} onClick={() => void deleteReading('bp', reading.id)} className="font-semibold text-rose-700 underline">Delete</button></div></td></tr>)}</tbody></table></div>}
          {bp.length > 0 && bpNextPage <= bpTotalPages && <button type="button" disabled={busy} onClick={() => void loadMore('bp')} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700">Load more blood pressure readings</button>}
        </section>
        <section className={`${card} min-w-0`}>
          <h2 className="text-xl font-bold text-slate-900">Blood glucose history</h2>
          {glucose.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-slate-600">No glucose readings in this date range.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Blood glucose readings</caption><thead><tr className="border-b text-slate-500"><th className="py-2 pr-3">Measured</th><th className="py-2 pr-3">Value</th><th className="py-2 pr-3">Type</th><th className="py-2">Actions</th></tr></thead><tbody>{glucose.map((reading) => <tr key={reading.id} className="border-b border-slate-100 align-top"><td className="py-3 pr-3">{dateLabel(reading.measuredAt)}</td><td className="py-3 pr-3 font-semibold">{reading.glucoseValue} {reading.glucoseUnit === 'MG_DL' ? 'mg/dL' : 'mmol/L'}{reading.notes && <p className="mt-1 max-w-52 break-words font-normal text-slate-500">{reading.notes}</p>}</td><td className="py-3 pr-3">{measurementTypes.find(([type]) => type === reading.measurementType)?.[1]}</td><td className="py-3"><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => beginEditGlucose(reading)} className="font-semibold text-sky-800 underline">Edit</button><button type="button" disabled={busy} onClick={() => void deleteReading('glucose', reading.id)} className="font-semibold text-rose-700 underline">Delete</button></div></td></tr>)}</tbody></table></div>}
          {glucose.length > 0 && glucoseNextPage <= glucoseTotalPages && <button type="button" disabled={busy} onClick={() => void loadMore('glucose')} className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 font-semibold text-slate-700">Load more glucose readings</button>}
        </section>
      </div>
      <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">HealthWallet records measurements and does not diagnose or provide treatment advice. Ask a qualified healthcare professional to interpret readings. Do not rely on this app for urgent care; seek timely medical help for concerning symptoms or readings.</p>
    </PatientShell>
  );
}
