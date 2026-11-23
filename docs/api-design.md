# API design

Base path: `/api`. OpenAPI UI: `/docs`. Request DTOs reject unknown fields. Times use UTC ISO values, identifiers are UUIDs, and authentication messages avoid disclosing phone ownership.

## Authentication

| Method and path                        | Auth           | Purpose                                                                                         |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`              | Public         | Start PATIENT or pending DOCTOR registration with Indian mobile OTP.                            |
| `POST /api/auth/send-otp`              | Public         | Request LOGIN or RECOVERY OTP. Unknown or suspended accounts receive the same generic response. |
| `POST /api/auth/verify-otp`            | Public         | Consume a challenge; establish a web session in HttpOnly cookies.                               |
| `POST /api/auth/refresh`               | Refresh cookie | Rotate the refresh credential and renew the web session.                                        |
| `POST /api/auth/logout`                | Access cookie  | Revoke current session and clear cookies.                                                       |
| `POST /api/auth/logout-all`            | Access cookie  | Revoke all sessions belonging to the authenticated account.                                     |
| `GET /api/auth/me`                     | Access cookie  | Return the authenticated account identity and role.                                             |
| `GET /api/auth/sessions`               | Access cookie  | List active sessions for the current account.                                                   |
| `DELETE /api/auth/sessions/:sessionId` | Access cookie  | Revoke a session owned by the current account.                                                  |

Web authentication cookies are `hv_access` and `hv_refresh`, HttpOnly, SameSite configurable, scoped to `/api` so patient endpoints receive them, and Secure in production. Unsafe browser requests require the configured exact `WEB_ORIGIN`; credentialed CORS is limited to that origin. Session values are never stored in browser storage. OTPs expire after five minutes, are single-use, and have configurable attempt and rate limits. IP controls are process-local and require shared storage before multi-instance deployment.

## Patient profile

All patient routes require a valid session and PATIENT role. The server derives the owner from the authenticated session; requests do not include `userId` or `patientProfileId`.

| Method and path                       | Purpose                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/patient/profile`            | Return the caller’s profile and registered mobile number; profile is `null` before creation. |
| `PUT /api/patient/profile`            | Create or update the caller’s profile. Fields are optional and may be cleared with `null`.   |
| `GET /api/patient/health-information` | Return the caller’s patient-provided health information or `null`.                           |
| `PUT /api/patient/health-information` | Create or update the caller’s health information.                                            |
| `GET /api/patient/profile/completion` | Return recommended missing profile fields and a completion percentage.                       |

## Medical documents

Medical-document routes require an authenticated PATIENT. The backend derives both account and profile ownership from the session. Upload is a synchronous multipart request; the response is returned only after validation, configured scanning, private storage and object verification succeed.

| Method and path                          | Purpose                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/patient/documents/upload`     | Validate, scan and store a PDF/JPEG/PNG report (rate-limited).                              |
| `GET /api/patient/documents`             | Patient-scoped list with search, category, report/upload date, MIME filters and pagination. |
| `GET /api/patient/documents/:id`         | Owned document metadata.                                                                    |
| `GET /api/patient/documents/:id/content` | Authorized no-store preview; `?download=true` returns an attachment.                        |
| `PATCH /api/patient/documents/:id`       | Update title, category, description and report date.                                        |
| `DELETE /api/patient/documents/:id`      | Remove private object and soft-delete owned metadata.                                       |

Responses omit object keys and patient/profile IDs. See [medical document design](medical-document-design.md) and [upload security](upload-security.md).

DOB accepts a date string and cannot be in the future. Indian postal codes and emergency contact mobile numbers are validated; phone numbers are normalized to `+91`. Health free-text fields are capped at 4,000 characters. API responses avoid internal user/profile IDs and the profile-photo storage key. Profile changes generate audit events without logging submitted field values.

## Health tracking

All health-tracking routes require the authenticated PATIENT role. Owner IDs are never accepted from the client; list, item, and mutation queries scope through the profile belonging to the session user. Responses include `Cache-Control: private, no-store` and are omitted from service-worker caching.

| Method and path                                          | Purpose                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/patient/health-tracking/blood-pressure`       | Create a BP reading with optional heart rate.                             |
| `GET /api/patient/health-tracking/blood-pressure`        | List owned BP readings.                                                   |
| `GET /api/patient/health-tracking/blood-pressure/:id`    | Retrieve one owned BP reading.                                            |
| `PATCH /api/patient/health-tracking/blood-pressure/:id`  | Update one owned BP reading.                                              |
| `DELETE /api/patient/health-tracking/blood-pressure/:id` | Soft-delete one owned BP reading.                                         |
| `POST /api/patient/health-tracking/blood-glucose`        | Create a glucose reading.                                                 |
| `GET /api/patient/health-tracking/blood-glucose`         | List owned glucose readings.                                              |
| `GET /api/patient/health-tracking/blood-glucose/:id`     | Retrieve one owned glucose reading.                                       |
| `PATCH /api/patient/health-tracking/blood-glucose/:id`   | Update one owned glucose reading.                                         |
| `DELETE /api/patient/health-tracking/blood-glucose/:id`  | Soft-delete one owned glucose reading.                                    |
| `GET /api/patient/health-tracking/summary`               | Return total counts, latest measurements, and optional date-range counts. |

