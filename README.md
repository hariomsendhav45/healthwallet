# HealthVault

HealthVault is one responsive, installable Next.js PWA backed by one NestJS API and PostgreSQL database. The same website adapts to desktop, tablet, and phone screens. It includes patient profiles, secure medical report management, and patient-owned blood pressure and glucose tracking.

## Prerequisites

- Node.js 20.19+ and npm 10+
- PostgreSQL 16+

Copy `.env.example` to `.env`, set a unique `AUTH_SECRET` of at least 32 random bytes, and point `DATABASE_URL` at a local PostgreSQL database. Keep `.env` private. Example secret generation: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.

## Install, generate and migrate

```sh
npm install
npm run prisma:generate
npm run prisma:migrate:dev
```

Prisma Client is generated to the ignored `apps/api/src/generated/prisma` directory. Regenerate after a schema change or fresh clone. For reviewed release migrations use `npm run prisma:migrate:deploy`. Never reset a database with data you need.

## Start the PWA and API

Run these in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

PWA: http://localhost:3000. API health: http://localhost:4000/api/health. Swagger: http://localhost:4000/docs.

## Local OTP authentication

Use `NODE_ENV=development` and `SMS_PROVIDER=development-mock`. The mock prints the six-digit code only in the local API terminal, with a masked number. It never returns a code from an endpoint and refuses production. No real SMS vendor is configured. Register at `/register`; login and recovery are available at `/login`.

The PWA uses backend-issued HttpOnly cookies for access and refresh credentials. Browser JavaScript does not store session tokens. Profile API calls use `credentials: include` and disable HTTP cache.

## Medical records and private uploads

Signed-in patients can upload, list, search, filter, preview, download, edit, and delete their own PDF/JPEG/PNG reports from **Medical records**. Browser file selection and `capture="environment"` camera hints are used where supported. Server-side validation checks file extension, declared MIME type, magic bytes and size. The default limit is 15 MiB (`MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES`). Documents are stored outside public web assets in the development-only private local provider, or in a private S3-compatible bucket in production. See [storage setup](docs/file-storage-design.md) and [upload security](docs/upload-security.md).

Local development uses `DOCUMENT_STORAGE_PROVIDER=local` and `MEDICAL_DOCUMENT_SCANNER=development-noop`; the latter does not scan for malware and is displayed as NOT_SCANNED. Production requires private S3-compatible storage and ClamAV; uploads fail closed if scanning is unavailable. No cloud account is configured by this repository.

Apply the Phase 3 migration with `npm run prisma:migrate:dev` after configuring PostgreSQL. Never reset a database with data you need.

## Blood pressure and glucose tracking

Patients can record blood pressure (with optional heart rate) and blood glucose, review paginated history, edit or soft-delete their own readings, apply date filters, and view summaries and charts. The dashboard is available under **Health tracking** at `/health-tracking`. Glucose units remain as entered (`mg/dL` or `mmol/L`) and are charted separately without conversion. All API access is session- and patient-scoped; responses are no-store and unavailable offline. This feature records measurements and does not diagnose or recommend treatment. See [health tracking design](docs/health-tracking-design.md), [blood pressure tracking](docs/blood-pressure-tracking.md), and [blood glucose tracking](docs/blood-glucose-tracking.md).

Default configurable input boundaries are documented in `.env.example`. The API allows a five-minute future clock tolerance for device clock drift. Out-of-bound inputs are rejected as likely input errors; unusual readings inside those broad limits remain recordable.

## Consent-based QR sharing

Patients can select record categories and exact reports, create short-lived QR sessions, review doctor requests, approve or reject them, and revoke sessions or grants. Doctors can scan with the browser camera or enter a temporary token when camera scanning is unavailable. A scan creates a request only; every shared-record read requires a current patient-approved grant and is filtered to its selected permissions. See [medical sharing design](docs/medical-sharing-design.md), [QR security](docs/qr-security-design.md), [patient consent](docs/patient-consent-design.md), and [doctor access control](docs/doctor-access-control.md).

Doctor access requires an active account, verified mobile, and `doctorVerificationStatus=VERIFIED`. Phase 5 does not verify professional credentials or provide a verification-admin workflow; doctor display and registration details are self-reported. Camera access requires HTTPS or localhost. Sharing rate limits are process-local and must use a shared atomic store before multi-instance deployment.

For a local synthetic sharing walkthrough, configure separate `DEV_DOCTOR_TEST_PHONE` and `DEV_DOCTOR_TEST_PASSWORD` values and run `npm run sharing:seed-demo-doctor`. The CLI seed is development-only; the sign-in endpoint cannot create or approve doctor accounts. Its VERIFIED status is a test gate and does not verify real-world credentials.

## Family relationships and record consent

Patients can manage family relationship details, create a one-time claim link for the invited member's verified HealthVault account, and see invitation status. Accepting creates only an account-linked relationship. The actual family member must separately choose medical record categories, specific documents, and an expiry before access is granted; they can revoke access at any time. Family records are served only through owner-scoped, no-store APIs. Child/guardian relationships remain unverified and cannot access records because no legal verification service is configured. Invitation links are copied and delivered privately by the patient because this repository has no production SMS delivery adapter. See [family management design](docs/family-management-design.md).

## PWA installation and offline behavior

Use HTTPS (or localhost) in a supported browser. Chromium browsers may show an in-app **Install app** button when installation is available. Safari on iPhone/iPad uses Share → Add to Home Screen; exact installation prompts vary by browser and OS. The service worker caches only its offline fallback and static assets. Authentication, API responses, profile content, documents, and health readings are never cached or available offline.

## Checks

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web`, `npm run build:api`, and `npm run test:web` (start the web app and install Playwright Chromium for browser tests). See [environment setup](docs/environment-setup.md) for database commands.

## Scope and readiness

Future phases may add family access and consultation workflows. Before production, configure a reviewed SMS provider, replace process-local IP rate limits with shared storage, resolve dependency advisories, and complete security, privacy, legal, operational, and penetration reviews. This project does not claim regulatory compliance or ABDM certification.
