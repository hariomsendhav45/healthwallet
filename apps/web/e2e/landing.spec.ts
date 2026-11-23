import { expect, test } from '@playwright/test';

test('landing page shows HealthWallet introduction and features', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toContainText('Your health records');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your records, together' })).toBeVisible();
});

test('local registration explains the patient-only test sign-in and doctor OTP requirement', async ({ page }) => {
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'OTP is paused' })).toBeVisible();
  await expect(page.getByText(/Doctor sign-in and registration require mobile OTP delivery/)).toBeVisible();
});

test('OTP verification requires a pending challenge and six-digit code', async ({ page }) => {
  await page.goto('/verify-otp', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Verify and continue' })).toBeDisabled();
  await expect(page.getByLabel('Six-digit verification code')).toBeVisible();
});

test('authenticated home redirects an unauthenticated visitor to login', async ({ page }) => {
  const webOrigin = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  ).origin;
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': webOrigin,
        'access-control-allow-credentials': 'true',
      },
      body: '{"statusCode":401,"message":"Authentication required."}',
    }),
  );
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login$/);
});

test('PWA manifest describes a standalone HealthWallet app with install icons', async ({
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'HealthWallet',
    short_name: 'HealthWallet',
    display: 'standalone',
    start_url: '/dashboard',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]),
  );
});

test('web responses include baseline security headers and the configured API origin in CSP', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  const csp = response.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain('localhost:4000');
});

test('development mode removes the HealthWallet worker and does not register a service worker', async ({
  page,
}) => {
  test.skip(process.env.PLAYWRIGHT_TARGET_KIND === 'production', 'This assertion requires the Next.js development server.');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return 0;
        const registrations = await navigator.serviceWorker.getRegistrations();
        return registrations.filter((registration) =>
          [registration.installing, registration.waiting, registration.active].some(
            (worker) => worker?.scriptURL === `${location.origin}/sw.js`,
          ),
        ).length;
      }),
    )
    .toBe(0);
  await page.context().setOffline(true);
  await expect(page.getByRole('status')).toContainText('You appear to be offline');
  await expect(page.getByRole('heading', { name: /Your health records, within reach/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toHaveCount(0);
  await page.context().setOffline(false);
});

test('API outage shows a retryable service warning without replacing the page', async ({
  page,
}) => {
  await page.route('http://localhost:4000/api/health', (route) =>
    route.fulfill({ status: 503, json: { status: 'unavailable' } }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toContainText('services are temporarily unavailable');
  await expect(page.getByRole('heading', { name: /Your health records, within reach/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toHaveCount(0);
});

test('production PWA falls back offline without showing personal data', async ({ page }) => {
  test.skip(
    process.env.PWA_E2E_PRODUCTION !== '1',
    'Run against next start to test production PWA',
  );
  await page.addInitScript(() => {
    void caches.open('unrelated-app-cache');
  });
  const workerResponse = await page.request.get('/sw.js');
  expect(workerResponse.ok()).toBeTruthy();
  expect(workerResponse.headers()['cache-control']).toContain('no-store');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const registration = await page.evaluate(async () => {
    const value = await navigator.serviceWorker.ready;
    return { scope: value.scope, active: Boolean(value.active) };
  });
  expect(registration?.active).toBe(true);
  expect(registration?.scope).toContain('/');
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cachedDocumentResponse = await page.evaluate(async () => {
    const request = new Request(
      `${location.origin}/api/patient/documents/00000000-0000-4000-8000-000000000777/content`,
    );
    await fetch(request).catch(() => undefined);
    return Boolean(await caches.match(request));
  });
  expect(cachedDocumentResponse).toBe(false);
  await page.context().setOffline(true);
  await page.goto('/offline-test');
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  await expect(
    page.getByText(/Medical records and personal health information require an active connection/),
  ).toBeVisible();
  expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Your health records, within reach/ })).toBeVisible();
});

test('landing layout does not overflow narrow, tablet, or desktop viewports', async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
  }
});

test('patient can edit their profile through authenticated API calls', async ({ page }) => {
  let name = '';
  await page.route('http://localhost:4000/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({
        json: {
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            role: 'PATIENT',
            phoneNumber: '+919876543210',
            phoneVerified: true,
            accountStatus: 'ACTIVE',
            doctorVerificationStatus: null,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/api/patient/profile') && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON() as { fullName?: string };
      name = input.fullName ?? '';
    }
    if (url.pathname.endsWith('/api/patient/profile')) {
      await route.fulfill({
        json: {
          profile: name
            ? { fullName: name, mobileNumber: '+919876543210', country: 'India' }
            : null,
        },
      });
      return;
    }
    await route.fulfill({ json: { completionPercent: 0, missingFields: ['fullName'] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/profile/edit', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Full name')).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      `profile form overflow at ${width}px`,
    ).toBe(false);
  }
  await page.getByLabel('Full name').fill('Synthetic Patient');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  await expect(page.getByText('Synthetic Patient')).toBeVisible();
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Synthetic Patient' }),
  ).toBeVisible();
});

