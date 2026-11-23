# Medical sharing design

## Scope

Medical sharing is implemented inside the existing Next.js PWA and NestJS API. It shares only patient-selected categories and selected reports, and only after a patient approves an individual doctor request. Doctor access uses the existing `User.role=DOCTOR` and `doctorVerificationStatus=APPROVED` gate; the API also requires an active account, non-test account, and verified mobile on each operation.

## Session and QR lifecycle

The patient selects one or more permission categories, optionally selects specific available documents, and chooses 5, 15, 30, or 60 minutes. `MEDICAL_SHARE_MAX_DURATION_MINUTES` can lower this maximum (valid range 5–60). The API creates a 32-byte cryptographically random token (256 bits), base64url-encodes it, and stores only its SHA-256 hash. The raw token is returned once to the patient page, held in component memory, and encoded into a QR locally. It is not placed in a URL, browser storage, API log, database, or service-worker cache. Session tokens permit at most five distinct doctor requests; a doctor can request only once per session. QR scanning creates a request, never a grant.

Sessions and grants share the same expiry. Revoking a session atomically revokes its active grants and pending/approved requests. Expiry is checked on token redemption and on every grant read; expired states are also materialized when the patient lists sessions or requests. Removed or unavailable reports cannot be returned even if previously selected. Tokens are never reissued.

## Consent and grant

`DoctorAccessRequest` is unique per session and doctor. The patient review screen shows the doctor’s account status, self-reported display/registration fields, selected categories and specific report titles. The UI explicitly says registration details are not independently credential-verified by HealthVault. Approve/reject uses a serializable transaction and a conditional `PENDING` update to prevent duplicate decisions. Approval creates one grant whose expiry is bounded by the original QR session. Rejection creates no grant.

Every doctor record request goes through `MedicalSharingService.activeGrant`, which checks current doctor role, active account, verified phone, `APPROVED` status, non-test account, grant owner, session status, session expiry, and grant expiry. Select clauses are built from the grant’s permission rows. The document-content endpoint additionally checks that the requested document ID is one of the selected report links and still belongs to the grant’s patient. The API accepts only the grant ID and document ID; callers cannot submit a patient ID.

## Audit and privacy

`MedicalSharingAuditLog` stores event type, actor/doctor IDs, optional session/profile foreign keys, IP, time and small category/count metadata. It excludes raw tokens, record values, report contents, filenames, registration details, and request bodies. Read/download, consent, revocation, invalid-token and expiry events are covered. API responses use `private, no-store`; client requests disable cache; the application sets a `no-referrer` policy.

## Doctor credential boundary

Doctors submit self-reported registration details and documents for manual HealthVault administrator review. Admin decisions, reasons, reviewer IDs, and timestamps are audited. `APPROVED` means an administrator reviewed the application; no council/registry lookup is integrated, and approval must not be described as independently verified credentials. New registrations remain PENDING until the doctor submits. Pending, under-review, rejected, suspended, and synthetic test doctors are blocked from scanning and patient-record access.

## Operational limitations

Abuse limits are process-local, matching the existing auth limiter; production multi-instance deployments need a shared atomic limiter. Secure camera use requires HTTPS or localhost. The PWA uses `@zxing/browser` with the rear camera preferred, and stops the stream after a result or unmount. Browser/device camera behavior still needs physical-device testing. A grant revocation immediately blocks future API reads; bytes already downloaded by a doctor cannot be remotely erased. No offline sharing is supported.
