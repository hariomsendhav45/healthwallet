# Doctor verification and access

Doctor applications use the existing `User` authentication account and `DoctorProfile`; they do not create a parallel account or patient-record system. Mobile OTP is required for registration and authentication. The development SMS adapter fails closed without logging codes. A real SMS provider is required to use doctor OTP in a deployed environment.

The lifecycle is `PENDING` → `UNDER_REVIEW` → `APPROVED` or `REJECTED`; an administrator may move `APPROVED` to `SUSPENDED`, and a later audited `APPROVED` decision reinstates a suspended doctor. Submission requires profile fields and at least one private registration document. Admin decisions require a reason and persist the acting administrator, prior/new status and timestamp. `APPROVED` means manually reviewed by HealthVault. No medical council lookup is configured, so it does not mean independent credential verification.

Files reuse the existing private storage provider, signature and size checks, and scanner. Admins retrieve document bytes only through authenticated, role-protected, rate-limited, no-store routes. No public URLs or storage keys are returned. Production requires private S3-compatible storage and configured ClamAV, following the existing upload design. Local development scanner mode is explicitly not malware protection.

The existing Phase 5 grant remains the only doctor-to-patient access mechanism. Each read continues to check the active grant, exact selected categories/documents, patient consent, expiry/revocation, verified phone, active account, doctor approval and non-test account. Admin approval alone never grants access. Phase 6 family grants remain separate.

Admin routes require `UserRole.ADMIN`; there is no public admin registration or hardcoded admin account. An authorized database operator must promote an existing verified account out of band before an admin can review applications. Do not provision an administrator through an app route.

External setup still required: a production SMS provider; out-of-band initial admin provisioning; and, if independent credential verification is required, a trusted registry verification process and operator procedure. Until that last process exists, use “admin reviewed” language only.
