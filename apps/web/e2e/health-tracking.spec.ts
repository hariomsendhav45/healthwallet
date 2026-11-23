import { expect, test } from '@playwright/test';

test('patient records, edits, filters and deletes synthetic health readings', async ({ page }) => {
  const bpReadings: Array<Record<string, unknown>> = [];
  const glucoseReadings: Array<Record<string, unknown>> = [];
  let sawUtcDateRange = false;
  let id = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith('/api/auth/me')) {
      return route.fulfill({ json: { user: { id: 'synthetic-patient', role: 'PATIENT', phoneNumber: '+919876543210', phoneVerified: true, accountStatus: 'ACTIVE', doctorVerificationStatus: null } } });
    }
    if (url.pathname.endsWith('/api/auth/refresh')) return route.fulfill({ status: 401, json: { message: 'No session' } });
    if (url.pathname.endsWith('/api/patient/health-tracking/summary')) {
      return route.fulfill({ json: {
        totalBloodPressureReadings: bpReadings.length,
        latestBloodPressureReading: bpReadings[0] ?? null,
        totalGlucoseReadings: glucoseReadings.length,
        latestGlucoseReading: glucoseReadings[0] ?? null,
        bloodPressureReadingsInRange: bpReadings.length,
        glucoseReadingsInRange: glucoseReadings.length,
      } });
    }
    const kind = url.pathname.includes('/blood-pressure') ? 'bp' : 'glucose';
    const rows = kind === 'bp' ? bpReadings : glucoseReadings;
    const resource = kind === 'bp' ? 'blood-pressure' : 'blood-glucose';
    if (url.pathname.endsWith(`/api/patient/health-tracking/${resource}`) && method === 'GET') {
      sawUtcDateRange ||= Boolean(url.searchParams.get('startDate')?.endsWith('Z') && url.searchParams.get('endDate')?.endsWith('Z'));
      return route.fulfill({ json: { readings: rows, pagination: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 } } });
    }
    if (url.pathname.endsWith(`/api/patient/health-tracking/${resource}`) && method === 'POST') {
      const reading = { id: `synthetic-${++id}`, ...route.request().postDataJSON() };
      rows.unshift(reading);
      return route.fulfill({ json: { reading } });
    }
    const recordId = url.pathname.split('/').at(-1);
    if (method === 'PATCH') {
      const index = rows.findIndex((row) => row.id === recordId);
      rows[index] = { ...rows[index], ...route.request().postDataJSON() };
      return route.fulfill({ json: { reading: rows[index] } });
    }
    if (method === 'DELETE') {
      const index = rows.findIndex((row) => row.id === recordId);
      if (index >= 0) rows.splice(index, 1);
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ status: 404, json: { message: 'Unexpected synthetic test request.' } });
  });

  await page.goto('/health-tracking', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Health tracking' })).toBeVisible();
  await page.getByLabel('Systolic (mmHg)').fill('122');
  await page.getByLabel('Diastolic (mmHg)').fill('81');
  await page.getByLabel('Heart rate (bpm, optional)').fill('72');
  await page.getByRole('button', { name: 'Save reading' }).first().click();
  await expect(page.getByText('Reading saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '122/81 mmHg' })).toBeVisible();
  await expect(page.locator('[aria-label="Blood pressure trend chart in mmHg"] svg[role="application"]')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByLabel('Systolic (mmHg)').fill('124');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: '124/81 mmHg' })).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByText('No blood pressure readings in this date range.')).toBeVisible();

  await page.getByLabel('Glucose value').fill('95');
  await page.getByLabel('Measurement type').selectOption('FASTING');
  await page.getByRole('button', { name: 'Save reading' }).last().click();
  await expect(page.getByRole('cell', { name: /^95 mg\/dL/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blood glucose', exact: true }).first()).toBeVisible();
  await page.getByLabel('Date range').selectOption('7');
  await expect.poll(() => sawUtcDateRange).toBe(true);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll('body *')]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.right > window.innerWidth + 1)
        .slice(0, 8)
        .map(({ element, rect }) => ({ tag: element.tagName, className: (element as HTMLElement).className, right: rect.right, width: rect.width })),
    }));
    expect(layout.scrollWidth, JSON.stringify({ width, ...layout })).toBeLessThanOrEqual(layout.innerWidth);
  }
});
