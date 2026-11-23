# HealthVault project overview

HealthVault is a single responsive Next.js PWA backed by a NestJS API and PostgreSQL. The current phase provides patient-owned profile and patient-provided basic health information; later phases may add authorized sharing and clinical workflows.

## Phase 0 boundaries

The foundation provides the PWA, API, shared packages, and documentation. Phase 1 adds OTP authentication and Phase 2 adds patient profile management. The landing page describes the service; authenticated routes are implemented separately.

## Product principles

Patient data ownership; explicit resource-level authorization; minimal collection; private file storage; auditable access; synthetic development data; and no medical data in QR payloads. A QR share reference must be random, short-lived, revocable, and resolved server-side.
