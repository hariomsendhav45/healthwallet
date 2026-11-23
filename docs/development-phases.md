# Development phases

0. Foundation: one Next.js website, NestJS API, npm workspaces, health check, Swagger, Prisma setup, and architecture documentation.
1. Authentication: Indian mobile OTP registration/login/recovery for the PWA, mock-only development SMS, hashed OTP challenges and refresh sessions, HttpOnly cookies, API guards, audit events, and migrations. Before production, add a reviewed SMS adapter, shared rate limiting, security review, and resolve dependency findings.
2. Responsive installable PWA, patient-owned profile and profile completion, basic patient-provided health information, resource authorization, migrations, and privacy-safe offline behavior.
3. Patient-owned PDF/JPEG/PNG report upload, private object storage, authorized preview/download, metadata editing, filtering/pagination, and soft-delete lifecycle. Production readiness requires private S3-compatible storage, ClamAV, database migration, and security review.
4. Patient-owned blood pressure and glucose readings, optional heart-rate capture, date-filtered history, edits and soft-deletes, summaries, unit-separated charts, and authenticated APIs.
5. Consent and temporary QR sharing with category/document selection, verified-doctor gate, patient approval, active grant checks, expiry/revocation, QR scanning, audit and tests. Credential verification administration remains a future phase.
6. Patient-owned family relationships, single-use verified-account claim links, member-owned expiring category grants, revocation, audit, and a separate unverified guardian claim with no record access until legal verification exists.
7. Doctor verification, protected administrator review, and consent-controlled patient access.
8. Security hardening and production deployment preparation.
9. Provider-disabled OCR/AI states and real-data patient dashboard summaries. OCR/AI processing stays disabled until providers and privacy controls are implemented.

Each phase includes threat review, migrations, API contracts, automated tests, accessibility, observability, and documentation before release. No phase may expose patient information without authenticated resource-level authorization.
