# HealthVault deployment runbook

This is a deployment blueprint, not a statement that AWS, an SMS provider, a database, or object storage is connected. The repository remains one responsive Next.js PWA with a NestJS API, PostgreSQL, Prisma, and private medical-document storage.

## Production readiness gaps

- **OTP delivery is unavailable:** no real SMS adapter is included. Implement and review an adapter for your selected provider, set provider credentials in a managed secret store, and test delivery/expiry/abuse controls before enabling user registration or login. Current provider fails closed.
- **One API replica only:** IP rate limiting and upload limits are process-local. Do not scale the API horizontally until they use a shared atomic limiter.
- **Doctor credential checks:** administrator review and audit history exist, but do not mark credentials as verified until an actual council/registry verification has occurred.
- **OCR and AI:** no OCR engine or AI provider is implemented/configured. Both features stay disabled regardless of environment flags; no report text or health records are sent externally. See [Phase 9 provider requirements](docs/phase9-ai-ocr.md).
- **CSP:** policy is present, but allows inline scripts/styles for compatibility with Next static output. It is not a strict nonce CSP.
- **Dependency audit:** the registry reported 28 low/moderate findings in development tooling, zero high/critical, and `npm audit --omit=dev` found zero production dependency advisories. Suggested fixes require major toolchain changes/downgrades, so they were not applied during this hardening pass. Re-run and resolve them in a separate compatibility-reviewed upgrade before release.

## Suggested hosting layout (AWS example)

Run the web and API as separate containers in one ECS Fargate cluster behind an Application Load Balancer with HTTPS certificates. Keep tasks in private subnets; allow public ingress only through the load balancer. Use RDS for PostgreSQL, S3 for private medical objects, Secrets Manager/Parameter Store for secrets, and CloudWatch for operational logs/alarms. ECS Fargate supports Application Load Balancers, and AWS documents RDS automated backups and point-in-time recovery. See [ECS service load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html), [RDS backup and restore](https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/managing-backup-restore.html), and [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html).

This repository does not provision AWS infrastructure. Equivalent managed container, PostgreSQL, and private S3-compatible services can be used if the same network and access controls are met.

## Required software and environment

- Node.js 20.19+ and npm 10+ for local/CI builds; container runtime for image deployment.
- PostgreSQL supported by Prisma 6, private network access, TLS enabled, separate least-privilege application and migration credentials.
- Private S3-compatible bucket, TLS endpoint and application workload identity with only required bucket/object operations.
- ClamAV daemon reachable from the API for production document uploads.
- HTTPS domain(s) for web and API. Set exact public origins; no wildcard CORS.
- A real SMS provider adapter is a prerequisite for OTP login. Store its credentials only in the hosting secret manager.

Copy `.env.example` to a private local env file for development and replace every placeholder. Production secrets are injected by the deployment platform and must not be copied into source control or image layers. Required production settings:

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_PORT` | Container API port, normally `4000` |
| `TRUST_PROXY_HOPS` | Exact trusted proxy hop count (for one load balancer, normally `1`); set according to the actual ingress chain |
| `DATABASE_URL` | Private PostgreSQL URL; use TLS/`sslmode=require` and secret-managed credentials |
| `WEB_ORIGIN` | Exact `https://` web origin(s), comma-separated only when required |
| `NEXT_PUBLIC_API_BASE_URL` | Public HTTPS API base URL (browser-readable, not a secret) |
| `AUTH_SECRET` | Secret-manager generated random value, at least 32 bytes; unique per environment |
| `AUTH_COOKIE_SAME_SITE` | `lax` when web/API are same-site; use `none` only for a reviewed cross-site deployment (cookies then require HTTPS) |
| `DOCUMENT_STORAGE_PROVIDER` | `s3` |
| `MEDICAL_DOCUMENT_S3_BUCKET`, `MEDICAL_DOCUMENT_S3_REGION` | Existing private bucket and region |
| `MEDICAL_DOCUMENT_S3_ENDPOINT` | Empty for AWS S3; set only for another compatible service |
| `MEDICAL_DOCUMENT_S3_FORCE_PATH_STYLE` | `false` for AWS S3; provider-specific for other services |
| S3 credentials | Prefer workload identity; otherwise inject `MEDICAL_DOCUMENT_S3_ACCESS_KEY_ID` and `MEDICAL_DOCUMENT_S3_SECRET_ACCESS_KEY` from secrets |
| `MEDICAL_DOCUMENT_SCANNER` | `clamav` |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | Private daemon endpoint and bounded timeout |
| SMS provider settings | Not available until a reviewed adapter exists; do not fake a configured value |

Set `DEV_PASSWORD_AUTH_ENABLED=false` and `NEXT_PUBLIC_DEV_PASSWORD_AUTH_ENABLED=false`. Never deploy test fixtures or use the local mock SMS provider.

