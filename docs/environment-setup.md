# Environment setup

## Requirements

Node.js 20.19+, npm 10+, and PostgreSQL 16+. A current browser is needed for the PWA. Service workers and installation require a secure context (HTTPS or localhost); browser support and installation prompts vary by device.

## Local configuration

1. Copy `.env.example` to `.env.local`, replace the placeholders, set a unique random `AUTH_SECRET` of at least 32 bytes, and keep the file private.
2. Create a PostgreSQL database and set `DATABASE_URL` to it.
3. Keep `NODE_ENV=development`. For ordinary local OTP testing, use `SMS_PROVIDER=development-mock`.
4. Run `npm ci`, `npm run prisma:generate`, and `npm run prisma:migrate:dev` from the root.
5. Start `npm run dev:api` and `npm run dev:web` in separate terminals.
6. Visit http://localhost:3000. API readiness (API, database and document-storage check) is http://localhost:4000/api/health. Swagger is available only outside production at http://localhost:4000/docs.
7. After pulling a schema change, run `npm run prisma:generate` and `npm run prisma:migrate:dev` against the configured local database. Optional health-reading bounds are listed in `.env.example`; the defaults are broad input-validation limits, not clinical thresholds.

`WEB_ORIGIN` must list the exact website origin(s), typically `http://localhost:3000`; multiple explicit origins may be comma-separated when using more than one approved local port. CORS and unsafe-request checks use the same exact allowlist. `NEXT_PUBLIC_API_BASE_URL` is the public API origin used by the browser; it is not a secret. Never put credentials or secrets in public environment variables.

## Medical document storage and scanning

The example environment selects private local filesystem storage and the development-only `development-noop` scanner. Local objects are kept in the current user’s private application-data directory, outside all web-served paths; `MEDICAL_DOCUMENT_LOCAL_DIR` can override it. The scanner does not provide malware protection and files are marked `NOT_SCANNED`. Configure `MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES` to adjust the 15 MiB default (maximum 100 MiB).

Production must set `DOCUMENT_STORAGE_PROVIDER=s3`, configure a private S3-compatible bucket and credentials through a secret manager or workload role, and set `MEDICAL_DOCUMENT_SCANNER=clamav` with a reachable ClamAV daemon. Production refuses local storage or the no-op scanner; scanner errors fail closed. See [file storage design](file-storage-design.md) and [upload security](upload-security.md). No cloud bucket or paid storage service is provisioned by the project.

## OTP authentication

Register or sign in from the PWA. The development provider does not deliver, print, or return OTPs. A production SMS vendor adapter is not included, so OTP sign-in remains unavailable until one is implemented and reviewed. Tests should inject a fake provider.

### Password sign-in for local feature testing

To pause OTP screens locally, set `DEV_PASSWORD_AUTH_ENABLED=true` and `NEXT_PUBLIC_DEV_PASSWORD_AUTH_ENABLED=true`. Choose a synthetic `DEV_TEST_PHONE` and a unique `DEV_TEST_PASSWORD` with at least 16 characters. The API creates only that marked test patient on first successful sign-in and uses the regular session cookies and database. OTP endpoints return a conflict while this mode is active. The feature is disabled in production even if the flag is accidentally set. Do not use real patient phone numbers or passwords, and do not commit `.env.local`/`.env`.

## PWA installation

Open the site over HTTPS or localhost. Supported Chromium browsers may present an **Install app** button when their install criteria are met. In Safari on iPhone/iPad, use Share → Add to Home Screen. Other browsers and OS versions may offer different prompts. If install is unavailable, the website remains usable in the browser.

The service worker caches the offline fallback and static assets only. It does not cache API calls or page navigations. Patient information cannot be viewed offline.

### Health tracking measurements

Health measurements are fetched with credentials and `cache: no-store`; they are never stored in localStorage or the service worker cache. If the network is unavailable, the UI reports that a reading was not saved and offers retry. Measurement timestamps are ISO UTC instants and are formatted in the browser’s local timezone. Date filter boundaries are converted from local calendar dates to UTC instants so selecting a day does not shift the displayed range.

### QR sharing

Patients use `/sharing`; doctors use `/doctor/scan` within the same PWA. Scanning requires HTTPS or localhost and browser camera permission; manual token entry is available as a fallback. A scan creates a request only; access starts only after patient approval and ends on expiry/revocation. Doctors must be mobile-verified and manually approved by an administrator before sharing. Manual review is not independent medical council verification.

`MEDICAL_SHARE_MAX_DURATION_MINUTES` optionally lowers the maximum QR/grant lifetime (default 60; valid range 5–60). Session choices are 5, 15, 30 or 60 minutes. Doctor scan limits are process-local; configure a shared atomic rate-limit store before scaling the API horizontally.

Doctor authentication always uses OTP; the local password test feature is patient-only. No synthetic doctor seeding or doctor password bypass is provided. Configure a real SMS provider before testing doctor registration or sign-in.

## Workspace commands

- `npm run prisma:generate`
- `npm run prisma:migrate:dev` for local development
- `npm run prisma:migrate:deploy` for reviewed migrations
- `npm run prisma:migrate:status`
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web`, `npm run build:api`
- `npm run test:web` after starting the PWA separately

Never run a destructive reset against a database with data that must be preserved.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for production configuration, HTTPS, private storage, migration, backup/restore, and release procedures.
