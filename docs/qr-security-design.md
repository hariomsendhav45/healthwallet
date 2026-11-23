# QR security design

- Generate 32 random bytes with Node.js `crypto.randomBytes`, encoded as 43-character base64url (256 bits of entropy).
- Persist only SHA-256(token) in `MedicalShareSession.tokenHash`; the unique constraint prevents collisions. The raw reference is returned once at session creation and is never returned by list/detail endpoints.
- The QR payload is only that opaque token. It contains no name, phone, dates, record identifiers, health categories, readings, document URL, or permanent credential. It is not placed in the address bar or referrer.
- The patient’s QR UI keeps the token only in component memory, shows a countdown, and clears it on revocation/unmount. Browser storage and service-worker persistence are not used.
- Sessions expire in 5–60 minutes and are revocable. The database limits each session to at most five distinct scan requests. Unique `(shareSessionId, doctorUserId)` requests stop replay by one doctor; duplicate scans return the existing request status.
- Scanning requires an authenticated, active, phone-verified doctor account marked `APPROVED`. Token lookup responses do not reveal patient identity and invalid/expired references use the same public error.
- Doctor scanner attempts are rate-limited per doctor and IP. These limits are process-local and need a shared store before horizontal production deployment.
- A valid QR never grants record access. Patient consent creates a separate time-limited grant. Grant and session expiry/revocation are checked on every shared-data request.

Do not log or persist the raw QR payload. Do not include it in a route path, query, fragment, analytics event, support ticket, or screenshot. Use a new session if a QR is lost or compromised.