## PostgreSQL setup and migrations

1. Provision a private PostgreSQL database. Enable TLS, encryption at rest, automated backups and monitoring. Keep the database inaccessible from public networks.
2. Create a least-privilege runtime account and a separate migration account. Supply the runtime URL to `DATABASE_URL`; use the migration credential only in the release job.
3. From the repository root, install dependencies, generate Prisma client, validate schema and inspect migration status:

   ```sh
   npm ci
   npm run prisma:generate
   npm run prisma:validate
   npm run prisma:migrate:status
   ```

4. Take/confirm a restorable backup before a release. Apply committed migrations with `npm run prisma:migrate:deploy` as a one-shot release task before shifting application traffic. Do **not** use `prisma migrate dev`, `db push`, or any reset command in production. Never run a destructive reset against production.
5. Verify migration status and health check after deployment. Prefer forward-fix migrations; Prisma migrations are not automatically rolled back by reverting the application image.

## Backup, restore and recovery limits

- Configure managed PostgreSQL point-in-time recovery with a **35-day retention target** (or a longer period required by the operator's approved retention policy), plus a daily snapshot and a weekly snapshot copied to a separately protected account/region. Confirm actual provider limits and costs when provisioning.
- Schedule a restore exercise at least quarterly and before high-risk schema changes. Record measured recovery time and point-in-time loss; set explicit RPO/RTO with the service owner.
- Back up object storage separately. Enable provider versioning/replication only with retention and deletion rules reviewed for medical-data lifecycle requirements; database backups do not contain document bytes.
- Restore into isolated infrastructure first: restore PostgreSQL to the chosen point, restore/attach the corresponding object-store recovery point, apply only required forward migrations, validate document references and checksums, then switch traffic.
- Backups can still be incomplete, corrupted, misconfigured or outside the selected retention window. A quarterly exercise is not proof of zero data loss or an availability guarantee. The repository has no backup automation or verified restore artifact.

## Private object storage

Create the bucket with Block Public Access enabled, ACLs disabled, encryption at rest, TLS-only bucket policy, access logging/monitoring, and a workload role limited to this bucket. Do not place document objects behind a public CDN or expose bucket URLs. The API streams documents only after authorization. Configure lifecycle/deletion retention intentionally; legal and records-retention requirements need an operator decision. Configure and monitor ClamAV before permitting uploads.

## Build, run and HTTPS

Set the environment above and build from the repository root:

```sh
npm ci
npm run prisma:generate
npm run build:api
npm run build:web
```

Run the API with `npm run start:prod -w @healthvault/api` on its private container port. Run the Next.js app with `npm run start -w @healthvault/web` (set `PORT` to the container port). Configure the load balancer to terminate HTTPS, redirect HTTP to HTTPS, forward only to healthy tasks, and preserve the exact host/origin configuration. The API sets `Secure` cookies in production and rejects non-HTTPS `WEB_ORIGIN` values. Keep web and API on the same site where possible; otherwise review SameSite, CSRF origin checks, and browser third-party cookie behavior before launch.

Provide `/api/health` as the API target health check. It checks API, database query, and private storage credentials/access without returning exception details. Use a separate platform/container health check for the web process. Do not expose stack traces, environment values or database errors to users. Route logs to access-controlled storage with retention; never log OTPs, auth tokens, invitation/share tokens, document content, or health request bodies. Alert on API/database/storage failures, repeated auth throttling, scan failures and backup-job failures.

## SMS provider setup

No SMS vendor is configured by this codebase. Select a provider and region only after privacy, security, and operational review. Implement a `SmsProvider` adapter that keeps credentials in the secret manager, handles delivery errors without logging OTPs, and preserves OTP single-use, expiry, attempt limits, and resend policy. Add adapter tests and provider callback validation before enabling OTP in production. Do not use email or a fixed code as a substitute for mandatory verified-mobile OTP.

## CI and release checks

The GitHub Actions workflow runs Prisma generation/validation, lint, type checks, API tests, browser tests, and production builds. Its browser job uses the development server. To run the production service-worker/offline scenario locally, start the production web server, then set `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_TARGET_KIND=production`, and `PWA_E2E_PRODUCTION=1` before `npm run test:web`. Before release, re-run `npm audit` and complete compatibility-reviewed toolchain upgrades; deploy only reviewed dependency updates. The current workflow does not connect external SMS, ClamAV, S3 or a hosted PostgreSQL instance, and CI green does not verify those integrations.

Manual pre-release sequence:

```sh
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run test:web
npm audit
```

Do not report deployment, external integration, security certification or penetration-test status unless each was separately performed and evidenced.
