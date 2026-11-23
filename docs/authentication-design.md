# Authentication design

## Flow

1. The PWA submits an Indian country code and mobile number to registration or OTP request. The backend validates the number and stores it in normalized E.164 form.
2. The API always returns a generic OTP-request message. For eligible accounts it creates a five-minute six-digit OTP challenge and sends it through `SmsProvider`. Unknown login/recovery numbers and duplicate registrations receive no SMS. Delivery failures are audited without OTP or health data.
3. A correct challenge can be consumed once. Challenge consumption, account creation/login update, and refresh-session creation happen in one Prisma transaction. Public registration accepts PATIENT or DOCTOR only. New doctors are PENDING and cannot access doctor-only operations.
4. Access credentials expire after 15 minutes. Refresh credentials are random session-scoped secrets; only keyed hashes are stored. Refresh rotates the secret. Reuse revokes the session. Protected requests check current session and account status.
5. The browser receives HttpOnly access and refresh cookies. The PWA does not store credentials in localStorage or sessionStorage.

## OTP policy

- Six digits generated using `crypto.randomInt`.
- HMAC-SHA256 keyed with `AUTH_SECRET` and bound to the challenge UUID.
- Five-minute expiry; five verification attempts by default.
- Forty-five-second resend cooldown and five requests per phone per hour by default.
- Previous open challenges for the phone are invalidated on resend.
- Verification attempts and consumption use conditional database writes to prevent replay and concurrent double use.
- Rate settings: `OTP_MAX_ATTEMPTS`, `OTP_MAX_REQUESTS_PER_HOUR`, `OTP_MAX_REQUESTS_PER_IP_PER_15_MINUTES`, `OTP_MAX_VERIFICATIONS_PER_IP_PER_15_MINUTES`, and `OTP_RESEND_COOLDOWN_SECONDS`.

## Browser sessions

Cookies are scoped to `/api` so the browser sends the same HttpOnly credentials to both authentication and protected patient endpoints. SameSite is configurable and cookies are Secure in production. The API permits credentialed CORS only from the explicit exact origins in `WEB_ORIGIN` (comma-separated); unsafe requests require one of those exact Origins, and cookie-authenticated requests without Origin are rejected. Do not deploy frontend and API on unrelated sites without reviewing SameSite, Secure, CORS, and origin behavior.

## Provider boundary and limitations

### Local password testing mode

For local dashboard and feature testing, set `DEV_PASSWORD_AUTH_ENABLED=true`, `NEXT_PUBLIC_DEV_PASSWORD_AUTH_ENABLED=true`, `DEV_TEST_PHONE`, and a unique `DEV_TEST_PASSWORD` of at least 16 characters. This mode is rejected when `NODE_ENV=production`; it pauses the OTP endpoints and exposes only a password sign-in screen. On first successful sign-in it creates one PATIENT account marked `isDevelopmentTestAccount`; the configured phone cannot authenticate an existing non-test account. The password is compared in constant time, is never stored or logged, and attempts are rate limited per IP and phone. Disable the mode and remove the test account before production use. This mode still requires PostgreSQL because sessions and patient data use the normal database-backed services.

`SmsProvider` defines `sendOtp(phoneNumber, otp)`. `DevelopmentMockSmsProvider` intentionally refuses delivery without exposing the code, runs only under development/test, and refuses production. No production SMS adapter is included; doctor OTP authentication remains unavailable until a reviewed provider is configured.

IP request and verification limits use process memory. Phone limits and challenge attempt counts persist in PostgreSQL, but multi-instance deployments need a shared atomic IP limiter. Recovery verifies the same mobile factor and creates a session. Account deletion, phone change, MFA, delivery receipts, and production provider integration are not implemented.

Local password-testing mode is restricted to PATIENT development fixtures. Doctor login always uses the OTP flow. The development SMS adapter intentionally does not log OTP values and reports delivery unavailable. Synthetic doctor test accounts are denied medical-sharing access.
