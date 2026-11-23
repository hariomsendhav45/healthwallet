import { expect, test } from '@playwright/test';

const token = 'A'.repeat(43);
const future = new Date(Date.now() + 15 * 60_000).toISOString();

async function mockAuth(page: import('@playwright/test').Page, role: 'PATIENT' | 'DOCTOR') {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: `${role.toLowerCase()}-synthetic`,
          role,
          phoneNumber: '+919876543210',
          phoneVerified: true,
          accountStatus: 'ACTIVE',
          doctorVerificationStatus: role === 'DOCTOR' ? 'APPROVED' : null,
        },
      },
    }),
  );
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { message: 'No session' } }),
  );
}

test('patient explicitly selects records and duration before getting an in-memory QR', async ({
  page,
}) => {
  await mockAuth(page, 'PATIENT');
  let createdBody: Record<string, unknown> | undefined;
  await page.route('**/api/patient/documents?*', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: 'synthetic-doc',
            title: 'Synthetic blood test',
            category: 'BLOOD_TEST',
            documentDate: null,
          },
        ],
      },
    }),
  );
  await page.route('**/api/patient/sharing/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      createdBody = route.request().postDataJSON();
      return route.fulfill({
        json: {
          session: {
            id: 'session-1',
            status: 'ACTIVE',
            expiresAt: future,
            createdAt: new Date().toISOString(),
            revokedAt: null,
            maxUses: 5,
            useCount: 0,
            permissions: [{ permissionType: 'MEDICAL_DOCUMENTS' }],
            documents: [
              {
                medicalDocument: {
                  id: 'synthetic-doc',
                  title: 'Synthetic blood test',
                  category: 'BLOOD_TEST',
                  documentDate: null,
                },
              },
            ],
          },
          token,
        },
      });
    }
    return route.fulfill({ json: { sessions: [] } });
  });
  await page.goto('/sharing/create');
  await expect(page.getByRole('heading', { name: 'Create a QR session' })).toBeVisible();
  await page.getByLabel('Selected medical reports').check();
  await page.getByLabel('Synthetic blood test').check();
  await page.getByLabel('Session duration').selectOption('15');
  await page.getByRole('button', { name: 'Create QR session' }).click();
  await expect(
    page.getByRole('img', { name: 'QR code containing a temporary opaque sharing reference' }),
  ).toBeVisible();
  expect(createdBody).toEqual({
    permissionTypes: ['MEDICAL_DOCUMENTS'],
    medicalDocumentIds: ['synthetic-doc'],
    durationMinutes: 15,
  });
  expect(page.url()).not.toContain(token);
  expect(page.url()).not.toContain('patient');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `sharing page should fit ${width}px`).toBeLessThanOrEqual(width);
  }
});

test('patient sees doctor details and must separately approve or reject a request', async ({
  page,
}) => {
  await mockAuth(page, 'PATIENT');
  let decision = '';
  await page.route('**/api/patient/sharing/requests', (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: 'request-1',
            status: 'PENDING',
            requestedAt: new Date().toISOString(),
            expiresAt: future,
            shareSession: {
              id: 'session-1',
              permissions: [{ permissionType: 'BLOOD_PRESSURE_READINGS' }],
              documents: [],
            },
            doctor: {
              doctorProfile: {
                fullName: 'Synthetic Test Doctor',
                professionalRegistrationNo: 'TEST-123',
                registrationAuthority: 'Synthetic registry',
              },
            },
          },
        ],
      },
    }),
  );
  await page.route('**/api/patient/sharing/requests/request-1/**', async (route) => {
    decision = route.request().url().split('/').at(-1) ?? '';
    return route.fulfill({
      json: {
        requestId: 'request-1',
        status: decision.toUpperCase() === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      },
    });
  });
  await page.goto('/sharing/requests');
  await expect(page.getByText('Synthetic Test Doctor')).toBeVisible();
  await expect(page.getByText(/not independently credential-verified/)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Approve access' }).click();
  await expect.poll(() => decision).toBe('approve');
});

test('doctor scanner submits a request and access is not implied by scanning', async ({ page }) => {
  await mockAuth(page, 'DOCTOR');
  let submittedToken = '';
  await page.route('**/api/doctor/sharing/scan', async (route) => {
    submittedToken = route.request().postDataJSON().token;
    return route.fulfill({ json: { request: { status: 'PENDING' } } });
  });
  await page.goto('/doctor/scan');
  await page.getByLabel('Temporary QR token').fill(token);
  await page.getByRole('button', { name: 'Submit access request' }).click();
  await expect(page.getByText('Request sent. The patient must approve before any records are available.')).toBeVisible();
  expect(submittedToken).toBe(token);
  await expect(page.getByRole('heading', { name: 'Shared patient records' })).toHaveCount(0);
});

test('doctor view renders only permitted categories and can end an active grant', async ({
  page,
}) => {
  await mockAuth(page, 'DOCTOR');
  await page.route('**/api/doctor/patient-access/grant-synthetic', (route) =>
    route.fulfill({
      json: {
        grant: {
          id: 'grant-synthetic',
          expiresAt: future,
          permissions: ['BLOOD_PRESSURE_READINGS'],
        },
        records: {
          bloodPressureReadings: [
            {
              id: 'bp-synthetic',
              systolic: 120,
              diastolic: 80,
              heartRate: null,
              measuredAt: new Date().toISOString(),
            },
          ],
        },
      },
    }),
  );
  await page.route('**/api/doctor/patient-access/grant-synthetic/revoke', (route) =>
    route.fulfill({ json: { revoked: true } }),
  );
  await page.goto('/doctor/patients/grant-synthetic');
  await expect(page.getByRole('heading', { name: 'Blood pressure readings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blood glucose readings' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Basic profile' })).toHaveCount(0);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'End my access' }).click();
  await expect(page.getByText('Access ended.', { exact: true })).toBeVisible();
});

test('doctor scanner explains camera permission denial and keeps manual fallback available', async ({
  page,
}) => {
  await mockAuth(page, 'DOCTOR');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        },
      },
    });
  });
  await page.goto('/doctor/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText(/Camera permission was denied or no camera is available/)).toBeVisible();
  await expect(page.getByLabel('Temporary QR token')).toBeVisible();
});
