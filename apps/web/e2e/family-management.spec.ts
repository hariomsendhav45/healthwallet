import { expect, test, type Page, type Route } from '@playwright/test';

const token = 'a'.repeat(43);
const ownerId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const member = {
  id: memberId,
  fullName: 'Synthetic Family Member',
  dateOfBirth: null,
  relationship: 'SPOUSE',
  contactNumber: '+919876543210',
  gender: null,
  claimedByUserId: null,
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
  invitation: null,
  accessGrant: null,
  accessStatus: 'NO_ACCESS',
};

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

async function reply(route: Route, origin: string, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: corsHeaders(origin), body: JSON.stringify(body) });
}

async function authenticatedPage(page: Page, handle: (route: Route, url: URL) => Promise<void>) {
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  const requestedUrls: string[] = [];
  await page.route('http://localhost:4000/api/**', async (route) => {
    const url = new URL(route.request().url());
    requestedUrls.push(url.href);
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(origin) });
      return;
    }
    if (url.pathname.endsWith('/api/health')) return reply(route, origin, { status: 'ok' });
    if (url.pathname.endsWith('/api/auth/me')) {
      return reply(route, origin, { user: { id: ownerId, role: 'PATIENT', phoneNumber: '+919999999999', phoneVerified: true, accountStatus: 'ACTIVE', doctorVerificationStatus: null } });
    }
    if (url.pathname.endsWith('/api/auth/refresh')) return reply(route, origin, { message: 'Authentication required.' }, 401);
    await handle(route, url);
  });
  return requestedUrls;
}

test('patient can add a family relationship without granting record access', async ({ page }) => {
  let created = false;
  await authenticatedPage(page, async (route, url) => {
    if (url.pathname.endsWith('/api/patient/family/members') && route.request().method() === 'POST') {
      created = true;
      expect(route.request().postDataJSON()).toMatchObject({ fullName: 'Synthetic Family Member', relationship: 'SPOUSE' });
      await reply(route, new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin, { familyMember: { id: memberId } });
      return;
    }
    if (url.pathname.endsWith('/api/patient/family/members/' + memberId)) {
      return reply(route, new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin, { familyMember: member });
    }
    await reply(route, new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin, { message: 'Unexpected test request.' }, 404);
  });
  await page.goto('/family/add', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Full name').fill('Synthetic Family Member');
  await page.getByLabel('Relationship').selectOption('SPOUSE');
  await page.getByRole('button', { name: 'Add family member' }).click();
  await expect(page).toHaveURL(new RegExp(`/family/${memberId}$`));
  await expect(page.getByText('No record access')).toBeVisible();
  expect(created).toBe(true);
});

test('family invitation link contains only a one-time claim token and stays out of the current URL', async ({ page }) => {
  const urls = await authenticatedPage(page, async (route, url) => {
    const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
    if (url.pathname.endsWith('/api/patient/family/members/' + memberId) && route.request().method() === 'GET') {
      return reply(route, origin, { familyMember: member });
    }
    if (url.pathname.endsWith('/api/patient/family/members/' + memberId + '/invitations')) {
      return reply(route, origin, { token, delivery: 'COPY_LINK', targetPhoneNumber: '+91••••10', invitation: { id: 'invite-id', status: 'PENDING', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: new Date().toISOString() } });
    }
    return reply(route, origin, { message: 'Unexpected test request.' }, 404);
  });
  await page.goto(`/family/${memberId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByLabel('One-time invitation link')).toHaveValue(new RegExp(`#token=${token}`));
  await expect(page).toHaveURL(new RegExp(`/family/${memberId}$`));
  expect(urls.every((url) => !url.includes(token))).toBe(true);
  await expect(page.getByText(/no health information/i)).toBeVisible();
});

test('recipient must explicitly accept the invitation and acceptance creates no record grant', async ({ page }) => {
  let accepted = false;
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  await authenticatedPage(page, async (route, url) => {
    if (url.pathname.endsWith('/api/patient/family/invitations') && route.request().method() === 'GET') {
      return reply(route, origin, { sentInvitations: [], receivedInvitations: [{ id: 'invite-id', status: 'PENDING', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: new Date().toISOString(), familyMember: { fullName: 'Synthetic Family Member', relationship: 'SPOUSE', ownerPatientProfile: { fullName: 'Synthetic Patient' } } }], familyLinks: [] });
    }
    if (url.pathname.endsWith('/api/patient/family/invitations/accept')) {
      expect(route.request().postDataJSON()).toEqual({ token });
      accepted = true;
      return reply(route, origin, { invitation: { id: memberId, status: 'ACCEPTED' }, accessStatus: 'NO_ACCESS', guardianVerificationStatus: null });
    }
    if (url.pathname.endsWith('/api/patient/documents')) return reply(route, origin, { documents: [] });
    return reply(route, origin, { message: 'Unexpected test request.' }, 404);
  });
  await page.goto(`/family/invitations#token=${token}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Claim invitation token')).toHaveValue(token);
  await expect(page).toHaveURL(/\/family\/invitations$/);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('status')).toContainText('No health records were shared');
  expect(accepted).toBe(true);
});

test('actual patient explicitly chooses categories and bounded duration before granting access', async ({ page }) => {
  let consent: { permissionTypes: string[]; durationDays: number } | null = null;
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  await authenticatedPage(page, async (route, url) => {
    if (url.pathname.endsWith('/api/patient/family/invitations') && route.request().method() === 'GET') {
      return reply(route, origin, { sentInvitations: [], receivedInvitations: [], familyLinks: [{ id: memberId, fullName: 'Synthetic Family Member', relationship: 'SPOUSE', ownerPatientProfile: { fullName: 'Synthetic Patient' }, accessGrant: null, accessStatus: 'NO_ACCESS' }] });
    }
    if (url.pathname.endsWith('/api/patient/family/members/' + memberId + '/consent')) {
      consent = route.request().postDataJSON();
      return reply(route, origin, { accessGrant: { id: 'grant-id', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
    }
    if (url.pathname.endsWith('/api/patient/documents')) return reply(route, origin, { documents: [] });
    return reply(route, origin, { message: 'Unexpected test request.' }, 404);
  });
  await page.goto('/family/invitations', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Basic profile').check();
  await page.getByLabel('Blood group').check();
  await page.getByLabel('Access duration').selectOption('1');
  await page.getByRole('button', { name: 'Grant selected access' }).click();
  await expect(page.getByRole('status')).toContainText('selected record access is now active');
  expect(consent).toEqual({ permissionTypes: ['PROFILE_BASIC', 'BLOOD_GROUP'], durationDays: 1 });
});

test('guardian claims remain unverified and family pages fit a narrow viewport', async ({ page }) => {
  const child = { ...member, relationship: 'CHILD', accessStatus: 'GUARDIAN_UNVERIFIED_NO_ACCESS', guardianRelationship: { verificationStatus: 'UNVERIFIED' } };
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  await authenticatedPage(page, async (route) => reply(route, origin, { familyMember: child }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/family/${memberId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Guardian relationship is unverified/)).toBeVisible();
  await expect(page.getByText(/No family record access can be granted/)).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
