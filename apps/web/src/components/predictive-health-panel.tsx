'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { patientRequest } from '../auth/patient-api';

type Source = { kind: string; id: string; title?: string; observedAt: string };
type RiskTrends = {
  analysisType: string;
  generatedAt: string;
  ruleVersion: string;
  validationStatus: string;
  modelBasedRisk: { available: boolean; reason: string };
  observationPeriod: { start: string | null; end: string | null };
  dataCoverage: { bloodPressure: number; bloodGlucose: number; reviewedLabValues: number; reviewedLabSeries: number; bmi: string };
  persistentReportedFlags: Array<{ kind: string; series: string; observationCount: number; observations: Array<{ value: number; unit: string; flag: string | null; observedAt: string; source: Source }>; interpretation: string }>;
  statisticalTrends: Array<{ series: string; unit: string; result: { direction: string; directionalUncertainty: string; slopePer30Days: number; descriptive95PercentIntervalPer30Days: [number, number]; intervalNote: string; observationCount: number; observationPeriod: { start: string; end: string; spanDays: number }; sources: Source[] } }>;
  statisticalDeviations: Array<{ kind: string; measurement: string; unit: string; current: { value: number; observedAt: string; source: Source }; baseline: { median: number; mad: number; observationCount: number; sources: Source[] }; robustDeviationMultiple: number; interpretation: string }>;
  dataQualityIssues: Array<Record<string, unknown>>;
  insufficientData: Array<{ measurement: string; reason: string; observationCount?: number; requiredCount?: number; observedSpanDays?: number; requiredSpanDays?: number }>;
  ruleProvenance: { version: string; minimumTrendPoints: number; minimumTrendSpanDays: number; deviationHeuristic: string; validationStatus: string };
  limitations: string[];
};

function date(value: string | null) { return value ? new Date(value).toLocaleDateString() : 'Not recorded'; }
function sourceLink(source: Source) {
  return source.kind === 'medical-document'
    ? <Link className="underline" href={`/medical-records/${encodeURIComponent(source.id)}`}>{source.title ?? 'Medical report'}</Link>
    : <Link className="underline" href="/health-tracking">{source.kind === 'blood-pressure' ? 'Blood-pressure reading' : 'Blood-glucose reading'}</Link>;
}

