# Architecture

## System shape

- `apps/web`: the only frontend, built with Next.js App Router, React, TypeScript, and Tailwind CSS. It is responsive and installable as a PWA; browser authentication uses backend-issued HttpOnly cookies.
- `apps/api`: the NestJS REST API with DTO validation, Swagger, authentication, patient profile, health information, medical-document, health-tracking and health-check modules.
- `packages/shared`: contracts shared by the frontend and API.
- `packages/validation`: shared validation helpers.
- `packages/config`: shared non-secret defaults.
- `prisma/`: one canonical PostgreSQL schema and ordered migrations.
- Private S3-compatible storage is used for production medical documents; a private filesystem adapter is limited to development and tests.

There is one website, one API, and one PostgreSQL database. The browser, not a native client, is the application client. Business rules and patient ownership enforcement stay in NestJS. PostgreSQL stores account, session, profile, health information, blood pressure readings, glucose readings, document metadata, and audit metadata. No patient API response is cached by the browser service worker.

Prisma Client is generated into the ignored `apps/api/src/generated/prisma` directory so API builds do not replace the locked shared engine binary. Run `npm run prisma:generate` after cloning or changing schema.

## Authentication and ownership

The API issues short-lived access and rotating refresh credentials in HttpOnly cookies. Unsafe browser requests are checked against the configured exact `WEB_ORIGIN`; CORS allows credentialed requests only from that origin. Protected routes check current session and account status. Patient profile, health and tracking APIs require the PATIENT role and derive user identity from the authenticated principal. No frontend-supplied owner ID is accepted. Health-reading queries are filtered through the owning profile, mutations audit event/account/IP metadata only, and responses are private no-store.

OTP challenges, users, sessions, patient profile data, health information, and audit events persist in PostgreSQL. The development/test SMS mock never returns OTPs in API responses. Production SMS remains unconfigured.

## PWA boundary

The manifest and service worker support install and a safe offline fallback. The service worker caches only the offline page and static assets under Next static output and icon paths. It ignores API paths and does not cache navigation responses, sessions, profiles, or health data. Offline health-record access is not supported. Installation prompts depend on browser and OS support.

## Trust boundaries

Clients are untrusted. The API validates inputs and authorizes both role and resource scope for every request. Document bytes remain in private object storage and are streamed only after owner checks; raw bytes never enter PostgreSQL or browser persistence. QR codes must contain opaque random references only. Audit metadata must never include patient content or credentials.

Medical sharing is implemented inside the same PWA/API/database. It stores SHA-256 hashes of short-lived random QR tokens. Redemption creates a doctor request; explicit patient consent creates a separate expiring grant. Shared reads recheck doctor status, grant/session expiry and revocation, and the selected category on every request. Sharing responses are no-store and the service worker does not cache API paths.