test('patient can update basic health information through the authenticated API', async ({
  page,
}) => {
  let saved: Record<string, string> | null = null;
  await page.route('http://localhost:4000/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/auth/me')) {
      await route.fulfill({
        json: {
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            role: 'PATIENT',
            phoneNumber: '+919876543210',
            phoneVerified: true,
            accountStatus: 'ACTIVE',
            doctorVerificationStatus: null,
          },
        },
      });
      return;
    }
    if (
      url.pathname.endsWith('/api/patient/health-information') &&
      route.request().method() === 'PUT'
    ) {
      saved = route.request().postDataJSON() as Record<string, string>;
    }
    await route.fulfill({ json: { healthInformation: saved } });
  });
  await page.goto('/health-information', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Diabetes status').selectOption('PREDIABETES');
  await page.getByLabel('Allergies').fill('Synthetic example');
  await page.getByRole('button', { name: 'Save health information' }).click();
  await expect(page.getByRole('status')).toContainText('Health information saved.');
  expect(saved).toMatchObject({ diabetesStatus: 'PREDIABETES', allergies: 'Synthetic example' });
});

test('patient profile route redirects when the web session is expired', async ({ page }) => {
  await page.route('http://localhost:4000/api/auth/**', (route) =>
    route.fulfill({ status: 401, json: { message: 'Authentication required.' } }),
  );
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login$/);
});

test('patient can upload, view, edit, and delete a private medical report', async ({ page }) => {
  const webOrigin = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  ).origin;
  let document = {
    id: '00000000-0000-4000-8000-000000000777',
    title: 'Synthetic test report',
    description: null,
    category: 'BLOOD_TEST',
    documentDate: '2026-01-10T00:00:00.000Z',
    originalFileName: 'synthetic.png',
    mimeType: 'image/png',
    fileSize: 68,
    scanStatus: 'NOT_SCANNED',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  };
  await page.route('http://localhost:4000/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': webOrigin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }
    if (url.pathname.endsWith('/api/health')) return route.fulfill({ json: { status: 'ok' } });
    if (url.pathname.endsWith('/api/auth/me')) {
      return route.fulfill({
        json: {
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            role: 'PATIENT',
            phoneNumber: '+919876543210',
            phoneVerified: true,
            accountStatus: 'ACTIVE',
            doctorVerificationStatus: null,
          },
        },
      });
    }
    if (
      url.pathname.endsWith('/api/patient/documents/upload') &&
      route.request().method() === 'POST'
    ) {
      expect(route.request().headers()['content-type']).toContain('multipart/form-data');
      return route.fulfill({ json: { document } });
    }
    if (url.pathname.endsWith('/api/patient/documents') && route.request().method() === 'GET') {
      return route.fulfill({
        json: { documents: [document], pagination: { page: 1, limit: 20, total: 1, pages: 1 } },
      });
    }
    if (url.pathname.endsWith(`/api/patient/documents/${document.id}/content`)) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNhsAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    }
    if (
      url.pathname.endsWith(`/api/patient/documents/${document.id}`) &&
      route.request().method() === 'GET'
    ) {
      return route.fulfill({ json: { document } });
    }
    if (
      url.pathname.endsWith(`/api/patient/documents/${document.id}`) &&
      route.request().method() === 'PATCH'
    ) {
      document = { ...document, ...route.request().postDataJSON() };
      return route.fulfill({ json: { document } });
    }
    if (
      url.pathname.endsWith(`/api/patient/documents/${document.id}`) &&
      route.request().method() === 'DELETE'
    ) {
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ status: 404, json: { message: 'Unexpected test request.' } });
  });

  await page.goto('/medical-records/upload', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNhsAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByText(/Selected: synthetic\.png/)).toBeVisible();
  await page.getByRole('button', { name: 'Upload report' }).click();
  await expect(page).toHaveURL(/\/medical-records\/00000000-0000-4000-8000-000000000777$/);
  await expect(page.getByRole('heading', { name: 'Synthetic test report' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Updated synthetic report');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('heading', { name: 'Updated synthetic report' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete report' }).click();
  await expect(page).toHaveURL(/\/medical-records$/);
});