export function PredictiveHealthPanel() {
  const [data, setData] = useState<RiskTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await patientRequest<RiskTrends>('/health-intelligence/risk-trends')); }
    catch { setError('Could not load descriptive health trends. Retry when your connection is available.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <section id="risk-trends" className="mt-5 rounded-2xl border border-[#d2ddd8] bg-white p-5" aria-labelledby="risk-trends-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-widest text-[#155c50]">Preventive intelligence</p><h2 id="risk-trends-title" className="mt-1 text-xl font-bold text-[#172923]">Health risk trends</h2><p className="mt-1 text-sm text-slate-600">Descriptive comparisons to your own measurements and reviewed report flags.</p></div><button onClick={() => void load()} disabled={loading} className="min-h-10 rounded-xl border border-[#0d5b50] px-3 text-sm font-semibold text-[#0d5b50] disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button></div>
    {loading && <p role="status" className="mt-4 text-sm text-slate-600">Analyzing only your saved records…</p>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {data && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><article className="rounded-xl bg-[#f5f8f6] p-3"><p className="text-xs text-slate-600">Blood-pressure readings</p><p className="mt-1 text-xl font-bold">{data.dataCoverage.bloodPressure}</p></article><article className="rounded-xl bg-[#f5f8f6] p-3"><p className="text-xs text-slate-600">Blood-glucose readings</p><p className="mt-1 text-xl font-bold">{data.dataCoverage.bloodGlucose}</p></article><article className="rounded-xl bg-[#f5f8f6] p-3"><p className="text-xs text-slate-600">Reviewed lab values</p><p className="mt-1 text-xl font-bold">{data.dataCoverage.reviewedLabValues}</p></article></div>
      <p className="mt-3 text-xs text-slate-500">Observation period: {date(data.observationPeriod.start)} – {date(data.observationPeriod.end)} · Generated {new Date(data.generatedAt).toLocaleString()} · Rule version {data.ruleVersion}</p>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-950">No validated risk model is configured</p><p className="mt-1 text-sm leading-6 text-amber-900">{data.modelBasedRisk.reason} These results are not a diagnosis, health-risk probability, or forecast.</p></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border p-4"><h3 className="font-semibold">Repeated report flags</h3>{data.persistentReportedFlags.length ? <ul className="mt-3 space-y-3">{data.persistentReportedFlags.map((item,index)=><li key={`${item.series}-${index}`} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{item.series} · explicitly flagged in {item.observationCount} reviewed reports</p><ul className="mt-2 space-y-1 text-sm text-slate-600">{item.observations.map((observation,i)=><li key={i}>{observation.value} {observation.unit} · {observation.flag ?? 'flag'} · {date(observation.observedAt)} · {sourceLink(observation.source)}</li>)}</ul><p className="mt-2 text-xs text-slate-500">{item.interpretation}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No repeated explicit flags were found in reviewed report values. This does not mean that every result is normal.</p>}</section>
        <section className="rounded-xl border p-4"><h3 className="font-semibold">Statistical trends</h3>{data.statisticalTrends.length ? <ul className="mt-3 space-y-3">{data.statisticalTrends.map((item,index)=><li key={`${item.series}-${index}`} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{item.series} · {item.unit}</p><p className="mt-1 text-sm">{item.result.direction.replaceAll('-', ' ')} · slope {item.result.slopePer30Days} {item.unit} / 30 days</p><p className="mt-1 text-xs text-slate-600">{item.result.directionalUncertainty.replaceAll('_',' ').toLowerCase()} · Approx. 95% interval: {item.result.descriptive95PercentIntervalPer30Days[0]} to {item.result.descriptive95PercentIntervalPer30Days[1]} · {item.result.observationCount} observations from {date(item.result.observationPeriod.start)} to {date(item.result.observationPeriod.end)}</p><p className="mt-1 text-xs text-slate-500">{item.result.intervalNote}</p><ul className="mt-2 space-y-1 text-xs text-slate-600">{item.result.sources.slice(0,5).map((source,i)=><li key={`${source.id}-${i}`}>{date(source.observedAt)} · {sourceLink(source)}</li>)}</ul></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No series currently meets the minimum of {data.ruleProvenance.minimumTrendPoints} compatible readings over {data.ruleProvenance.minimumTrendSpanDays} days.</p>}</section>
        <section className="rounded-xl border p-4"><h3 className="font-semibold">Differences from personal history</h3>{data.statisticalDeviations.length ? <ul className="mt-3 space-y-3">{data.statisticalDeviations.map((item,index)=><li key={`${item.measurement}-${index}`} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{item.measurement}: {item.current.value} {item.unit} · {date(item.current.observedAt)}</p><p className="mt-1 text-sm text-slate-600">Personal-history median: {item.baseline.median} · {item.robustDeviationMultiple} MAD · {sourceLink(item.current.source)}</p><p className="mt-1 text-xs text-slate-500">{item.interpretation}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No measured value exceeded the descriptive personal-history deviation heuristic.</p>}</section>
        <section className="rounded-xl border p-4"><h3 className="font-semibold">Data quality and missing history</h3>{data.dataQualityIssues.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{data.dataQualityIssues.slice(0,8).map((issue,index)=><li key={index}>{String(issue.kind ?? 'Data issue')} · {String(issue.measurement ?? '')}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No structural data-quality issues were found in the analyzed sample.</p>}<ul className="mt-3 space-y-2 text-sm text-slate-700">{data.insufficientData.slice(0,8).map((item,index)=><li key={`${item.measurement}-${index}`}><span className="font-medium">{item.measurement}:</span> {item.reason}</li>)}</ul><p className="mt-3 text-xs text-slate-500">BMI availability: {data.dataCoverage.bmi.replaceAll('_',' ').toLowerCase()}.</p></section>
      </div>
      <details className="mt-4 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Method and limitations</summary><p className="mt-2 text-xs text-slate-600">Deviation rule: {data.ruleProvenance.deviationHeuristic}. Validation: {data.ruleProvenance.validationStatus.replaceAll('_',' ').toLowerCase()}.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">{data.limitations.map(item=><li key={item}>{item}</li>)}</ul></details>
    </>}
  </section>;
}
