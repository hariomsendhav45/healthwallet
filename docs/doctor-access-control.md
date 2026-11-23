# Doctor access control

All doctor routes use the authenticated cookie session. Sharing and record routes require the `DOCTOR` role, `doctorVerificationStatus=APPROVED`, active account status, non-test account, and verified mobile. These values come from the database-backed session, never from request data. The service repeats doctor checks against the current user row for scan and record access. `APPROVED` means manual HealthVault administrator review only; it does not indicate independent registry verification.

Doctor registration details live in `DoctorProfile` and are self-reported. The app has no professional registry check or verification administration; a trusted operator must set the existing verification status. The doctor cannot set their own status through these APIs. New public doctor accounts remain PENDING.

The doctor scans an opaque token or enters a token manually when camera scanning is unavailable. Scan creates a unique request tied to the token’s server-side session and doctor account. Doctors do not receive patient identity or records from token lookup. A patient approval transaction creates a grant. Each view/download verifies the doctor, grant owner, active status and expiry, active session and expiry, permission categories, and (for reports) the exact document selection and current document ownership/availability. Patient IDs are never accepted in doctor request payloads.

Doctor list and record responses are private no-store. Report content is streamed only after grant and selected-document checks, revalidates private storage length/checksum, and has a short-lived response with no signed public object URL. Revocation ends future access; previously downloaded files cannot be recalled.
