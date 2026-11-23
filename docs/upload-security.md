# Upload security controls

- Allow only PDF, JPEG, and PNG; extension, browser MIME declaration, actual signature, non-empty size, and configured byte limit must all match.
- The default maximum is 15 MiB. Set `MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES` (1 byte–100 MiB); the Nest/Multer memory limit and service validation use the same loaded setting.
- Reject extension/MIME/signature mismatch and never use a client filename in an object key. Keys are random UUIDs with a validated safe extension.
- Development/test use the explicitly labeled no-op scanner and persist `NOT_SCANNED`; it is not antivirus. Production refuses that scanner and requires ClamAV (`MEDICAL_DOCUMENT_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`). Scanner outage fails closed; infected files are rejected.
- Production storage must be a private S3-compatible bucket. Objects are verified by size and SHA-256 after upload and again before serving. Access is streamed through an authenticated, patient-scoped API; storage keys are never returned.
- Authenticated upload rate limit: 20 uploads per patient and 40 per IP per hour (process-local; use shared limits in multi-instance production).
- API content responses are no-store, nosniff, sandboxed by CSP, and set the validated server MIME type and safe content disposition. The service worker ignores all `/api/` requests, including document content. Browser memory previews are revoked on selection change/unmount; no localStorage, IndexedDB, or offline file cache is used.
- Audit records contain event, actor, and IP only. File bytes, checksum, names, descriptions, and medical contents are not logged.
- No document analysis, OCR, diagnosis, doctor sharing, or public file lookup is implemented.
