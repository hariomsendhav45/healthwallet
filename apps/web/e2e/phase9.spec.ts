import { expect, test } from '@playwright/test';

const patient = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'PATIENT',
  phoneNumber: '+919999999999',
  phoneVerified: true,
  accountStatus: 'ACTIVE',
  doctorVerificationStatus: null,
};

function api(page: import('@playwright/test').Page) {
  return page.route('http://localhost:4000/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/api/auth/me')) return route.fulfill({ json: { user: patient } });
    if (pathname.endsWith('/api/auth/refresh')) return route.fulfill({ status: 401, json: { message: 'No session' } });
    if (pathname.endsWith('/api/patient/profile/completion')) return route.fulfill({ json: { completionPercent: 50, missingFields: ['dateOfBirth', 'gender'] } });
    if (pathname.endsWith('/api/patient/profile')) return route.fulfill({ json: { profile: { fullName: 'Synthetic Patient' } } });
    if (pathname.endsWith('/api/patient/documents')) return route.fulfill({ json: { documents: [{ id: '00000000-0000-4000-8000-000000000007', title: 'Synthetic CBC', category: 'BLOOD_TEST', documentDate: '2026-01-15T00:00:00.000Z', createdAt: '2026-01-16T00:00:00.000Z' }], pagination: { total: 1, pages: 1 } } });
    if (pathname.endsWith('/api/patient/health-tracking/blood-pressure')) return route.fulfill({ json: { readings: [{ id: '00000000-0000-4000-8000-000000000008', systolic: 121, diastolic: 79, heartRate: 72, measuredAt: '2026-02-01T10:00:00.000Z' }] } });
    if (pathname.endsWith('/api/patient/health-tracking/blood-glucose')) return route.fulfill({ json: { readings: [{ id: '00000000-0000-4000-8000-000000000009', glucoseValue: 98.5, glucoseUnit: 'MG_DL', measurementType: 'FASTING', measuredAt: '2026-02-02T10:00:00.000Z' }] } });
    if (pathname.endsWith('/api/patient/sharing/requests')) return route.fulfill({ json: { requests: [{ id: 'request-1', requestedAt: '2026-02-03T10:00:00.000Z', expiresAt: '2026-02-04T10:00:00.000Z' }] } });
    if (pathname.endsWith('/api/patient/family/invitations')) return route.fulfill({ json: { sentInvitations: [{ id: 'invite-1', status: 'PENDING', createdAt: '2026-02-03T10:00:00.000Z', familyMember: { fullName: 'Synthetic Relative', relationship: 'SIBLING' } }], receivedInvitations: [] } });
    if (pathname.endsWith('/api/patient/health-intelligence/overview')) return route.fulfill({ json: { insights: [], trends: [], recentReports: [], pendingOcrReviews: 0, completeness: { percent: 50, missing: ['date of birth'] }, reminders: [], disclaimer: 'Synthetic test context.' } });
    if (pathname.endsWith('/api/patient/ai-assistant/status')) return route.fulfill({ json: { enabled: false, provider: 'unconfigured', externalProcessing: false, message: 'The AI assistant is off. No health records or questions are sent to an AI service.' } });
    return route.fulfill({ status: 404, json: { message: 'Unexpected synthetic test request.' } });
  });
}

test('dashboard displays only patient-owned API summaries and a real-record timeline', async ({ page }) => {
  await api(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Welcome back, Synthetic Patient' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest blood pressure' }).locator('..')).toContainText('121/79');
  await expect(page.getByRole('heading', { name: 'Latest blood glucose' }).locator('..')).toContainText('98.5');
  await expect(page.getByRole('heading', { name: 'Recent medical reports' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Synthetic CBC', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Doctor access requests' }).locator('..')).toContainText('1');
  await expect(page.getByRole('heading', { name: 'Family invitations' }).locator('..')).toContainText('1');
  await expect(page.getByRole('heading', { name: 'Health record timeline' })).toBeVisible();
  await expect(page.getByText(/date of birth, gender/)).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      `dashboard overflows at ${width}px`,
    ).toBe(false);
  }
});

