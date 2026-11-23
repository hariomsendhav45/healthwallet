'use client';

import { useEffect, useState } from 'react';
import { patientRequest } from '../../auth/patient-api';
import { PatientShell } from '../../components/patient-shell';
import { PredictiveHealthPanel } from '../../components/predictive-health-panel';

type Overview = { insights: Array<{ kind: string; title: string; why: string; confidence: string; supportingData: unknown; disclaimer: string }>; trends: Array<{ testName?: string; type?: string; unit?: string | null; points: Array<Record<string, unknown>>; change?: number; comparison?: string }>; recentReports: Array<{ id: string; title: string; date: string | null; reviewed: boolean }>; pendingOcrReviews: number; completeness: { percent: number; missing: string[] }; disclaimer: string };
type Document = { id: string; title: string; documentDate: string | null; ocrStatus?: string };
type Comparison = { reports: Array<{id:string;title:string;date:string|null;reviewed:boolean}>; comparisons: Array<{testName:string;unit:string|null;first:{value:number;source:{id:string;title:string;date:string|null}};second:{value:number;source:{id:string;title:string;date:string|null}};change:number}>; unmatched: Array<{testName:string;unit:string|null;reportId:string;reason:string}>; disclaimer:string };
function TrendChart({ trend, label }: { trend: Overview['trends'][number]; label: string }) {
  const points = trend.points.flatMap(point => {
    const date = typeof point.date === 'string' ? point.date : '';
    const values = typeof point.value === 'number' ? [{ key: 'value', value: point.value }] : [
      ...(typeof point.systolic === 'number' ? [{ key: 'systolic', value: point.systolic }] : []),
      ...(typeof point.diastolic === 'number' ? [{ key: 'diastolic', value: point.diastolic }] : []),
    ];
    return values.map(v => ({ ...v, date }));
  });
  if (points.length < 2) return null;
  const min = Math.min(...points.map(p => p.value)); const max = Math.max(...points.map(p => p.value)); const span = max - min || 1;
  const series = [...new Set(points.map(p => p.key))];
  return <figure className="mt-3"><svg viewBox="0 0 320 100" role="img" aria-label={`${label} numeric values over time`} className="h-28 w-full rounded-lg bg-[#f5f8f6] p-2">{series.map((key, s) => { const rows=points.filter(p=>p.key===key); const polyline=rows.map((p,i)=>`${rows.length<2?160:12+i*296/(rows.length-1)},${88-(p.value-min)/span*76}`).join(' '); return <g key={key}><polyline points={polyline} fill="none" stroke={s===0?'#0d5b50':'#e39b13'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{rows.map((p,i)=><circle key={`${key}-${i}`} cx={rows.length<2?160:12+i*296/(rows.length-1)} cy={88-(p.value-min)/span*76} r="3.5" fill={s===0?'#0d5b50':'#e39b13'}/>)}</g>; })}</svg><figcaption className="mt-1 text-xs text-slate-500">{series.join(' / ')} · numeric record values only</figcaption></figure>;
}

export default function Page() {
  const [data, setData] = useState<Overview | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      const [overview, docs] = await Promise.all([patientRequest<Overview>('/health-intelligence/overview'), patientRequest<{ documents: Document[] }>('/documents?page=1&limit=100')]);
      setData(overview); setDocuments(docs.documents); setFirst(docs.documents[0]?.id ?? ''); setSecond(docs.documents[1]?.id ?? '');
    } catch { setError('Could not load your health insights. Please retry.'); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function compare() {
    setBusy(true); setError(''); setComparison(null);
    try { setComparison(await patientRequest<Comparison>('/health-intelligence/compare', { method: 'POST', body: JSON.stringify({ firstDocumentId: first, secondDocumentId: second }) })); }
    catch { setError('These reports could not be compared. Both must belong to you and have reviewed OCR values.'); }
    finally { setBusy(false); }
  }
  return <PatientShell><div className="mx-auto max-w-5xl">
    <header className="mb-6"><p className="text-sm font-bold uppercase tracking-widest text-[#155c50]">Your records over time</p><h1 className="mt-2 text-3xl font-bold text-[#172923]">Health insights</h1><p className="mt-2 text-slate-600">Numeric changes and report flags are shown only when present in your own reviewed records.</p></header>
    <PredictiveHealthPanel />
    {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-800">{error} <button className="ml-2 font-semibold underline" onClick={() => void load()}>Retry</button></p>}
    {loading ? <p role="status" className="rounded-2xl bg-white p-6">Loading your records…</p> : data && <>
      <section className="grid gap-4 sm:grid-cols-3"><article className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-600">Profile information</p><p className="mt-2 text-3xl font-bold">{data.completeness.percent}%</p><p className="mt-1 text-sm text-slate-500">{data.completeness.missing.length ? `Missing: ${data.completeness.missing.join(', ')}` : 'No listed profile gaps'}</p></article><article className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-600">Reports needing OCR review</p><p className="mt-2 text-3xl font-bold">{data.pendingOcrReviews}</p></article><article className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-600">Reviewed reports</p><p className="mt-2 text-3xl font-bold">{data.recentReports.filter(r => r.reviewed).length}</p></article></section>
      <section className="mt-5 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Record-based observations</h2>{data.insights.length ? <ul className="mt-4 space-y-3">{data.insights.map((insight, i) => <li key={`${insight.kind}-${i}`} className="rounded-xl bg-[#f2f6f4] p-4"><h3 className="font-semibold">{insight.title}</h3><p className="mt-1 text-sm leading-6 text-slate-700">{insight.why}</p><p className="mt-2 text-xs text-slate-500">{insight.confidence} · {JSON.stringify(insight.supportingData)}</p></li>)}</ul> : <p className="mt-3 text-slate-600">No explicit report flags found in patient-reviewed OCR. This does not indicate that all results are normal.</p>}</section>
      <section className="mt-5 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Trends</h2>{data.trends.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{data.trends.map((trend, i) => {const label=trend.testName ?? trend.type?.replaceAll('-', ' ') ?? 'Measurement';return <article key={`${label}-${i}`} className="rounded-xl border p-4"><h3 className="font-semibold">{label}{trend.unit ? ` · ${trend.unit}` : ''}</h3><p className="mt-1 text-sm text-slate-600">{trend.comparison} {typeof trend.change === 'number' ? `Recorded change: ${trend.change}` : ''}</p><TrendChart trend={trend} label={label}/><ol className="mt-2 space-y-1 text-sm">{trend.points.map((point, j) => <li key={j}>{JSON.stringify(point)}</li>)}</ol></article>})}</div> : <p className="mt-3 text-slate-600">Two or more compatible historical values are needed to show a trend.</p>}</section>
      <section className="mt-5 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Compare reports</h2><p className="mt-1 text-sm text-slate-600">Only matching test names and units with patient-reviewed OCR are compared.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><select aria-label="First report" value={first} onChange={e => setFirst(e.target.value)} className="min-h-11 rounded-xl border p-2"><option value="">Choose report</option>{documents.map(d => <option key={d.id} value={d.id}>{d.title} · {d.documentDate?.slice(0,10) ?? 'No date'}</option>)}</select><select aria-label="Second report" value={second} onChange={e => setSecond(e.target.value)} className="min-h-11 rounded-xl border p-2"><option value="">Choose report</option>{documents.map(d => <option key={d.id} value={d.id}>{d.title} · {d.documentDate?.slice(0,10) ?? 'No date'}</option>)}</select></div><button disabled={!first||!second||first===second||busy} onClick={() => void compare()} className="mt-3 min-h-11 rounded-xl bg-[#0d5b50] px-5 font-semibold text-white disabled:opacity-50">{busy?'Comparing…':'Compare reports'}</button>{comparison && <div className="mt-4 space-y-3" aria-live="polite">{comparison.comparisons.length?comparison.comparisons.map((row,i)=><article key={`${row.testName}-${i}`} className="rounded-xl bg-[#f2f6f4] p-4"><h3 className="font-semibold">{row.testName}{row.unit?` · ${row.unit}`:''}</h3><p className="mt-2 text-sm">{row.first.value} → {row.second.value} · recorded change {row.change}</p><p className="mt-1 text-xs text-slate-600"><a className="underline" href={`/medical-records/${row.first.source.id}`}>{row.first.source.title}</a> ({row.first.source.date?.slice(0,10)??'undated'}) → <a className="underline" href={`/medical-records/${row.second.source.id}`}>{row.second.source.title}</a> ({row.second.source.date?.slice(0,10)??'undated'})</p></article>):<p className="rounded-xl bg-slate-50 p-4 text-slate-700">No matching reviewed test values were found. Review OCR on both reports first.</p>}{comparison.unmatched.length>0&&<p className="text-sm text-slate-600">Not compared: {comparison.unmatched.map(item=>`${item.testName}${item.unit?` (${item.unit})`:''}`).join(', ')}. Test names and units must match exactly.</p>}<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{comparison.disclaimer}</p></div>}</section>
      <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">{data.disclaimer}</p>
    </>}
  </div></PatientShell>;
}