List endpoints accept `page` (default 1), `pageSize` (default 20, maximum 100), `startDate`, `endDate`, and `sort=ASC|DESC` (default DESC). Glucose additionally accepts `glucoseUnit=MG_DL|MMOL_L` and `measurementType=FASTING|POST_MEAL|RANDOM|BEFORE_MEAL|AFTER_MEAL|BEDTIME|OTHER`. Dates accept ISO dates or timestamps; date-only end filters include the whole date. The dashboard converts local calendar-day boundaries to UTC instants before querying. Invalid start/end order returns 400.

BP uses positive integer mmHg values, requires diastolic below systolic, and accepts optional positive integer bpm heart rate. Glucose uses a positive decimal and a required unit/type enum. Input bounds are configurable with `BP_*` and `GLUCOSE_*` variables in `.env.example`; they are broad input-error guards, not clinical thresholds. Measurements more than five minutes ahead of the API clock are rejected. Notes are capped at 1,000 characters. Create/update/delete audit events store only account ID, event type, and IP; no reading values or notes are logged. Reads and errors do not reveal other patients’ records.

## Responses and errors

Success bodies use small JSON objects such as `{ "profile": … }` and `{ "healthInformation": … }`. Missing profiles return `null` within a successful response so clients can show an empty state. Validation returns 400, throttling returns 429, invalid/expired credentials return 401, and role failures return 403. Swagger documents the cookie authentication scheme and all patient routes.

No unrestricted patient lookup endpoint is provided. Future resource routes must enforce both role and resource ownership/grants.

## Consent-based medical sharing

All sharing routes use the existing HttpOnly cookie and return private no-store responses. Patient routes scope from the authenticated profile. Doctor sharing/read routes require the DOCTOR role, active account, verified mobile, and existing `APPROVED` status.

| Method and path                                                    | Purpose                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POST /api/patient/sharing/sessions`                               | Create a short-lived session for explicit categories and selected report IDs; returns raw QR token once. |
| `GET /api/patient/sharing/sessions`                                | List own sessions without raw tokens.                                                                    |
| `GET /api/patient/sharing/sessions/:id`                            | Read own session details and requests.                                                                   |
| `POST /api/patient/sharing/sessions/:id/revoke`                    | Revoke a session and its grants.                                                                         |
| `GET /api/patient/sharing/requests`                                | List pending requests for the current patient.                                                           |
| `POST /api/patient/sharing/requests/:id/approve`                   | Record consent and create an expiring grant transactionally.                                             |
| `POST /api/patient/sharing/requests/:id/reject`                    | Reject a request without creating a grant.                                                               |
| `GET /api/patient/sharing/history`                                 | Read the patient sharing audit history.                                                                  |
| `GET, PUT /api/doctor/profile`                                     | Read/update self-reported details; cannot change verification status.                                    |
| `POST /api/doctor/sharing/scan`                                    | Validate an opaque token and create/retrieve this doctor’s request; no record access.                    |
| `GET /api/doctor/sharing/requests`                                 | List this doctor’s request states and selected categories.                                               |
| `GET /api/doctor/patient-access`                                   | List this doctor’s active patient-approved grants.                                                       |
| `GET /api/doctor/patient-access/:id`                               | Read only categories selected by that grant.                                                             |
| `GET /api/doctor/patient-access/:id/documents/:documentId/content` | Stream a selected available report after grant and ownership checks.                                     |
| `POST /api/doctor/patient-access/:id/revoke`                       | End this doctor’s own grant.                                                                             |

QR tokens are 32 random bytes encoded base64url; only SHA-256 hashes are stored. Sessions allow 5, 15, 30, or 60 minutes and at most five distinct doctor requests. Scanning never grants access. Doctor APIs do not accept patient IDs. Doctor data is self-reported; manual HealthVault admin approval is not independent registry verification. See [medical sharing design](medical-sharing-design.md).

## Family management and member-controlled access

Family relationship routes use the authenticated PATIENT and owner-scoped family records. They return `private, no-store` responses. Family invite token hashes are persisted; the raw 256-bit token is returned once for a copyable fragment link and accepted/rejected only by the matching verified phone account. Claim acceptance never creates a medical grant. The linked member's account must separately grant exact categories and documents for a bounded duration. A CHILD/guardian relationship remains `UNVERIFIED` and has no access route bypass.

| Method and path | Purpose |
| --- | --- |
| `POST, GET /api/patient/family/members` | Create/list the authenticated patient's family relationship records. |
| `GET, PUT, DELETE /api/patient/family/members/:id` | Read, edit, or remove an owned relationship; removal revokes its pending invitations and grants. |
| `POST /api/patient/family/members/:id/invitations` | Create or resend a seven-day, single-use verified-account claim link. |
| `GET /api/patient/family/invitations` | Read sent/incoming invitation statuses and accepted links for the authenticated account. |
| `POST /api/patient/family/invitations/accept` / `reject` | Claim or reject using the invitation token and matching verified phone account. |
| `POST /api/patient/family/members/:id/consent` | Member explicitly grants selected categories and optional exact documents for 1, 7, or 30 days. |
| `POST /api/patient/family/members/:id/consent/revoke` | Revoke the actual member's active grant. |
| `GET /api/patient/family/members/:id/records` | Read only the member-approved categories, with grant checks on every call. |
| `GET /api/patient/family/members/:id/documents/:documentId/content` | Stream an explicitly selected report after grant and storage checks. |

Claim links are copied and delivered outside the application; a production SMS provider is not configured. See [family management design](family-management-design.md).