test('patient compares only matching reviewed lab values and sees source reports', async ({ page }) => {
  await page.route('http://localhost:4000/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) return route.fulfill({ json: { user: patient } });
    if (url.pathname.endsWith('/api/auth/refresh')) return route.fulfill({ status: 401, json: { message: 'No session' } });
    if (url.pathname.endsWith('/api/patient/health-intelligence/overview')) return route.fulfill({ json: { insights: [], trends: [], recentReports: [], pendingOcrReviews: 0, completeness: { percent: 100, missing: [] }, reminders: [], disclaimer: 'Numeric observations only.' } });
    if (url.pathname.endsWith('/api/patient/health-intelligence/risk-trends')) return route.fulfill({ json: { analysisType: 'DESCRIPTIVE_TREND_ANALYSIS', generatedAt: '2026-11-15T12:00:00.000Z', ruleVersion: 'descriptive-health-trends-2026-11-v1', validationStatus: 'NOT_CLINICALLY_VALIDATED', modelBasedRisk: { available: false, reason: 'No validated clinical model is configured.' }, observationPeriod: { start: null, end: null }, dataCoverage: { bloodPressure: 0, bloodGlucose: 0, reviewedLabValues: 0, reviewedLabSeries: 0, bmi: 'NOT_AVAILABLE_IN_CURRENT_SCHEMA' }, persistentReportedFlags: [], statisticalTrends: [], statisticalDeviations: [], dataQualityIssues: [], insufficientData: [{ measurement: 'BMI', reason: 'No structured value is available.' }], ruleProvenance: { version: 'descriptive-health-trends-2026-11-v1', minimumTrendPoints: 5, minimumTrendSpanDays: 30, deviationHeuristic: '3 MAD', validationStatus: 'NOT_CLINICALLY_VALIDATED' }, limitations: ['Descriptive only; no clinical prediction.'] } });
    if (url.pathname.endsWith('/api/patient/documents')) return route.fulfill({ json: { documents: [
      { id: '00000000-0000-4000-8000-000000000007', title: 'Synthetic report one', documentDate: '2026-01-01' },
      { id: '00000000-0000-4000-8000-000000000008', title: 'Synthetic report two', documentDate: '2026-06-01' },
    ] } });
    if (url.pathname.endsWith('/api/patient/health-intelligence/compare')) return route.fulfill({ json: { comparisons: [{ testName: 'HbA1c', unit: '%', first: { value: 6.1, source: { id: '00000000-0000-4000-8000-000000000007', title: 'Synthetic report one', date: '2026-01-01' } }, second: { value: 6.4, source: { id: '00000000-0000-4000-8000-000000000008', title: 'Synthetic report two', date: '2026-06-01' } }, change: 0.3 }], unmatched: [], disclaimer: 'Synthetic test values; not clinical advice.' } });
    return route.fulfill({ status: 404, json: { message: 'Unexpected synthetic test request.' } });
  });
  await page.goto('/health-insights', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Health risk trends' })).toBeVisible();
  await expect(page.getByText('No validated clinical model is configured.')).toBeVisible();
  await page.getByLabel('First report').selectOption('00000000-0000-4000-8000-000000000007');
  await page.getByLabel('Second report').selectOption('00000000-0000-4000-8000-000000000008');
  await page.getByRole('button', { name: 'Compare reports' }).click();
  await expect(page.getByRole('heading', { name: 'HbA1c · %' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Synthetic report one' })).toBeVisible();
});

test('patient can create and complete a self-configured reminder', async ({ page }) => {
  let reminders: Array<{ id: string; title: string; type: string; dueAt: string }> = [];
  await page.route('http://localhost:4000/api/**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (url.pathname.endsWith('/api/auth/me')) return route.fulfill({ json: { user: patient } });
    if (url.pathname.endsWith('/api/auth/refresh')) return route.fulfill({ status: 401, json: { message: 'No session' } });
    if (url.pathname.endsWith('/api/patient/reminders') && method === 'GET') return route.fulfill({ json: { reminders } });
    if (url.pathname.endsWith('/api/patient/reminders') && method === 'POST') { const body=route.request().postDataJSON(); reminders=[{id:'reminder-1',title:body.title,type:body.type,dueAt:body.dueAt}]; return route.fulfill({ json: { reminder: reminders[0] } }); }
    if (url.pathname.endsWith('/api/patient/reminders/reminder-1') && method === 'PATCH') { reminders=[]; return route.fulfill({ json: { deleted: true } }); }
    if (url.pathname.endsWith('/api/patient/reminders/reminder-1') && method === 'DELETE') { reminders=[]; return route.fulfill({ json: { deleted: true } }); }
    return route.fulfill({ status: 404, json: { message: 'Unexpected synthetic test request.' } });
  });
  await page.goto('/reminders', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Reminder title').fill('Synthetic appointment');
  await page.getByLabel('Date and time').fill('2027-01-15T10:30');
  await page.getByRole('button', { name: 'Save reminder' }).click();
  await expect(page.getByText('Synthetic appointment')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('No active reminders. Add one when you choose.')).toBeVisible();
});

test('AI assistant clearly stays disabled and does not offer a prompt field', async ({ page }) => {
  await api(page);
  await page.goto('/ai-assistant', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'AI health-record assistant' })).toBeVisible();
  await expect(page.getByText(/No health records or questions are sent to an AI service/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'I agree to AI processing' })).toBeDisabled();
  await expect(page.getByPlaceholder('Enable the provider and give consent to chat')).toBeDisabled();
});

