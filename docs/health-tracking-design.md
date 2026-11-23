# Health tracking design

## Architecture

One responsive Next.js PWA calls the NestJS `HealthTrackingModule`; Prisma stores BP and glucose history in the shared PostgreSQL database. The module reuses the existing cookie-session `AuthGuard`, PATIENT `RolesGuard`, and patient API rate limit. There is no mobile-specific API or offline health-record store.

## Database and history

`BloodPressureReading` and `BloodGlucoseReading` are UUID child records of `PatientProfile` with cascade foreign keys, UTC timestamps, indexes for date-based patient queries, and soft-delete fields. BP pressure relationship and positive-value constraints and the glucose decimal/unit/type constraints are described in the two feature documents. List APIs are paginated (20 default, 100 maximum), date-filtered, and sorted by measurement time. The UI supports 7/30/90-day, 6-month, 1-year and custom calendar ranges, plus loading additional pages.

Date/time entry is interpreted in the device’s local timezone and sent as an ISO UTC instant. For calendar filters, the browser converts the selected local start-of-day and the day after the selected end date into UTC instants. The API applies an inclusive start and exclusive end, avoiding a midnight offset and including the full user-selected end date. Measurement timestamps display in the browser’s local timezone, including daylight-saving transitions supported by the device.

## Summary and charts

`GET /api/patient/health-tracking/summary` returns total BP and glucose counts, latest readings and timestamps, plus counts in the requested date range. The dashboard shows current range counts, latest measurements, history tables and Recharts line charts. BP systolic/diastolic share mmHg; glucose uses separate mg/dL and mmol/L charts. The app does not convert, interpolate missing measurements, generate diagnostic flags, or show hardcoded sample data.

## Privacy and offline behavior

Every API route requires a valid patient session and derives its owner from that session. Resource lookup, update, and soft-delete include the owning account in the database filter. DTO validation and per-patient/IP rate limiting apply server side. Mutations transactionally write an audit event containing only event type, account UUID and request IP. Reading payloads are not logged.

Authenticated reads use `Cache-Control: private, no-store` and the frontend uses `fetch` with `cache: no-store`; the service worker bypasses `/api/`. Health values are not kept in localStorage, IndexedDB, public caches, or offline queues. If a save cannot reach the API, the UI says it was not saved and keeps the entered form available to retry. This is a measurement record, not a diagnostic, treatment, or emergency response service.

## Local development

Run `npm run prisma:generate` and `npm run prisma:migrate:dev` after configuring PostgreSQL, then start the API and web workspace with `npm run dev:api` and `npm run dev:web`. Optional broad entry limits are in `.env.example`; the defaults are not clinical reference thresholds. Swagger is served at `/docs`. Tests use synthetic data only.
