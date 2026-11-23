import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
async function authenticate(page: import('@playwright/test').Page, role: 'DOCTOR'|'ADMIN', status: string|null) {
  await page.route('**/api/auth/me', route => route.fulfill({json:{user:{id:'synthetic-ui-only',role,phoneNumber:'+919999999999',phoneVerified:true,accountStatus:'ACTIVE',doctorVerificationStatus:status}}}));
  await page.route('**/api/auth/refresh', route => route.fulfill({status:401,json:{message:'No session'}}));
}

test('pending doctor sees manual review status and needs explicit submission',async({page})=>{
  await authenticate(page,'DOCTOR','PENDING');
  await page.route('**/api/doctor/verification-status',route=>route.fulfill({json:{status:'PENDING',documents:[],history:[],notice:'HealthWallet administrator review only.'}}));
  let submitted=false;
  await page.route('**/api/doctor/verification/submit',async route=>{submitted=true;await route.fulfill({json:{status:'UNDER_REVIEW',message:'Submitted for manual review.'}})});
  await page.goto(new URL('/doctor/verification-status',origin).href);
  await expect(page.getByRole('heading',{name:'Verification status'})).toBeVisible();
  await expect(page.getByText('PENDING',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Submit for review'}).click();
  await expect(page.getByText('Submitted for manual review.')).toBeVisible();
  expect(submitted).toBe(true);
});

test('admin can inspect a pending application and submits a reason with review decisions',async({page})=>{
  await authenticate(page,'ADMIN',null);
  let decision:unknown;
  await page.route('**/api/admin/doctors',route=>route.fulfill({json:[{id:'doctor-id',phoneNumber:'+919999999999',doctorVerificationStatus:'UNDER_REVIEW',doctorProfile:{id:'profile-id',fullName:'Synthetic UI applicant',professionalRegistrationNo:'EXAMPLE-REG',registrationAuthority:'Example council',qualification:'MBBS',specialization:'General medicine',clinicName:null,clinicAddress:null,email:null,documents:[],audit:[]}}]}));
  await page.route('**/api/admin/doctors/doctor-id/review',async route=>{decision=route.request().postDataJSON();await route.fulfill({json:{doctorId:'doctor-id',status:'APPROVED'}})});
  await page.goto(new URL('/admin/doctors',origin).href);
  await page.getByRole('button',{name:/Synthetic UI applicant/}).click();
  await page.getByLabel('Reason').fill('Review recorded in UI test');
  await page.getByRole('button',{name:'Record decision'}).click();
  await expect.poll(() => decision).toEqual({status:'UNDER_REVIEW',reason:'Review recorded in UI test'});
});