test('patient can review OCR values and metadata without changing the original report', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000007';
  let reviewBody: Record<string, unknown> | undefined;
  const extractedFields = [{ testName: 'Hemoglobin', value: '12.5', unit: 'g/dL', referenceRange: '12.0 - 16.0', abnormalFlag: null, confidence: 'REVIEW_REQUIRED', sourceLine: 'Hemoglobin 12.5 g/dL 12.0 - 16.0' }];
  const extractedMetadata = { patientName: 'Synthetic Patient', reportDate: '2026-01-15', laboratoryName: 'Synthetic Lab', doctorComments: null };
  await page.route('http://localhost:4000/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) return route.fulfill({ json: { user: patient } });
    if (url.pathname.endsWith('/api/auth/refresh')) return route.fulfill({ status: 401, json: { message: 'No session' } });
    if (url.pathname.endsWith(`/api/patient/documents/${id}/ocr`) && route.request().method() === 'GET') {
      return route.fulfill({ json: { ocr: { status: 'COMPLETED', message: 'Unverified OCR output.', extractedText: 'Hemoglobin 12.5 g/dL', extractedFields, extractedMetadata, reviewedText: null, reviewedFields: null, reviewedMetadata: null, reviewedAt: null, retryAvailable: false } } });
    }
    if (url.pathname.endsWith(`/api/patient/documents/${id}/ocr/review`) && route.request().method() === 'PATCH') {
      reviewBody = route.request().postDataJSON();
      return route.fulfill({ json: { ocr: { reviewedText: reviewBody?.reviewedText, reviewedFields: reviewBody?.reviewedFields, reviewedMetadata: reviewBody?.reviewedMetadata, reviewedAt: '2026-02-01T00:00:00.000Z' } } });
    }
    if (url.pathname.endsWith(`/api/patient/documents/${id}`) && route.request().method() === 'GET') {
      return route.fulfill({ json: { document: { id, title: 'Synthetic CBC', category: 'BLOOD_TEST', documentDate: '2026-01-15', originalFileName: 'synthetic.pdf', fileSize: 100, mimeType: 'application/pdf', description: null, scanStatus: 'SCANNED' } } });
    }
    if (url.pathname.endsWith(`/api/patient/documents/${id}/content`)) return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
    return route.fallback();
  });
  await page.goto(`/medical-records/${id}`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Report text extraction' })).toBeVisible();
  await expect(page.getByText('Status: COMPLETED')).toBeVisible();
  await expect(page.getByLabel(/Structured values/)).toHaveValue(/Hemoglobin/);
  const metadata = JSON.parse(await page.getByLabel(/Report details/).inputValue()) as Record<string, unknown>;
  metadata.doctorComments = 'Synthetic note for review';
  await page.getByLabel(/Report details/).fill(JSON.stringify(metadata, null, 2));
  await page.getByRole('button', { name: 'Confirm reviewed extraction' }).click();
  await expect.poll(() => reviewBody).toMatchObject({ reviewedMetadata: { doctorComments: 'Synthetic note for review' } });
  await expect(page.getByText(/Patient reviewed/)).toBeVisible();
});
