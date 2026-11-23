# Security and privacy design

## Authentication and patient data controls

- Indian mobile numbers are normalized to E.164. Public registration accepts PATIENT or DOCTOR only; ADMIN is not public.
- OTPs use secure random generation, keyed HMAC, five-minute expiry, attempt and request limits, resend cooldown, single-use challenges, and atomic database consumption.
- The development/test SMS provider never logs or returns codes and does not deliver messages. Production starts with an explicit unconfigured provider that rejects OTP delivery; production login is not operational until a reviewed SMS adapter is implemented and configured.
- Access tokens are short-lived HMAC JWTs. Refresh credentials are random secrets stored only as HMAC hashes, rotate on use, and revoke the session on reuse. Each protected request checks current session and account state.
- The PWA uses HttpOnly cookies scoped to `/api` so patient routes receive the session, with configurable SameSite, Secure in production, exact-origin checks for unsafe requests, and credentialed CORS restricted to `WEB_ORIGIN`. No token is stored in browser storage.
- Profile and health APIs require both authentication and PATIENT role. Ownership comes from the session principal, not request fields. No patient lookup by client-supplied ID is exposed.
- DTO validation bounds text, validates enumerations, date-of-birth, Indian postal codes and emergency mobile numbers. Patient-entered health text is not treated as a diagnosis.
- Profile changes write audit event type, account UUID, and request IP only; sensitive fields and request bodies are not logged.
- The service worker caches only static assets and a non-sensitive offline fallback. API responses, sessions, profiles, and health information are excluded.
- Medical report endpoints enforce authenticated patient ownership, signature/MIME/extension/size validation, upload throttling, configured malware scanning, private object storage, checksum verification, no-store delivery headers, and event/IP-only audit entries. See [upload security](upload-security.md).
- Patient profile and health records use one-to-one UUID relations and foreign keys. Medical documents use UUID foreign keys to the profile and uploader, private object keys, soft-delete state, and event/IP-only audit events. Profile photo keys remain reserved for a later feature.
- Blood pressure and glucose readings are UUID-owned children of `PatientProfile`; every endpoint requires the session guard and PATIENT role and scopes item access through the session user. Create, update, and soft-delete use transactions with event/account/IP-only audit rows; values, notes, and reading IDs are not logged.
- Health-reading DTOs validate enums, numeric ranges, pressure relationships, note lengths, and ISO measurement instants. Configurable defaults are broad entry-error bounds and do not classify clinical status. A five-minute future tolerance covers device clock drift.
- Tracking endpoints set `Cache-Control: private, no-store`; browser requests use `cache: no-store`. The service worker ignores `/api/`, and readings are not put in browser storage. Offline writes are not queued or represented as saved.
- Glucose values preserve the selected mg/dL or mmol/L unit. Trend charts are separated by unit and do not convert or mix measurements.

## Medical sharing safeguards

- QR references are 256-bit random values; only SHA-256 hashes are persisted. Raw values are returned once, held in component memory, and excluded from URLs, logs and browser persistence.
- Session duration is 5–60 minutes, with a five-request cap and a unique request per doctor/session. Invalid and expired token errors do not expose patient identity.
- Scanning creates a request only. Every doctor read validates current role, active account, verified mobile and APPROVED status, patient grant, session/grant expiry, revocation, and selected category/document.
- Patient consent and grants are transactional. Revocation cascades to active grants. Shared API responses and private document streams are no-store.
- Doctor verification uses protected administrator review routes, status history and audit records; submitted credentials remain self-reported until an authorized reviewer completes a real verification process.
- Camera streams stop after a scan and on component teardown. Camera access requires HTTPS or localhost; no camera photos or QR token storage is used.

## Deployment limitations

The current IP/verification and document upload rate limiters use process memory and do not coordinate across instances. Deploy one API replica until a shared atomic limiter is implemented. A production SMS adapter is intentionally absent, so OTP registration/login cannot be offered to users yet. Production medical documents require private S3-compatible storage and ClamAV; development uses private local storage and explicitly marks files NOT_SCANNED. Configure TLS and production secret management, use a unique random `AUTH_SECRET` (at least 32 bytes), and review cookie SameSite and origin settings.

The service worker prevents app-managed offline caching of health information, but cannot control browser history, screenshots, extensions, device backups, or user-initiated exports. Production deployment still needs threat modeling, incident response, retention/deletion, backup/restore, and penetration review. This architecture is not a claim of legal compliance or ABDM certification; seek qualified security and legal review before handling real records.

## Dependency review

The lockfile audit was successfully run against the npm registry on 2026-11-13: 28 findings (25 moderate, 3 low, zero high/critical). `npm audit --omit=dev` reported zero production dependency findings. The full-audit findings are in the development toolchain (Jest, Nest CLI, TypeScript ESLint, glob/minimatch/deepmerge); npm's proposed fixes require major toolchain changes or downgrades. No such change was applied without a compatibility plan and regression review. Re-run the audit before release and schedule those upgrades.

The frontend currently sends CSP with `unsafe-inline` because Next.js static rendering emits inline bootstrap scripts/styles. This is a baseline policy and does not provide strict nonce-based script protection. A strict nonce CSP requires an explicit dynamic-rendering migration and should be separately implemented and regression-tested.
